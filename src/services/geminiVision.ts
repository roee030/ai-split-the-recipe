import type { ParsedReceipt } from '../types/receipt.types';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${API_KEY}`;
const UPLOAD_URL = `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${API_KEY}`;

const PROMPT = `You are a receipt parser. Analyze this receipt image and extract ALL line items.

Return ONLY valid JSON (no markdown, no backticks, no explanation):
{
  "restaurantName": "string or null",
  "items": [
    {
      "id": "unique_string",
      "name": "string — keep EXACTLY as printed on receipt, do not translate",
      "quantity": number,
      "unitPrice": number,
      "totalPrice": number,
      "category": "food" | "drink" | "dessert" | "other"
    }
  ],
  "subtotal": number or null,
  "tax": number or null,
  "taxPercent": number or null,
  "serviceCharge": number or null,
  "total": number or null,
  "currency": "ILS" | "USD" | "EUR" | "GBP" | "other",
  "confidence": "high" | "medium" | "low"
}

Rules:
- LANGUAGE: Keep item names exactly as they appear on the receipt — Hebrew stays Hebrew, English stays English, mixed stays mixed. Do NOT translate anything.
- GROUPING: If a line is a modifier, extra, topping, sauce, or note that belongs to the dish on the previous line (e.g. "extra sauce", "ללא גלוטן", "well done"), append it to the previous item's name in parentheses — do NOT create a separate item for it.
- QUANTITIES: Merge duplicate items (same name, listed multiple times) into one item with combined quantity. Detect quantity from ×N, xN, כמות N, or repeated identical lines.
- PRICES: unitPrice = totalPrice / quantity. If quantity not shown, default to 1.
- HEBREW TERMS: מע"מ = tax, שירות = service charge, סה"כ = total, כמות = quantity, מחיר = price, הנחה = discount (negative amount)
- DISCOUNTS: Include as negative-amount items
- Never return null for items — return [] if truly unreadable`;

// Step 1: Upload image to Gemini File API — returns a file URI
async function uploadImageToFileAPI(blob: Blob, mimeType: string): Promise<string> {
  const boundary = `boundary_${Date.now()}`;
  const metadata = JSON.stringify({ file: { display_name: 'receipt' } });

  // Build multipart/related body manually (binary-safe)
  const enc = new TextEncoder();
  const metaPart = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const ending = enc.encode(`\r\n--${boundary}--`);
  const fileBytes = new Uint8Array(await blob.arrayBuffer());

  const body = new Uint8Array(metaPart.length + fileBytes.length + ending.length);
  body.set(metaPart, 0);
  body.set(fileBytes, metaPart.length);
  body.set(ending, metaPart.length + fileBytes.length);

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Failed to upload image to Gemini');
  }

  const data = await res.json();
  return data.file.uri as string;
}

// Step 2: Run vision analysis using the uploaded file URI
export async function scanReceipt(blob: Blob, mimeType: string): Promise<ParsedReceipt> {
  const fileUri = await uploadImageToFileAPI(blob, mimeType);

  const response = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: PROMPT },
            { file_data: { mime_type: mimeType, file_uri: fileUri } },
          ],
        },
      ],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048, response_mime_type: 'application/json' },
    }),
  });

  if (response.status === 429) {
    throw new Error('Too many requests. Please wait a moment and try again.');
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Gemini API error');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) throw new Error('Empty response from Gemini');

  const clean = text.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean) as ParsedReceipt;
  } catch {
    throw new Error('Could not parse receipt data. Please try again.');
  }
}
