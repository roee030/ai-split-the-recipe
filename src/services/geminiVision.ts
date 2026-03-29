import type { ParsedReceipt } from '../types/receipt.types';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
const UPLOAD_URL = `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${API_KEY}`;

const PROMPT = `You are a professional receipt scanner. Convert this receipt image to JSON ONLY.
Receipts come in different formats (supermarket, restaurant, gas station) — normalize all of them to the same unified structure.

## Step 1 — Identify receipt type
Classify as one of: "grocery", "restaurant", "gas", "other"

## Step 2 — Classify every line

| Type         | Description                                                        | Visual cues                                      |
|--------------|--------------------------------------------------------------------|--------------------------------------------------|
| MAIN         | A chargeable item or dish with its own price                       | Regular price line                               |
| SUB_ITEM     | An extra, add-on, modifier, or discount belonging to the MAIN above| Indented, starts with +/-, or prefixed with תוספת/הנחה |
| NOTE         | A modifier with NO price (allergy, cooking style, free text)       | Text only, no number                             |
| RECEIPT_TOTAL| Grand total at the bottom                                          | סה"כ לתשלום / Total                              |
| TAX          | Tax line                                                           | מע"מ                                             |
| SERVICE      | Service charge                                                     | שירות                                            |
| NOISE        | Ads, phone numbers, opening hours, loyalty text, QR codes          | Ignore completely                                |

## Step 3 — Build items with sub_items

For each MAIN item, collect all following SUB_ITEM and NOTE lines into its sub_items array until the next MAIN.
- SUB_ITEM with a price: include with that price (positive = extra charge, negative = discount)
- NOTE with no price: include as sub_item with price 0 (preserves the info)
- The item totalPrice is its own base price. The client sums sub_item prices to get the true charged amount.
- NEVER merge sub_items into the parent name. Keep them separate.

## Step 4 — Math verification

For each item: unitPrice x quantity = totalPrice (within 0.10 rounding tolerance).
totalPrice is always ground truth. If math breaks: unitPrice = totalPrice / quantity.

## Step 5 — Validation

After building all items, verify:
  sum of (item.totalPrice + all sub_item prices) approximately equals the printed subtotal
If discrepancy is more than 5%, recheck — you likely missed a discount or extra charge.

## Output format

Return ONLY valid JSON (no markdown, no backticks, no explanation):

{
  "isReceipt": true,
  "receipt_type": "restaurant",
  "restaurantName": "string or null",
  "items": [
    {
      "id": "item_1",
      "name": "exact name as printed — no translation",
      "quantity": 1,
      "unitPrice": 45.00,
      "totalPrice": 45.00,
      "category": "food",
      "sub_items": [
        { "name": "תוספת גבינה", "price": 8.00 },
        { "name": "ללא גלוטן", "price": 0 },
        { "name": "הנחת מועדון", "price": -5.00 }
      ]
    }
  ],
  "subtotal": null,
  "tax": null,
  "taxPercent": null,
  "serviceCharge": null,
  "total": null,
  "currency": "ILS",
  "confidence": "high"
}

## Rules

- isReceipt: false ONLY if clearly not a receipt (food menu with no totals, unrelated photo). If blurry or partial — set true and extract what you can.
- LANGUAGE: Never translate. Hebrew stays Hebrew. English stays English. Mixed stays mixed.
- QUANTITIES: Detect from xN, or identical repeated lines. Merge duplicates. unitPrice = totalPrice / quantity.
- NOISE: Ignore ads, phone numbers, opening hours, loyalty program text, QR codes entirely.
- DISCOUNTS: Use sub_items with negative price. Never create a separate MAIN item for a discount that belongs to the MAIN above it.
- HEBREW GLOSSARY: מע"מ=tax, שירות=service charge, סה"כ=total, כמות=quantity, מחיר=price, הנחה=discount, תוספת=extra/add-on
- ILLEGIBLE: If a price is unreadable, use 0 and set confidence to "low". Never guess.
- Never return null for items — use [] only if completely unreadable.`;

// Upload image to Gemini File API — returns a file URI
async function uploadImageToFileAPI(blob: Blob, mimeType: string): Promise<string> {
  const boundary = `boundary_${Date.now()}`;
  const metadata = JSON.stringify({ file: { display_name: 'receipt' } });

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

// Run vision analysis using the uploaded file URI
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
