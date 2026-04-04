/**
 * Receipt scanning orchestrator — v5
 *
 * Provider-agnostic: which AI model runs each pass is driven by
 * src/config/providers.ts (env-flag switching — no code changes needed).
 *
 * ARCHITECTURE:
 *   Pass 1 (vision)  — transcribeImage()    → plain-text transcript
 *   Pass 2 (text)    — structureTranscript() → ParsedReceipt JSON
 *   Magic Fix        — magicFix()            → corrected ParsedReceipt
 *
 * To switch a provider: set VITE_PASS1_PROVIDER / VITE_PASS2_PROVIDER /
 * VITE_MAGIC_PROVIDER in .env.local and restart the dev server.
 */

import type { ParsedReceipt } from '../types/receipt.types';
import type { ProviderName } from '../types/providers';
import { type ScanTokens, calcScanCost } from '../monitoring/tokenCost';
import { PROVIDERS } from '../config/providers';
import { transcribeImage, structureTranscript, magicFix } from './llmAdapters';

// ─────────────────────────────────────────────────────────────────────────────

export type ScanResult = {
  receipt:    ParsedReceipt;
  tokens:     ScanTokens;
  transcript: string;
  autoFixed:  boolean;          // true when Pass 3 ran and reconciled the receipt
};

const MAX_SCAN_MS      = 20_000;
const MIN_MAGIC_BUDGET = 2_000;
const FALLBACK_PROVIDER: ProviderName = 'gemini-2.0-flash';

const RETRYABLE = new Set(['TOO_MANY_REQUESTS', 'HTTP_500']);

/**
 * Calls fn(primary). If it throws a retryable error AND the primary is not
 * already the fallback provider, retries once with gemini-2.0-flash.
 * Non-retryable errors (DAILY_QUOTA_EXCEEDED, BLURRY, etc.) re-throw immediately.
 */
async function callWithFallback<T>(
  fn: (provider: ProviderName) => Promise<T>,
  primary: ProviderName,
  passLabel: string,
): Promise<T> {
  try {
    return await fn(primary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isRetryable = RETRYABLE.has(msg) || msg.startsWith('TOO_MANY_REQUESTS');

    if (isRetryable && primary !== FALLBACK_PROVIDER) {
      if (import.meta.env.DEV) {
        console.warn(
          `%c[Fallback]%c ${passLabel} — ${primary} failed (${msg}). Retrying with ${FALLBACK_PROVIDER}...`,
          'color:#f97316;font-weight:bold', 'color:inherit'
        );
      }
      return fn(FALLBACK_PROVIDER);
    }
    throw err;
  }
}

interface MathValidation {
  mismatch:      boolean;
  diff:          number;
  calculatedSum: number;
}

/**
 * Checks whether the sum of item prices matches the receipt's printed subtotal.
 * Returns mismatch=false if subtotal is null (nothing to compare against).
 */
function validateReceiptMath(receipt: ParsedReceipt): MathValidation {
  if (!receipt.subtotal || receipt.subtotal <= 0) {
    return { mismatch: false, diff: 0, calculatedSum: 0 };
  }
  const calculatedSum = receipt.items.reduce(
    (sum, item) => sum + (item.total_price ?? item.unit_price ?? 0),
    0
  );
  const diff = Math.abs(calculatedSum - receipt.subtotal);
  const mismatch = diff / receipt.subtotal > 0.05;
  return { mismatch, diff, calculatedSum };
}

export async function scanReceipt(
  imageBlob: Blob,
  mimeType: string,
  onPass2Start?: () => void,
  _maxScanMsOverride?: number,   // test-only: override MAX_SCAN_MS
): Promise<ScanResult> {
  const budget    = _maxScanMsOverride ?? MAX_SCAN_MS;
  const scanStart = Date.now();
  const imageBase64 = await blobToBase64(imageBlob);

  // Pass 1 — vision OCR (with fallback)
  const { transcript, tokens: t1 } = await callWithFallback(
    (p) => transcribeImage(imageBase64, mimeType, p),
    PROVIDERS.pass1,
    'Pass 1',
  );
  if (import.meta.env.DEV) console.log(`[Pass1] provider:${PROVIDERS.pass1}\n`, transcript);

  // Brief pause — prevents per-minute rate-limit when both passes share a provider
  await new Promise(r => setTimeout(r, 1500));

  // Pass 2 — text → structured JSON (with fallback)
  onPass2Start?.();
  const { receipt: pass2Receipt, tokens: t2 } = await callWithFallback(
    (p) => structureTranscript(transcript, p),
    PROVIDERS.pass2,
    'Pass 2',
  );
  if (import.meta.env.DEV) console.log(`[Pass2] provider:${PROVIDERS.pass2}`, pass2Receipt.items);

  // Auto-Magic-Fix — fire Pass 3 if math mismatches and budget allows
  let receipt   = pass2Receipt;
  let autoFixed = false;

  const { mismatch, diff, calculatedSum } = validateReceiptMath(pass2Receipt);

  if (mismatch) {
    const elapsed   = Date.now() - scanStart;
    const remaining = budget - elapsed;

    if (remaining > MIN_MAGIC_BUDGET) {
      if (import.meta.env.DEV) {
        console.log(
          `%c[Auto-Fix]%c Mismatch detected (Diff: ₪${diff.toFixed(2)}). Triggering high-precision fix...`,
          'color:#8b5cf6;font-weight:bold', 'color:inherit'
        );
      }

      // Race Pass 3 against the remaining time budget
      const timeoutSentinel = Symbol('timeout');
      const timeoutPromise  = new Promise<typeof timeoutSentinel>(
        r => setTimeout(() => r(timeoutSentinel), remaining - 500)
      );

      const fixResult = await Promise.race([
        callWithFallback(
          (p) => magicFix(transcript, calculatedSum, pass2Receipt.subtotal!, p),
          PROVIDERS.magic,
          'Pass 3',
        ),
        timeoutPromise,
      ]);

      if (fixResult !== null && fixResult !== timeoutSentinel) {
        receipt   = fixResult as ParsedReceipt;
        autoFixed = true;
        if (import.meta.env.DEV) {
          console.log('%c[Auto-Fix]%c Success — receipt updated.', 'color:#22c55e;font-weight:bold', 'color:inherit');
        }
      } else if (fixResult === timeoutSentinel) {
        if (import.meta.env.DEV) {
          console.warn('[Auto-Fix] Timed out — returning Pass 2 result.');
        }
      }
    } else {
      if (import.meta.env.DEV) {
        console.warn(`[Auto-Fix] Skipped — scan budget exhausted (${Date.now() - scanStart}ms elapsed).`);
      }
    }
  }

  return { receipt, transcript, tokens: calcScanCost(t1, t2), autoFixed };
}

export async function geminiReVerify(
  transcript: string,
  itemsSum: number,
  printedSubtotal: number,
): Promise<ParsedReceipt | null> {
  return magicFix(transcript, itemsSum, printedSubtotal, PROVIDERS.magic);
}

// ─── Image → base64 (no preprocessing) ───────────────────────────────────────
// Raw image sent directly — preprocessing was tested and consistently made
// Hebrew letter recognition worse by mangling anti-aliased stroke edges.

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
