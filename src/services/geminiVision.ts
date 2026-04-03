import type { ParsedReceipt } from '../types/receipt.types';
import { type PassTokens, type ScanTokens, calcScanCost } from '../monitoring/tokenCost';

// Pass 1: Claude claude-sonnet-4-5 — "Human-Eye" Hebrew menu interpretation
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string;
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

// Pass 2 + Magic Fix: Gemini 2.5 Flash — text-only, free tier
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

  // Pass 1: Claude interprets the receipt like a human — using Hebrew menu knowledge
  const { transcript, tokens: pass1Tokens } = await claudeHumanEyeOCR(imageBase64, mimeType);

  onPass2Start?.();

  // Pass 2: Gemini converts the clean transcript to structured JSON
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

// ─── Pass 1: Claude "Human-Eye" OCR ──────────────────────────────────────────

async function claudeHumanEyeOCR(
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
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        { type: 'text', text: HUMAN_EYE_PROMPT },
      ]}],
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
    inputTokens:  json.usage?.input_tokens  ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };

  const trimmed = text.trim();

  // Handle error responses
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.error) throw new Error(parsed.error as string);
    } catch (e) {
      if (e instanceof Error && ['BLURRY','LOW_LIGHT','NOT_A_RECEIPT'].includes(e.message)) throw e;
    }
  }

  console.log('--- [DEBUG] PASS 1 TRANSCRIPT ---\n' + trimmed);
  return { transcript: trimmed, tokens };
}

// ─── Pass 2: Gemini Structure ─────────────────────────────────────────────────

async function geminiStructure(
  transcript: string,
): Promise<{ receipt: ParsedReceipt; tokens: PassTokens }> {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${STRUCTURE_PROMPT}\n\n---TRANSCRIPT---\n${transcript}` }] }],
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
  try { parsed = JSON.parse(text); }
  catch {
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

const HUMAN_EYE_PROMPT = `You are an experienced Israeli waiter reading a receipt from your own restaurant. You know Hebrew menus intimately.

YOUR TASK: Look at this receipt image and list every ordered item with its price and quantity.

HOW TO READ IT — like a human, not a machine:
1. LOOK AT WHOLE WORDS, not letter-by-letter. A blurry "סל.. קיס." is clearly "סלט קיסר".
2. USE YOUR MENU KNOWLEDGE. If pixels suggest "לימונד..", you know it's "לימונדה". If you see "קוק. קול.", it's "קוקה קולה".
3. NO GIBBERISH RULE: If your reading produces a word that doesn't exist in Hebrew (like "ביסלימונדה" or "כוסות מזלג"), STOP and re-examine. That is always a misread of a real menu item.
4. RECEIPT LAYOUT (Tabit system): Each line has PRICE on the LEFT, then QUANTITY (1/2/3), then ITEM NAME in Hebrew on the right.
   Example: 53.00  1 סלט קיסר

OUTPUT FORMAT — one line per item, nothing else:
53.00  1 סלט קיסר
18.00  1 קוקה קולה
136.00 2 חומוסים סיגרה

SKIP: restaurant name, address, phone, totals, tax, QR code, loyalty text.

If the image is not a receipt or is completely unreadable, output only: {"error":"NOT_A_RECEIPT"}`;

const STRUCTURE_PROMPT = `Convert this receipt transcript into a JSON object.

NAMES: Copy item names EXACTLY from the transcript. Do not change any word.

LINE FORMAT:  PRICE  QUANTITY  NAME
  "98.00  1 עוף בצל"       → total_price=98, qty=1, name="עוף בצל"
  "136.00 2 חומוסים סיגרה" → unit_price=68, total_price=136, qty=2, name="חומוסים סיגרה"

Sub-items: indented or prefixed >> / + → attach to item above.
Discounts: "-10.00 הנחה" → sub_item with price: -10.
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
