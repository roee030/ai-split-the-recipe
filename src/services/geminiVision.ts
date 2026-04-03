import type { ParsedReceipt } from '../types/receipt.types';
import { type PassTokens, type ScanTokens, calcScanCost } from '../monitoring/tokenCost';

// Pass 1 (OCR): Claude 3.5 Sonnet — best-in-class Hebrew vision
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string;
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

// Pass 2 (structure) + Pass 3 (Magic Fix): Gemini 2.5 Flash — text-only, free tier
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

  // Pass 1: Claude 3.5 Sonnet — pure literal OCR, image → raw text
  const { transcript, tokens: pass1Tokens } = await claudeOCR(imageBase64, mimeType);

  // Notify caller that Pass 1 is done and Pass 2 (analysis) is starting
  onPass2Start?.();

  // Pass 2: Gemini 2.5 Flash — text → JSON (no image, free tier)
  const { receipt, tokens: pass2Tokens } = await geminiStructure(transcript);

  const tokens = calcScanCost(pass1Tokens, pass2Tokens);
  return { receipt, tokens, transcript };
}

/**
 * Pass 3 — Re-verify: called only when the user clicks "Magic Fix".
 * Sends the stored OCR transcript (not the image) + mismatch context to Gemini.
 * Returns corrected ParsedReceipt or null if re-verify couldn't help.
 */
export async function geminiReVerify(
  transcript: string,
  itemsSum: number,
  printedSubtotal: number,
): Promise<ParsedReceipt | null> {
  const diff = Math.abs(itemsSum - printedSubtotal);

  const prompt = `The following receipt transcript was parsed but the item prices don't add up to the printed total.

TRANSCRIPT:
${transcript}

CURRENT PARSED ITEMS SUM: ${itemsSum.toFixed(2)}
RECEIPT PRINTED TOTAL: ${printedSubtotal.toFixed(2)}
DIFFERENCE: ${diff.toFixed(2)}

Re-examine the transcript carefully. Common causes:
- A price was misread (especially comma vs dot decimal: "25,90" should be 25.90)
- An item line was skipped entirely
- Two adjacent item prices were merged into one
- A discount was incorrectly subtracted from an item's total_price instead of being a sub_item

Return ONLY the corrected full JSON object. Do not explain, do not use markdown. Use this exact schema:
{
  "receipt_type": "grocery" | "restaurant" | "gas" | "other",
  "restaurant_name": string | null,
  "currency": string,
  "subtotal": number | null,
  "tax": number | null,
  "service_charge": number | null,
  "confidence": "high" | "medium" | "low",
  "items": [
    {
      "name": string,
      "quantity": number,
      "unit_price": number | null,
      "total_price": number | null,
      "price_missing": boolean,
      "sub_items": [{ "name": string, "price": number | null }]
    }
  ]
}`;


  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.1,
      },
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
  } catch {
    return null;
  }
}

// ─── Pass 1: Claude 3.5 Sonnet OCR ──────────────────────────────────────────

async function claudeOCR(imageBase64: string, mimeType: string): Promise<{ transcript: string; tokens: PassTokens }> {
  console.log(`[DEBUG] Image Chars: ${imageBase64.length} (~${Math.round(imageBase64.length * 0.75 / 1024)} KB)`);

  const response = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      // Required for browser/client-side calls
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 },
          },
          { type: 'text', text: OCR_PROMPT },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) throw new Error('TOO_MANY_REQUESTS');
    if (status === 401) throw new Error('ANTHROPIC_AUTH_ERROR');
    throw new Error(`HTTP_${status}`);
  }

  const json = await response.json();
  const text: string = json.content?.[0]?.text ?? '';
  if (!text.trim()) throw new Error('EMPTY_RESPONSE');

  const pass1Tokens: PassTokens = {
    inputTokens:  json.usage?.input_tokens  ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };

  const transcript = text.trim();

  // Check if Claude returned a structured error code
  if (transcript.startsWith('{')) {
    try {
      const parsed = JSON.parse(transcript);
      if (parsed.error) throw new Error(parsed.error as string);
    } catch (e) {
      if (e instanceof Error && e.message !== 'EMPTY_RESPONSE') throw e;
    }
  }

  console.log('--- [DEBUG] PASS 1: RAW TRANSCRIPT (Claude) ---', transcript);

  return { transcript, tokens: pass1Tokens };
}

// ─── Pass 2: Gemini 2.5 Flash structure ─────────────────────────────────────

async function geminiStructure(transcript: string): Promise<{ receipt: ParsedReceipt; tokens: PassTokens }> {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${STRUCTURE_PROMPT}\n\n---RECEIPT TRANSCRIPT---\n${transcript}` }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.1,
      },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) throw new Error('TOO_MANY_REQUESTS');
    throw new Error(`HTTP_${status}`);
  }

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('EMPTY_RESPONSE');

  const pass2Tokens: PassTokens = {
    inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  };

  const parsed = JSON.parse(text);
  if (parsed.error) throw new Error(parsed.error as string);
  const receipt = parsed as ParsedReceipt;

  // Log 2: show the full JSON object Gemini built from the transcript
  console.log('--- [DEBUG] PASS 2: STRUCTURED JSON ---', parsed);

  return { receipt, tokens: pass2Tokens };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const OCR_PROMPT = `You are a high-precision, literal OCR engine. Your ONLY job is to transcribe the EXACT characters you see on this receipt image.

1. THE 'SCANNER' RULE:
Transcribe exactly what is written. If you see 'סן פלגרינו', do not write 'בירה'.
If you see 'לימונענע גרוס', do not write 'מיץ'.
If you see 'חידוש כרטיס מועדון', transcribe it exactly.
NEVER substitute a word with a 'likely' restaurant item.

2. ISRAELI RECEIPT STRUCTURE (Tabit / Cafe Cafe style):
Read every line strictly from LEFT TO RIGHT. Output each line on one line.
- Prices: Usually appear on the LEFT. Sometimes twice (unit price then total). Transcribe both if present.
- Quantities: Usually a single digit (1, 2, 3) next to the item name.
- Sub-items / toppings: Lines that start with >> or + — transcribe the symbol too.
- Discounts: Lines with a leading minus sign (e.g., -10.00) — transcribe the minus.
Example line: 69.00 69.00 1 סלט חלומי ופטריות

3. ZERO INFERENCE:
- If a word is 100% unclear, write [?].
- Do NOT fix typos. Do NOT translate. Do NOT normalise anything.

If the image is unreadable (blurry, dark, not a receipt), output ONLY one of:
{"error":"BLURRY"}
{"error":"LOW_LIGHT"}
{"error":"NOT_A_RECEIPT"}

Otherwise: raw text only, one line per receipt line, no JSON, no markdown, no explanation.`;

const STRUCTURE_PROMPT = `Below is a raw OCR transcript of a receipt. Convert it into a structured JSON object.

CRITICAL RULE FOR ITEM NAMES: Copy item names character-for-character from the transcript. Do NOT translate, normalize, or substitute similar-sounding words. If the transcript says "המבורגר", the name field must be "המבורגר" — never a different word. Treat every item name as an opaque string to be preserved exactly. If the transcript contains [?] for a word, keep it as-is in the name field.

HEBREW RECEIPT LAYOUT RULE (very common in Israel):
Hebrew receipts are right-to-left. The item lines typically look like:
  "18.00                    1 מיצב תפוזים"
  "130.00                   2 המבורגר טרי"
  "69.00 69.00 1 סלט חלומי ופטריות"
In this format: PRICE is on the LEFT, then QUANTITY and ITEM NAME are on the RIGHT.
Parse these lines as: total_price=18.00, quantity=1, name="מיצב תפוזים"
Do NOT confuse the price (left number) for the quantity.

LAYOUT RECOVERY RULE: If the transcript shows a block of prices separated from a block of names, try to match them positionally — the Nth price goes with the Nth item.

Item classification:
- MAIN: a chargeable item or dish with its own price
- SUB_ITEM: an extra, modifier, or discount that belongs to the MAIN above it (indented, starts with +/-)
- NOTE: a modifier with no price (e.g. "no gluten", "well done")
- RECEIPT_TOTAL / TAX / SERVICE: totals and charges — capture as top-level fields, NOT as items
- NOISE: ads, phone numbers, loyalty points text — ignore completely

Decimal and currency rules (CRITICAL for Israeli receipts):
- If you see a comma used as a decimal separator (e.g. "25,90"), convert to dot notation: 25.90
- Strip all currency symbols (₪, $, €, £, ¥) from numeric fields — output plain numbers only
- Thousands separators (e.g. "1,250.00") should become 1250.00

Discount rules:
- Discounts MUST appear as negative values inside sub_items, NOT as negative total_price on the MAIN item
- Example: item costs 50, discount of 10 → total_price: 50, sub_items: [{ "name": "Discount", "price": -10 }]

For each MAIN item, collect all following SUB_ITEM/NOTE lines into sub_items until the next MAIN.

Output JSON schema (respond with ONLY the JSON, no markdown):
{
  "receipt_type": "grocery" | "restaurant" | "gas" | "other",
  "restaurant_name": string | null,
  "currency": string (ISO 4217 code, e.g. "ILS", "USD"),
  "subtotal": number | null,
  "tax": number | null,
  "service_charge": number | null,
  "confidence": "high" | "medium" | "low",
  "items": [
    {
      "name": string,
      "quantity": number,
      "unit_price": number | null,
      "total_price": number | null,
      "price_missing": boolean,
      "sub_items": [{ "name": string, "price": number | null }]
    }
  ]
}

Rules:
- quantity defaults to 1 if not shown
- total_price = unit_price × quantity (before sub_items)
- If a price is unreadable or missing: set unit_price: null, total_price: null, price_missing: true
- confidence = "low" if data seems incomplete, ambiguous, or any price is missing
- If no items can be extracted: { "error": "NO_ITEMS_FOUND" }`;
