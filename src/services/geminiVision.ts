import type { ParsedReceipt } from '../types/receipt.types';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

export async function scanReceipt(
  imageBlob: Blob,
  mimeType: string
): Promise<ParsedReceipt> {
  const imageBase64 = await blobToBase64(imageBlob);

  // Pass 1: OCR — extract raw text from image
  const transcript = await geminiOCR(imageBase64, mimeType);

  // Pass 2: Structure — convert raw text to JSON
  return geminiStructure(transcript);
}

async function geminiOCR(imageBase64: string, mimeType: string): Promise<string> {
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

  // Check if Pass 1 returned an error code
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (parsed.error) throw new Error(parsed.error as string);
  }

  return trimmed;
}

async function geminiStructure(transcript: string): Promise<ParsedReceipt> {
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

  const parsed = JSON.parse(text);
  if (parsed.error) throw new Error(parsed.error as string);
  return parsed as ParsedReceipt;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const OCR_PROMPT = `Act as a high-precision OCR engine. Your goal is to transcribe this receipt image into raw text.

- List every line exactly as printed
- Keep item and price on the same line (preserve horizontal relationships)
- Preserve prefixes like -, +, or 'points' which indicate discounts or sub-items
- Preserve the original language and script (Hebrew, Arabic, Chinese, etc.)
- Do NOT translate or interpret — transcribe only

If the image quality prevents accurate reading, return ONLY one of these JSON objects:
{ "error": "BLURRY" }
{ "error": "CROPPED" }
{ "error": "LOW_LIGHT" }
{ "error": "OCCLUDED" }
{ "error": "NOT_A_RECEIPT" }

Otherwise return the raw transcript as plain text (no JSON, no formatting).`;

const STRUCTURE_PROMPT = `Below is a raw text transcript of a receipt. Convert it into a JSON object.

Item types:
- MAIN: a chargeable item or dish with its own price
- SUB_ITEM: an extra, modifier, or discount belonging to the MAIN above (indented, starts with +/-)
- NOTE: a modifier with no price
- RECEIPT_TOTAL / TAX / SERVICE: totals and charges
- NOISE: ads, phone numbers, loyalty text — ignore completely

For each MAIN item, collect following SUB_ITEM/NOTE lines into sub_items until the next MAIN.

Output JSON schema (respond with ONLY the JSON, no markdown):
{
  "receipt_type": "grocery" | "restaurant" | "gas" | "other",
  "restaurant_name": string | null,
  "currency": string (ISO 4217 code),
  "subtotal": number | null,
  "tax": number | null,
  "service_charge": number | null,
  "confidence": "high" | "medium" | "low",
  "items": [
    {
      "name": string,
      "quantity": number,
      "unit_price": number,
      "total_price": number,
      "sub_items": [{ "name": string, "price": number }]
    }
  ]
}

Rules:
- All prices as positive numbers (discounts are negative sub_items)
- quantity defaults to 1 if not shown
- total_price = unit_price × quantity (before sub_items)
- confidence = "low" if data seems incomplete or ambiguous
- If no items can be extracted: { "error": "NO_ITEMS_FOUND" }`;
