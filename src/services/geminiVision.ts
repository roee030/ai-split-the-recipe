/**
 * Receipt scanning pipeline
 *
 * Pass 1 — Claude claude-sonnet-4-5 (vision)
 *   Image → raw line-by-line transcript
 *
 * Pass 2 — Gemini 2.5 Flash (text-only, free tier)
 *   Transcript → structured ParsedReceipt JSON
 *
 * Magic Fix — Gemini 2.5 Flash (text-only)
 *   Called only when user taps "Magic Fix" on a price mismatch
 */

import type { ParsedReceipt } from '../types/receipt.types';
import { type PassTokens, type ScanTokens, calcScanCost } from '../monitoring/tokenCost';

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string;
const CLAUDE_URL    = 'https://api.anthropic.com/v1/messages';

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

// ─────────────────────────────────────────────────────────────────────────────

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
  const imageBase64 = await darkroom(imageBlob);

  const { transcript, tokens: t1 } = await pass1_ocr(imageBase64, mimeType);
  onPass2Start?.();
  const { receipt,    tokens: t2 } = await pass2_structure(transcript);

  return { receipt, tokens: calcScanCost(t1, t2), transcript };
}

export async function geminiReVerify(
  transcript: string,
  itemsSum: number,
  printedSubtotal: number,
): Promise<ParsedReceipt | null> {
  const body = MAGIC_FIX_PROMPT
    .replace('{{TRANSCRIPT}}',  transcript)
    .replace('{{ITEMS_SUM}}',   itemsSum.toFixed(2))
    .replace('{{TOTAL}}',       printedSubtotal.toFixed(2))
    .replace('{{DIFF}}',        Math.abs(itemsSum - printedSubtotal).toFixed(2));

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: body }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0 },
    }),
  });

  if (!res.ok) return null;
  const json = await res.json();
  const text  = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  try {
    const parsed = JSON.parse(text);
    return parsed.error ? null : (parsed as ParsedReceipt);
  } catch { return null; }
}

// ─── Pass 1: Claude vision → transcript ──────────────────────────────────────

async function pass1_ocr(
  imageBase64: string,
  mimeType: string,
): Promise<{ transcript: string; tokens: PassTokens }> {
  const res = await fetch(CLAUDE_URL, {
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
        { type: 'text',  text: OCR_PROMPT },
      ]}],
    }),
  });

  if (!res.ok) {
    const s = res.status;
    if (s === 429) throw new Error('TOO_MANY_REQUESTS');
    if (s === 401) throw new Error('ANTHROPIC_AUTH_ERROR');
    throw new Error(`HTTP_${s}`);
  }

  const json = await res.json();
  const text = (json.content?.[0]?.text ?? '').trim();
  if (!text) throw new Error('EMPTY_RESPONSE');

  // Detect error sentinels from the prompt
  if (text.startsWith('{')) {
    try {
      const e = JSON.parse(text);
      if (e.error) throw new Error(e.error as string);
    } catch (err) {
      if (err instanceof Error && ['BLURRY','LOW_LIGHT','NOT_A_RECEIPT'].includes(err.message))
        throw err;
    }
  }

  console.log('[OCR] transcript:\n' + text);
  return {
    transcript: text,
    tokens: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
  };
}

// ─── Pass 2: Gemini text → JSON ───────────────────────────────────────────────

async function pass2_structure(
  transcript: string,
): Promise<{ receipt: ParsedReceipt; tokens: PassTokens }> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: STRUCTURE_PROMPT + '\n\n---\n' + transcript }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0 },
    }),
  });

  if (!res.ok) {
    const s = res.status;
    if (s === 429) throw new Error('TOO_MANY_REQUESTS');
    throw new Error(`HTTP_${s}`);
  }

  const json   = await res.json();
  const text   = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  if (!text) throw new Error('EMPTY_RESPONSE');

  let parsed: ParsedReceipt & { error?: string };
  try   { parsed = JSON.parse(text); }
  catch { console.error('[Structure] bad JSON:', text); throw new Error('PARSE_ERROR'); }

  if (parsed.error) throw new Error(parsed.error);

  console.log('[Structure] result:', parsed);
  return {
    receipt: parsed,
    tokens: {
      inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

// ─── Image pre-processing ─────────────────────────────────────────────────────
// Grayscale + high contrast → thermal paper becomes pure white, ink pure black.

async function darkroom(blob: Blob): Promise<string> {
  const img    = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width  = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'grayscale(100%) contrast(200%)';
  ctx.drawImage(img, 0, 0);

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) { reject(new Error('DARKROOM_FAILED')); return; }
      const reader = new FileReader();
      reader.onload  = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(b);
    }, 'image/png');
  });
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

/**
 * Pass 1 — given to Claude with the receipt image.
 * Goal: get a faithful line-by-line copy of what is printed.
 * Claude is a language model — we cannot switch off its Hebrew knowledge.
 * Instead we constrain the OUTPUT FORMAT so tightly that it can only copy.
 */
const OCR_PROMPT = `Look at this receipt image and copy every item line exactly as printed.

Output format — one line per item, nothing else:
  <price>  <qty> <name as printed>

Examples:
  18.00  1 כוסות מזיגה
  136.00 2 חומוסים סיגרה
  713.00 1 פירות מלך הפטה

Rules:
- Price is the number on the LEFT of each line.
- Qty is the single digit (1 2 3 …) that follows.
- Name is everything to the RIGHT of the qty — copy it character-for-character.
- If you cannot read a word clearly, write it as best you can followed by [?].
- Skip: restaurant name, address, phone, grand total, tax, QR code.

If the image is too dark or blurry to read: {"error":"BLURRY"}
If it is not a receipt: {"error":"NOT_A_RECEIPT"}`;

/**
 * Pass 2 — given to Gemini with the transcript text.
 * Goal: parse the lines into structured JSON.
 * Field names match ParsedReceipt exactly (camelCase where required).
 */
const STRUCTURE_PROMPT = `Convert this receipt transcript into JSON.

CRITICAL: copy every item name VERBATIM from the transcript. Do not fix, translate, or change any word.

Each transcript line is:  PRICE  QTY  NAME
  "98.00  1 עקרב ופטריות"  → total_price=98, quantity=1, name="עקרב ופטריות"
  "136.00 2 חומוסים סיגרה" → unit_price=68, total_price=136, quantity=2, name="חומוסים סיגרה"

- Indented lines / lines starting with + or >> are sub-items of the item above them.
- Lines starting with - are discounts (negative sub-item price).
- Total / tax / service lines → top-level fields, NOT items.
- Numbers: "25,90" → 25.90  |  strip ₪$€  |  "1,250.00" → 1250

Return ONLY this JSON (no markdown):
{
  "isReceipt": true,
  "receipt_type": "restaurant",
  "restaurantName": string | null,
  "currency": "ILS",
  "subtotal": number | null,
  "tax": number | null,
  "taxPercent": number | null,
  "serviceCharge": number | null,
  "total": number | null,
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

- quantity defaults to 1 if not shown
- unit_price = total_price ÷ quantity
- unreadable price → unit_price: null, total_price: null, price_missing: true
- confidence = "low" if any price is missing or data looks incomplete
- No items found → { "error": "NO_ITEMS_FOUND" }`;

/**
 * Magic Fix — sent to Gemini when item prices don't add up.
 * May only fix numbers. Must never rename items.
 */
const MAGIC_FIX_PROMPT = `This receipt transcript was parsed but prices don't add up.

TRANSCRIPT:
{{TRANSCRIPT}}

Items sum:      {{ITEMS_SUM}}
Printed total:  {{TOTAL}}
Difference:     {{DIFF}}

Fix ONLY the numeric values (prices, quantities). Do not change any item name.
Common causes: comma vs dot decimal, skipped line, merged prices, wrong discount sign.

Return the corrected full JSON in the same schema as before (no markdown):
{
  "isReceipt": true,
  "receipt_type": "restaurant",
  "restaurantName": string | null,
  "currency": "ILS",
  "subtotal": number | null,
  "tax": number | null,
  "taxPercent": number | null,
  "serviceCharge": number | null,
  "total": number | null,
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
