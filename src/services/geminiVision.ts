import type { ParsedReceipt } from '../types/receipt.types';
import { type PassTokens, type ScanTokens, calcScanCost } from '../monitoring/tokenCost';

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string;
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

// Magic Fix only — text-only, free tier
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

export type ScanResult = {
  receipt: ParsedReceipt;
  tokens: ScanTokens;
  transcript: string;
};

export async function scanReceipt(
  imageBlob: Blob,
  mimeType: string,
  onPass2Start?: () => void,
): Promise<ScanResult> {
  const imageBase64 = await blobToBase64(imageBlob);
  console.log(`[DEBUG] Image: ${Math.round(imageBase64.length * 0.75 / 1024)} KB`);

  // Pass 1: Claude reads the image → raw text only, NO interpretation
  const { transcript, tokens: pass1Tokens } = await claudeOCR(imageBase64, mimeType);

  onPass2Start?.();

  // Pass 2: Claude structures the raw text → JSON, treating all names as opaque strings
  const { receipt, tokens: pass2Tokens } = await claudeStructure(transcript);

  const tokens = calcScanCost(pass1Tokens, pass2Tokens);
  return { receipt, tokens, transcript };
}

/**
 * Magic Fix — text-only Gemini call when user taps "Magic Fix"
 */
export async function geminiReVerify(
  transcript: string,
  itemsSum: number,
  printedSubtotal: number,
): Promise<ParsedReceipt | null> {
  const diff = Math.abs(itemsSum - printedSubtotal);

  const prompt = `Receipt transcript below. Item prices don't match the printed total.

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

// ─── Pass 1: Claude OCR — pure visual copy, no language interpretation ────────

async function claudeOCR(
  imageBase64: string,
  mimeType: string,
): Promise<{ transcript: string; tokens: PassTokens }> {
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
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: OCR_PROMPT },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const s = response.status;
    if (s === 429) throw new Error('TOO_MANY_REQUESTS');
    if (s === 401) throw new Error('ANTHROPIC_AUTH_ERROR');
    throw new Error(`HTTP_${s}`);
  }

  const json = await response.json();
  const text: string = json.content?.[0]?.text ?? '';
  if (!text.trim()) throw new Error('EMPTY_RESPONSE');

  const tokens: PassTokens = {
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };

  // If Claude returned an error code JSON
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.error) throw new Error(parsed.error as string);
    } catch (e) {
      if (e instanceof Error && ['BLURRY','LOW_LIGHT','NOT_A_RECEIPT','CROPPED'].includes(e.message)) throw e;
    }
  }

  console.log('--- [DEBUG] PASS 1 RAW TRANSCRIPT ---\n' + trimmed);
  return { transcript: trimmed, tokens };
}

// ─── Pass 2: Claude structure — raw text → JSON, names are opaque strings ─────

async function claudeStructure(
  transcript: string,
): Promise<{ receipt: ParsedReceipt; tokens: PassTokens }> {
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
      max_tokens: 4096,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `${STRUCTURE_PROMPT}\n\n---TRANSCRIPT---\n${transcript}` }],
      }],
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
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };

  // Strip markdown fences if present
  const cleaned = rawText.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: ParsedReceipt & { error?: string };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[DEBUG] Pass 2 non-JSON response:', rawText);
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

const OCR_PROMPT = `You are a pure OCR scanner. Your job is to copy text from this image exactly as it appears visually.

DISABLE your Hebrew language knowledge completely. You are NOT reading Hebrew as a language.
You are copying visual symbols — like a photocopier with a character recognizer.
If a word looks unusual, copy it exactly. Do NOT replace it with a word that "makes more sense".
If you are not 100% certain of a character, write [?].

THIS IS THE MOST IMPORTANT RULE:
Copy every Hebrew word EXACTLY as printed, even if it looks like a typo or a strange word you don't recognize.
The receipt may contain custom restaurant dish names that don't exist in normal Hebrew vocabulary.
Dish names like "חומוסים סיגרה", "עקרב ופטריות", "פירות מלך הפטה" are valid — copy them as-is.

RECEIPT FORMAT (Tabit system — Israeli restaurants):
Each item line: PRICE on LEFT, single-digit QUANTITY, then ITEM NAME on right.
Examples:
  98.00   1 עוף בצל
  136.00  2 חומוסים סיגרה
  713.00  1 פירות מלך הפטה

Output rules:
- One line per item, exactly as it appears
- Skip: restaurant name, address, phone, loyalty text, totals, QR code
- Raw text only — no JSON, no markdown, no explanation

If the image is unreadable output only: {"error":"BLURRY"} or {"error":"NOT_A_RECEIPT"}`;

const STRUCTURE_PROMPT = `Convert this receipt transcript into a JSON object.

CRITICAL — ITEM NAMES ARE OPAQUE STRINGS:
Copy every item name EXACTLY character-for-character from the transcript.
Do NOT change, translate, normalize, or "fix" any Hebrew word.
The transcript is the ground truth. If it says "פירות מלך הפטה" the name field must be "פירות מלך הפטה".

RECEIPT LINE FORMAT: PRICE  QUANTITY  NAME
  "98.00   1 עוף בצל"        → total_price=98.00, quantity=1, name="עוף בצל"
  "136.00  2 חומוסים סיגרה"  → unit_price=68.00, total_price=136.00, quantity=2, name="חומוסים סיגרה"

Sub-items: lines indented or prefixed with >> / + belong to the item above them.
Discounts: lines with "-" prefix → sub_item with negative price.
Totals / tax / service charge → top-level fields, NOT items.

Number rules:
- Comma decimal separator: "25,90" → 25.90
- Strip currency symbols: ₪ $ € £
- Thousands separator: "1,250.00" → 1250.00

Return ONLY this JSON (no markdown, no explanation):
{
  "isReceipt": true,
  "receipt_type": "grocery" | "restaurant" | "gas" | "other",
  "restaurant_name": string | null,
  "currency": "ILS",
  "subtotal": number | null,
  "tax": number | null,
  "taxPercent": number | null,
  "service_charge": number | null,
  "total": number | null,
  "confidence": "high" | "medium" | "low",
  "items": [
    {
      "name": "exact name from transcript",
      "quantity": 1,
      "unit_price": number | null,
      "total_price": number | null,
      "price_missing": false,
      "sub_items": [{ "name": string, "price": number | null }]
    }
  ]
}

Rules:
- quantity defaults to 1
- unit_price = total_price ÷ quantity
- If price unreadable: unit_price: null, total_price: null, price_missing: true
- confidence = "low" if any price is missing
- If no items found: { "error": "NO_ITEMS_FOUND" }`;
