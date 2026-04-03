import type { ParsedReceipt } from '../types/receipt.types';
import { type PassTokens, type ScanTokens, calcScanCost } from '../monitoring/tokenCost';
import { sliceIntoRows } from '../utils/imageResize';

// Pass 1 (Row OCR): Claude claude-sonnet-4-5 with multimodal array of row strips
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string;
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

// Pass 2 (Structure) + Magic Fix: Gemini 2.5 Flash — text-only, free tier
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

// Maximum row strips to send to Claude (API image limit is 100, but 20 rows covers any receipt)
const MAX_ROWS = 20;

export type ScanResult = {
  receipt: ParsedReceipt;
  tokens: ScanTokens;
  transcript: string;
};

export async function scanReceipt(
  imageBlob: Blob,
  _mimeType: string,
  onPass2Start?: () => void,
): Promise<ScanResult> {
  // ── Phase 1: Slice the image into individual row strips ─────────────────────
  const rowBlobs = await sliceIntoRows(imageBlob);
  console.log(`[DEBUG] Sliced into ${rowBlobs.length} row strips`);

  // ── Phase 2: Claude reads each strip — one image = one line, no context ─────
  const { transcript, tokens: pass1Tokens } = await claudeRowOCR(rowBlobs);

  onPass2Start?.();

  // ── Phase 3: Gemini assembles the clean transcript → JSON ───────────────────
  const { receipt, tokens: pass2Tokens } = await geminiStructure(transcript);

  const tokens = calcScanCost(pass1Tokens, pass2Tokens);
  return { receipt, tokens, transcript };
}

/**
 * Magic Fix — text-only Gemini re-verify when user taps "Magic Fix"
 */
export async function geminiReVerify(
  transcript: string,
  itemsSum: number,
  printedSubtotal: number,
): Promise<ParsedReceipt | null> {
  const diff = Math.abs(itemsSum - printedSubtotal);

  const prompt = `Receipt transcript below. Item prices don't add up to the printed total.

TRANSCRIPT:
${transcript}

ITEMS SUM: ${itemsSum.toFixed(2)}
PRINTED TOTAL: ${printedSubtotal.toFixed(2)}
DIFFERENCE: ${diff.toFixed(2)}

Find the error. Common causes: misread decimal (25,90 → 25.90), skipped line, merged prices, wrong discount handling.
Return ONLY corrected JSON, no markdown:
{
  "receipt_type": "restaurant",
  "restaurant_name": string | null,
  "currency": "ILS",
  "subtotal": number | null,
  "tax": number | null,
  "service_charge": number | null,
  "confidence": "high" | "medium" | "low",
  "items": [{ "name": string, "quantity": number, "unit_price": number | null, "total_price": number | null, "price_missing": boolean, "sub_items": [{ "name": string, "price": number | null }] }]
}`;

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0.1 },
    }),
  });

  if (!response.ok) return null;
  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed.error) return null;
    return parsed as ParsedReceipt;
  } catch { return null; }
}

// ─── Pass 1: Claude Row OCR ───────────────────────────────────────────────────
// Each row strip is a separate image in the multimodal content array.
// Claude sees only one receipt line at a time — no surrounding context to "fill in".

async function claudeRowOCR(
  rowBlobs: Blob[],
): Promise<{ transcript: string; tokens: PassTokens }> {
  // Cap rows and convert to base64
  const capped = rowBlobs.slice(0, MAX_ROWS);
  const rowBase64s = await Promise.all(capped.map(blobToBase64));

  // Build the multimodal content array:
  // [intro text] [Row 1 label] [Row 1 image] [Row 2 label] [Row 2 image] ... [final prompt]
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

  const content: ContentBlock[] = [
    {
      type: 'text',
      text: `You will see ${capped.length} individual row strips cut from an Israeli restaurant receipt.
Each strip contains exactly ONE line of text. Transcribe each strip on a separate line.`,
    },
  ];

  for (let i = 0; i < rowBase64s.length; i++) {
    content.push({ type: 'text', text: `Row ${i + 1}:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: rowBase64s[i] },
    });
  }

  content.push({ type: 'text', text: ROW_OCR_PROMPT });

  const response = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      temperature: 0,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!response.ok) {
    const s = response.status;
    if (s === 429) throw new Error('TOO_MANY_REQUESTS');
    if (s === 401) throw new Error('ANTHROPIC_AUTH_ERROR');
    throw new Error(`HTTP_${s}`);
  }

  const json = await response.json();
  const rawText: string = json.content?.[0]?.text ?? '';
  if (!rawText.trim()) throw new Error('EMPTY_RESPONSE');

  const tokens: PassTokens = {
    inputTokens:  json.usage?.input_tokens  ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };

  // Parse "Row N: <transcription>" lines → plain transcript
  const lines = rawText.trim().split('\n');
  const transcriptLines: string[] = [];
  for (const line of lines) {
    // Match "Row N: text" or "Row N:" (blank)
    const match = line.match(/^Row\s+\d+:\s*(.*)/i);
    if (match) {
      const text = match[1].trim();
      if (text) transcriptLines.push(text);
    } else if (line.trim() && !line.match(/^Row\s+\d+\s*$/i)) {
      // Plain line without a Row prefix — keep it (fallback)
      transcriptLines.push(line.trim());
    }
  }

  const transcript = transcriptLines.join('\n');
  console.log(`--- [DEBUG] PASS 1: ${capped.length} rows → transcript ---\n${transcript}`);

  return { transcript, tokens };
}

// ─── Pass 2: Gemini Structure ─────────────────────────────────────────────────
// Text-only: receives the clean row transcript, returns structured JSON.

async function geminiStructure(
  transcript: string,
): Promise<{ receipt: ParsedReceipt; tokens: PassTokens }> {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${STRUCTURE_PROMPT}\n\n---TRANSCRIPT---\n${transcript}` }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.1,
      },
    }),
  });

  if (!response.ok) {
    const s = response.status;
    if (s === 429) throw new Error('TOO_MANY_REQUESTS');
    throw new Error(`HTTP_${s}`);
  }

  const json = await response.json();
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text.trim()) throw new Error('EMPTY_RESPONSE');

  const tokens: PassTokens = {
    inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  };

  let parsed: ParsedReceipt & { error?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('[DEBUG] Pass 2 non-JSON:', text);
    throw new Error('PARSE_ERROR');
  }

  if (parsed.error) throw new Error(parsed.error);
  console.log('--- [DEBUG] PASS 2 STRUCTURED ---', parsed);
  return { receipt: parsed, tokens };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const ROW_OCR_PROMPT = `For each row image above, output EXACTLY one line:
  Row N: <what you see>

RULES — read like a dead-eye scanner:
- Copy every character exactly as it appears. Do NOT use your language knowledge.
- This is a thermal receipt. Characters may be faint or touching — read what is PRINTED, not what "makes sense".
- If you see "קוקה קולה" write "קוקה קולה". If you see "713.00" write "713.00".
- If a character is genuinely unreadable, write [?] for that character only.
- NO guessing. NO substitutions. NO "completing" a word from context.

Each row has: PRICE on the left, QUANTITY (single digit), then ITEM NAME on the right.
Output the whole line as you see it.`;

const STRUCTURE_PROMPT = `Convert this receipt transcript into a JSON object.

CRITICAL — NAMES ARE OPAQUE STRINGS:
Copy every item name EXACTLY from the transcript. Do NOT change any word.
The transcript is ground truth. "פירות מלך הפטה" → name must be "פירות מלך הפטה".

LINE FORMAT:  PRICE  QUANTITY  NAME
  "98.00  1 עוף בצל"       → total_price=98, qty=1, name="עוף בצל"
  "136.00 2 חומוסים סיגרה" → unit_price=68, total_price=136, qty=2, name="חומוסים סיגרה"

Sub-items: indented or prefixed >> / + → attach to item above.
Discounts: "-10.00 הנחה" → sub_item price: -10.
Totals / tax / service → top-level fields, NOT items.

Numbers: comma decimal "25,90"→25.90 · strip ₪$€ · "1,250.00"→1250.

Return ONLY JSON, no markdown:
{
  "isReceipt": true,
  "receipt_type": "restaurant",
  "restaurant_name": string | null,
  "currency": "ILS",
  "subtotal": number | null,
  "tax": number | null,
  "taxPercent": number | null,
  "service_charge": number | null,
  "total": number | null,
  "confidence": "high" | "medium" | "low",
  "items": [{
    "name": string,
    "quantity": number,
    "unit_price": number | null,
    "total_price": number | null,
    "price_missing": boolean,
    "sub_items": [{ "name": string, "price": number | null }]
  }]
}

- quantity defaults to 1
- unit_price = total_price ÷ quantity
- price unreadable → unit_price: null, total_price: null, price_missing: true
- confidence = "low" if any price missing
- No items → { "error": "NO_ITEMS_FOUND" }`;
