import type { ParsedReceipt } from '../types/receipt.types';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
const UPLOAD_URL = `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${API_KEY}`;

const PROMPT = `You are an expert receipt accountant. Your job is to parse a receipt image into structured JSON with 100% mathematical accuracy.

## Step 1 — Classify every line on the receipt

Before outputting anything, mentally classify each printed line:

| Type | Description | Example |
|------|-------------|---------|
| MAIN | A chargeable dish/product with its own price | "Burger 45" |
| EXTRA | An add-on/modifier WITH a price that belongs to the MAIN above it | "+ Extra cheese 8" / "תוספת 8" |
| NOTE | A modifier with NO price (cooking style, allergy, free comment) | "ללא גלוטן" / "well done" |
| TOTAL_LINE | A sub-total line for the item group above | "סה״כ 53" after burger+extra |
| RECEIPT_TOTAL | The grand total line at the bottom | "סה״כ לתשלום 142" |
| TAX | Tax line | "מע״מ 18%" |
| SERVICE | Service charge line | "שירות 10%" |
| DISCOUNT | Negative adjustment | "הנחה -15" |

## Step 2 — Roll up EXTRA prices into the parent MAIN

For each MAIN item:
- Start with its own printed price as a base
- Add the price of every EXTRA line that follows it (until the next MAIN)
- If a TOTAL_LINE appears for the group, use that as the authoritative totalPrice
- Append NOTE text to the item name in parentheses: "Burger (well done, ללא גלוטן)"
- Do NOT create separate items for EXTRA or NOTE lines
- Set hasExtras: true if any EXTRA lines were rolled in

## Step 3 — Verify math BEFORE outputting

For every item you output, verify this invariant:
  unitPrice × quantity = totalPrice  (within ₪0.10 / $0.10 rounding)

If it does not hold:
- totalPrice is always the ground truth (it's the number actually charged)
- Recalculate: unitPrice = totalPrice / quantity
- Never invent or guess a price

## Step 4 — Cross-check the receipt total

Sum all your item totalPrices. If this differs from the printed subtotal by more than 5%, recheck your work — you likely missed an item or double-counted an EXTRA.

## Output format

Return ONLY valid JSON (no markdown, no backticks, no explanation):

{
  "isReceipt": true,
  "restaurantName": "string or null",
  "items": [
    {
      "id": "item_1",
      "name": "string — EXACTLY as on receipt, NOTEs appended in parentheses, no translation",
      "quantity": number,
      "unitPrice": number,
      "totalPrice": number,
      "category": "food" | "drink" | "dessert" | "other",
      "hasExtras": false
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

## Additional rules

- isReceipt: false ONLY if this is clearly not a bill/receipt (e.g. a food menu with no totals, an unrelated photo). If it looks like a receipt even if blurry, partial, or low quality, set true and extract what you can.
- LANGUAGE: Never translate. Hebrew stays Hebrew. English stays English. Mixed stays mixed.
- QUANTITIES: Merge duplicate lines (same item repeated) into one item with summed quantity. Detect quantity from: ×N, xN, כמות N, or identical repeated lines.
- DISCOUNTS: Output as items with negative totalPrice (e.g. totalPrice: -15)
- HEBREW GLOSSARY: מע"מ=tax, שירות=service, סה"כ=total, כמות=qty, מחיר=price, הנחה=discount, תוספת=extra
- hasExtras: true if EXTRA lines were rolled into this item, false otherwise
- If a number is illegible: set confidence to "low", use 0 for that price, do not guess
- Never return null for items — return [] only if completely unreadable`;

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
async function runGeminiVision(fileUri: string, mimeType: string): Promise<ParsedReceipt> {
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
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192, response_mime_type: 'application/json' },
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

  let parsed: ParsedReceipt;
  try {
    parsed = JSON.parse(clean) as ParsedReceipt;
  } catch {
    throw new Error('Could not parse receipt data. Please try again.');
  }

  if (parsed.isReceipt === false) {
    throw new Error('NOT_A_RECEIPT');
  }

  if (!parsed.items || parsed.items.length === 0) {
    throw new Error('NO_ITEMS_FOUND');
  }

  return parsed;
}

export async function scanReceipt(blob: Blob, mimeType: string): Promise<ParsedReceipt> {
  const fileUri = await uploadImageToFileAPI(blob, mimeType);

  try {
    return await runGeminiVision(fileUri, mimeType);
  } catch (err) {
    // Retry once on transient failures (parse errors, empty responses)
    // but not on definitive rejections or rate limits
    const msg = err instanceof Error ? err.message : '';
    const isTransient = msg.includes('parse') || msg.includes('Empty response') || msg.includes('Gemini API error');
    if (isTransient) {
      return await runGeminiVision(fileUri, mimeType);
    }
    throw err;
  }
}
