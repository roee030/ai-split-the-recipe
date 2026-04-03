import type { ParsedReceipt } from '../types/receipt.types';
import { type PassTokens, type ScanTokens, calcScanCost } from '../monitoring/tokenCost';

// Main scan: Claude claude-sonnet-4-5 — reads Hebrew receipts accurately, image → JSON in one call
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string;
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

// Magic Fix only: Gemini 2.5 Flash — text-only re-verify, free tier
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

  console.log(`[DEBUG] Image size: ${imageBase64.length} chars (~${Math.round(imageBase64.length * 0.75 / 1024)} KB)`);

  // Claude reads the image and returns structured JSON directly — one call, no middleman
  const { receipt, transcript, tokens: pass1Tokens } = await claudeVisionScan(imageBase64, mimeType);

  onPass2Start?.();

  const emptyPass: PassTokens = { inputTokens: 0, outputTokens: 0 };
  const tokens = calcScanCost(pass1Tokens, emptyPass);

  return { receipt, tokens, transcript };
}

/**
 * Magic Fix — called when the user taps "Magic Fix".
 * Text-only: sends the stored transcript + mismatch info to Gemini (cheap).
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

// ─── Claude Vision — single call, image → structured JSON ────────────────────

async function claudeVisionScan(
  imageBase64: string,
  mimeType: string,
): Promise<{ receipt: ParsedReceipt; transcript: string; tokens: PassTokens }> {
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
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 },
          },
          { type: 'text', text: VISION_PROMPT },
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
  const rawText: string = json.content?.[0]?.text ?? '';
  if (!rawText.trim()) throw new Error('EMPTY_RESPONSE');

  const tokens: PassTokens = {
    inputTokens:  json.usage?.input_tokens  ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };

  // Strip markdown code fences if Claude wrapped the JSON
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: ParsedReceipt & { raw_lines?: string[]; error?: string };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[DEBUG] Claude returned non-JSON:', rawText);
    throw new Error('PARSE_ERROR');
  }

  if (parsed.error) throw new Error(parsed.error);

  // raw_lines is used for the debug panel and Magic Fix transcript
  const transcript: string = Array.isArray(parsed.raw_lines)
    ? parsed.raw_lines.join('\n')
    : cleaned;

  console.log('--- [DEBUG] CLAUDE VISION: raw_lines ---', parsed.raw_lines);
  console.log('--- [DEBUG] CLAUDE VISION: structured ---', parsed);

  return { receipt: parsed, transcript, tokens };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const VISION_PROMPT = `Look at this receipt image and return a single JSON object.

READ THE IMAGE EXACTLY — character by character. You have excellent vision. Trust what you see.
- Copy every Hebrew word exactly as printed. Do NOT guess or substitute.
- If you see "סן פלגרינו" write "סן פלגרינו". If you see "לימונענע גרוס" write "לימונענע גרוס".
- If a word is genuinely unreadable, write [?].

ISRAELI RECEIPT LAYOUT (Tabit / Cafe Cafe style):
Lines read LEFT TO RIGHT. The LEFT number is the price. The right side is: quantity then item name.
  "98.00   1 עוף בצל"        →  price=98.00, qty=1, name="עוף בצל"
  "136.00  2 חומוסים סיגרה"  →  unit_price=68.00, total_price=136.00, qty=2, name="חומוסים סיגרה"
DO NOT confuse the price (left) for the quantity (right, before the name).

Sub-items / toppings appear indented or prefixed with >> or +.
Discounts have a minus: "-10.00 הנחה" → sub_item with price: -10

Return ONLY this JSON (no markdown fences, no explanation):
{
  "raw_lines": ["each item line exactly as you read it from the image"],
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
  "items": [
    {
      "name": "exact name from image",
      "quantity": 1,
      "unit_price": number | null,
      "total_price": number | null,
      "price_missing": false,
      "sub_items": []
    }
  ]
}

Rules:
- quantity defaults to 1 if not shown
- unit_price = total_price ÷ quantity
- If a price is unreadable: unit_price: null, total_price: null, price_missing: true
- confidence = "low" if any price is missing or data is ambiguous
- Ignore: restaurant header, address, phone number, loyalty text, QR codes, totals rows
- If not a receipt or unreadable: { "error": "NOT_A_RECEIPT" } or { "error": "BLURRY" }`;
