/**
 * Receipt scanning pipeline
 *
 * Single pass — Gemini 2.5 Flash (vision)
 *   Image → structured ParsedReceipt JSON in one call
 *   Gemini reads Hebrew thermal receipts correctly.
 *   Claude cannot — it invents plausible-sounding Hebrew food names.
 *
 * Magic Fix — Gemini 2.5 Flash (text-only, triggered by user)
 */

import type { ParsedReceipt } from '../types/receipt.types';
import { type PassTokens, type ScanTokens, calcScanCost } from '../monitoring/tokenCost';

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

  const { receipt, transcript, tokens } = await geminiVisionScan(imageBase64, mimeType);

  // fire immediately — single pass, no real phase 2
  onPass2Start?.();

  const empty: PassTokens = { inputTokens: 0, outputTokens: 0 };
  return { receipt, transcript, tokens: calcScanCost(tokens, empty) };
}

export async function geminiReVerify(
  transcript: string,
  itemsSum: number,
  printedSubtotal: number,
): Promise<ParsedReceipt | null> {
  const prompt = MAGIC_FIX_PROMPT
    .replace('{{TRANSCRIPT}}', transcript)
    .replace('{{ITEMS_SUM}}',  itemsSum.toFixed(2))
    .replace('{{TOTAL}}',      printedSubtotal.toFixed(2))
    .replace('{{DIFF}}',       Math.abs(itemsSum - printedSubtotal).toFixed(2));

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0 },
    }),
  });

  if (!res.ok) return null;
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  try {
    const p = JSON.parse(text);
    return p.error ? null : (p as ParsedReceipt);
  } catch { return null; }
}

// ─── Gemini vision scan ───────────────────────────────────────────────────────

async function geminiVisionScan(
  imageBase64: string,
  mimeType: string,
): Promise<{ receipt: ParsedReceipt; transcript: string; tokens: PassTokens }> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: VISION_PROMPT },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 }, // prevent MODEL_ABORTED on OCR tasks
      },
    }),
  });

  if (!res.ok) {
    const s = res.status;
    if (s === 429) throw new Error('TOO_MANY_REQUESTS');
    throw new Error(`HTTP_${s}`);
  }

  const json        = await res.json();
  const finishReason = json.candidates?.[0]?.finishReason ?? '';
  const text         = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

  if (!text) throw new Error(finishReason === 'OTHER' ? 'MODEL_ABORTED' : 'EMPTY_RESPONSE');

  let parsed: ParsedReceipt & { error?: string; raw_lines?: string[] };
  try   { parsed = JSON.parse(text); }
  catch { console.error('[Gemini] bad JSON:', text); throw new Error('PARSE_ERROR'); }

  if (parsed.error) throw new Error(parsed.error);

  // raw_lines is the plain text transcript for the debug panel and Magic Fix
  const transcript = Array.isArray(parsed.raw_lines)
    ? parsed.raw_lines.join('\n')
    : parsed.items.map(i => `${i.total_price ?? ''}  ${i.quantity ?? 1} ${i.name}`).join('\n');

  console.log('[Gemini] raw_lines:', parsed.raw_lines);
  console.log('[Gemini] items:', parsed.items);

  return {
    receipt: parsed,
    transcript,
    tokens: {
      inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

// ─── Image pre-processing ─────────────────────────────────────────────────────

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

const VISION_PROMPT = `You are scanning an Israeli restaurant receipt. Read every item line and return structured JSON.

RECEIPT LAYOUT (Tabit system):
Each item line has PRICE on the LEFT, then QUANTITY (1 2 3…), then ITEM NAME in Hebrew on the right.
  "98.00  1 קבב טלה"          → price=98,  qty=1, name="קבב טלה"
  "136.00 2 רוסטביף סינטה"    → price=136, qty=2, name="רוסטביף סינטה"
  "713.00 1 פריט כללי מטבח"   → price=713, qty=1, name="פריט כללי מטבח"

Copy item names EXACTLY as printed. Do not translate or paraphrase.

Return ONLY this JSON (no markdown):
{
  "raw_lines": ["exact text of each item line as read from image"],
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
      "price_missing": false,
      "sub_items": []
    }
  ]
}

- Skip: header, address, phone, totals row, tax row, QR code, loyalty text
- quantity defaults to 1
- unit_price = total_price ÷ quantity
- confidence = "low" if any price is unreadable
- Unreadable image → {"error":"BLURRY"}
- Not a receipt   → {"error":"NOT_A_RECEIPT"}`;

const MAGIC_FIX_PROMPT = `This receipt was parsed but prices don't add up.

TRANSCRIPT:
{{TRANSCRIPT}}

Items sum:     {{ITEMS_SUM}}
Printed total: {{TOTAL}}
Difference:    {{DIFF}}

Fix ONLY numeric values (prices, quantities). Do not change any item name.
Common causes: decimal comma vs dot, skipped line, merged prices, wrong discount sign.

Return corrected JSON (no markdown):
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
