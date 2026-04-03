import type { ParsedReceipt } from '../types/receipt.types';
import { type PassTokens, type ScanTokens, calcScanCost } from '../monitoring/tokenCost';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

export type ScanResult = {
  receipt: ParsedReceipt;
  tokens: ScanTokens;
  transcript: string;
};

export async function scanReceipt(
  imageBlob: Blob,
  mimeType: string
): Promise<ScanResult> {
  const imageBase64 = await blobToBase64(imageBlob);

  // Pass 1: OCR — extract raw text from image
  const { transcript, tokens: pass1Tokens } = await geminiOCR(imageBase64, mimeType);

  // Pass 2: Structure — convert raw text to JSON
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


  const response = await fetch(GENERATE_URL, {
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

async function geminiOCR(imageBase64: string, mimeType: string): Promise<{ transcript: string; tokens: PassTokens }> {
  const response = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: OCR_PROMPT },
        ],
      }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0 },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) throw new Error('TOO_MANY_REQUESTS');
    throw new Error(`HTTP_${status}`);
  }

  const json = await response.json();
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text.trim()) throw new Error('EMPTY_RESPONSE');

  const pass1Tokens: PassTokens = {
    inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  };

  // Check if Pass 1 returned an error code
  const transcript = text.trim();
  if (transcript.startsWith('{')) {
    const parsed = JSON.parse(transcript);
    if (parsed.error) throw new Error(parsed.error as string);
  }

  return { transcript, tokens: pass1Tokens };
}

async function geminiStructure(transcript: string): Promise<{ receipt: ParsedReceipt; tokens: PassTokens }> {
  const response = await fetch(GENERATE_URL, {
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

const OCR_PROMPT = `Act as a high-precision OCR engine. Your ONLY job is to transcribe this receipt image into raw text. Do NOT interpret, translate, or reformat anything.

Rules:
- Transcribe every line exactly as printed, including all characters
- Keep each item name and its price on the same line — preserve horizontal layout
- Preserve prefixes like -, +, or 'points' which indicate discounts or sub-items
- Preserve the original language and script (Hebrew, Arabic, Chinese, etc.) — do NOT translate
- Prices may appear as "25.90", "25,90", "₪25", "$12.50", "25.90₪" — transcribe exactly as printed
- If a price is partially obscured or unclear, transcribe what is readable and mark unclear digits with "?"
- Do NOT skip any line, even if it seems like a total or tax line

If the image quality prevents accurate reading, return ONLY one of these JSON objects:
{ "error": "BLURRY" }
{ "error": "CROPPED" }
{ "error": "LOW_LIGHT" }
{ "error": "OCCLUDED" }
{ "error": "NOT_A_RECEIPT" }

Otherwise return the raw transcript as plain text (no JSON, no markdown, no formatting).`;

const STRUCTURE_PROMPT = `Below is a raw OCR transcript of a receipt. Convert it into a structured JSON object.

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
