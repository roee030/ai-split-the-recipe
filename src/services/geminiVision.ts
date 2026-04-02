import type { ParsedReceipt } from '../types/receipt.types';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

export async function scanReceipt(
  imageBlob: Blob,
  mimeType: string
): Promise<ParsedReceipt> {
  const imageBase64 = await blobToBase64(imageBlob);

  const response = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: PROMPT },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.1,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const status = response.status;
    if (status === 429) throw new Error('TOO_MANY_REQUESTS');
    throw new Error(err?.error?.message ?? `HTTP_${status}`);
  }

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('EMPTY_RESPONSE');

  const parsed = JSON.parse(text);
  if (parsed.error) throw new Error(parsed.error);
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

const PROMPT = `You are a professional receipt scanner. Convert this receipt image to JSON ONLY.

## Classify every line:
| Type | Description |
|---|---|
| MAIN | A chargeable item with its own price |
| SUB_ITEM | An extra, add-on, modifier, or discount belonging to the MAIN above |
| NOTE | A modifier with NO price |
| RECEIPT_TOTAL | Grand total |
| TAX | Tax line |
| SERVICE | Service charge |
| NOISE | Ads, phone numbers, opening hours — ignore completely |

For each MAIN item, collect following SUB_ITEM/NOTE lines into sub_items until the next MAIN.

Output JSON schema (respond with ONLY the JSON, no markdown):
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
      "unit_price": number,
      "total_price": number,
      "sub_items": [{ "name": string, "price": number }]
    }
  ]
}

Rules:
- All prices as positive numbers (discounts are negative sub_items)
- quantity defaults to 1
- confidence = "low" if blurry or ambiguous
- If not a receipt: { "error": "NOT_A_RECEIPT" }
- If receipt but no items: { "error": "NO_ITEMS_FOUND" }
`;
