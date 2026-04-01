import * as https from "https";

const GEMINI_MODEL = "gemini-2.5-flash";

export async function callGemini(
  imageBase64: string,
  mimeType: string,
  apiKey: string
): Promise<unknown> {
  const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = JSON.stringify({
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: imageBase64,
          },
        },
        {text: PROMPT},
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature: 0.1,
    },
  });

  return new Promise((resolve, reject) => {
    const url = new URL(GENERATE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if ((res.statusCode ?? 200) >= 400) {
          reject(new Error(`GEMINI_HTTP_${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          const json = JSON.parse(data) as {
            candidates?: Array<{content?: {parts?: Array<{text?: string}>}}>;
          };
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            reject(new Error("EMPTY_RESPONSE"));
            return;
          }
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error("PARSE_ERROR"));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const PROMPT = `You are a professional receipt scanner. Convert this receipt image to JSON ONLY.
Receipts come in different formats (supermarket, restaurant, gas station) — normalize all of them to the same unified structure.

## Step 1 — Identify receipt type
Classify as one of: "grocery", "restaurant", "gas", "other"

## Step 2 — Classify every line

| Type         | Description                                                        |
|--------------|--------------------------------------------------------------------|
| MAIN         | A chargeable item or dish with its own price                       |
| SUB_ITEM     | An extra, add-on, modifier, or discount belonging to the MAIN above|
| NOTE         | A modifier with NO price (allergy, cooking style, free text)       |
| RECEIPT_TOTAL| Grand total at the bottom                                          |
| TAX          | Tax line                                                           |
| SERVICE      | Service charge                                                     |
| NOISE        | Ads, phone numbers, opening hours, loyalty text, QR codes          |

## Step 3 — Build items with sub_items

For each MAIN item, collect all following SUB_ITEM and NOTE lines into its sub_items array.
- SUB_ITEM with a price: include with that price (positive = extra, negative = discount)
- NOTE with no price: include with price 0

## Output JSON schema (respond with ONLY the JSON, no markdown):

{
  "receipt_type": "grocery" | "restaurant" | "gas" | "other",
  "restaurant_name": string | null,
  "currency": "ILS" | "USD" | "EUR" | "GBP" | ... (ISO 4217),
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
      "sub_items": [
        { "name": string, "price": number }
      ]
    }
  ]
}

Rules:
- All prices as positive numbers (discounts are negative sub_items)
- quantity defaults to 1 if not shown
- total_price = unit_price × quantity (before sub_items)
- confidence = "low" if image is blurry, partial, or ambiguous
- If not a receipt at all, return { "error": "NOT_A_RECEIPT" }
- If a receipt but no line items found, return { "error": "NO_ITEMS_FOUND" }
`;
