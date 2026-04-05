/**
 * Gemini API adapter.
 * Handles all HTTP calls to the Gemini generativelanguage API.
 */

import type { ParsedReceipt } from '../../types/receipt.types';
import type { ProviderName } from '../../types/providers';
import type { PassTokens } from '../../monitoring/tokenCost';
import { TRANSCRIPT_PROMPT } from './prompts';
import { parseReceiptJSON, applyAutoCorrections } from './receiptJsonParser';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

export function geminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
}

export function geminiModelName(provider: ProviderName): string {
  switch (provider) {
    case 'gemini-3.1-flash-lite-preview': return 'gemini-3.1-flash-lite-preview';
    case 'gemini-2.5-flash':              return 'gemini-2.5-flash';
    case 'gemini-1.5-flash':              return 'gemini-1.5-flash';
    case 'gemini-2.0-flash-lite':         return 'gemini-2.0-flash-lite';
    case 'gemini-2.0-flash':
    default:                              return 'gemini-2.0-flash';
  }
}

export async function geminiParseQuotaError(res: Response): Promise<never> {
  try {
    const body = await res.json();
    const violations: Array<{ quotaId?: string }> =
      body?.error?.details?.find((d: Record<string, unknown>) =>
        d['@type']?.toString().includes('QuotaFailure')
      )?.violations ?? [];
    const isDaily = violations.some(v => v.quotaId?.includes('PerDay'));
    const delay   = body?.error?.details?.find(
      (d: Record<string, unknown>) => d.retryDelay
    )?.retryDelay as string | undefined;
    throw new Error(
      isDaily ? 'DAILY_QUOTA_EXCEEDED'
      : delay  ? `TOO_MANY_REQUESTS:${delay}`
      :          'TOO_MANY_REQUESTS'
    );
  } catch (e) {
    if (e instanceof Error &&
       (e.message.startsWith('TOO_MANY_REQUESTS') || e.message === 'DAILY_QUOTA_EXCEEDED')) throw e;
    throw new Error('TOO_MANY_REQUESTS');
  }
}

// ─── Pass 1: transcribe ───────────────────────────────────────────────────────

export async function geminiTranscribe(
  imageBase64: string,
  mimeType: string,
  model: string,
): Promise<{ transcript: string; tokens: PassTokens }> {
  const res = await fetch(geminiUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: TRANSCRIPT_PROMPT },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    if (res.status === 429) await geminiParseQuotaError(res);
    throw new Error(`HTTP_${res.status}`);
  }

  const json         = await res.json();
  const finishReason = json.candidates?.[0]?.finishReason ?? '';
  const text         = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

  if (!text) throw new Error(finishReason === 'MAX_TOKENS' ? 'BLURRY' : finishReason === 'OTHER' ? 'MODEL_ABORTED' : 'EMPTY_RESPONSE');
  if (text.startsWith('NOT_A_RECEIPT')) throw new Error('NOT_A_RECEIPT');
  if (text.startsWith('BLURRY'))        throw new Error('BLURRY');

  const words    = text.split(/\s+/);
  const unknowns = words.filter((w: string) => w === '[?]').length;
  if (unknowns / words.length > 0.5) throw new Error('BLURRY');

  return {
    transcript: text,
    tokens: {
      inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

// ─── Pass 2: structure ────────────────────────────────────────────────────────

export async function geminiStructure(
  prompt: string,
  model: string,
): Promise<{ receipt: ParsedReceipt; tokens: PassTokens }> {
  const res = await fetch(geminiUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    if (res.status === 429) await geminiParseQuotaError(res);
    throw new Error(`HTTP_${res.status}`);
  }

  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  if (!text) throw new Error('EMPTY_RESPONSE');

  return {
    receipt: applyAutoCorrections(parseReceiptJSON(text)),
    tokens: {
      inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

// ─── Pass 3: magic fix ────────────────────────────────────────────────────────

export async function geminiMagicFix(
  prompt: string,
  model: string,
): Promise<ParsedReceipt | null> {
  const res = await fetch(geminiUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  const p = JSON.parse(text);
  return p.error ? null : applyAutoCorrections(p as ParsedReceipt);
}

