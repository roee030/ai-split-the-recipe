# Monitoring & Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full observability to SplitSnap — Sentry for errors, PostHog for product analytics and session replay, with per-scan Gemini token cost tracking.

**Architecture:** A thin `src/monitoring/` facade is the only thing components ever import. `sentry.ts` and `posthog.ts` hold all vendor-specific init code. `geminiVision.ts` extracts `usageMetadata` from both Gemini passes and returns `ScanResult` (receipt + tokens). Components call `monitoring.track(...)` with token data attached.

**Tech Stack:** `@sentry/react`, `posthog-js`, typed event schema in `events.ts`, pure cost calculator in `tokenCost.ts`

**Reference design:** `docs/plans/2026-04-02-monitoring-design.md`

---

## Task 1: Install packages

**Files:**
- Modify: `package.json` (via npm install)

**Step 1: Install Sentry and PostHog**

```bash
npm install @sentry/react posthog-js --legacy-peer-deps
```

**Step 2: Verify they appear in package.json**

```bash
grep -E "sentry|posthog" package.json
```

Expected output includes `"@sentry/react"` and `"posthog-js"`.

**Step 3: Build to make sure nothing broke**

```bash
npm run build
```

Expected: clean build.

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install @sentry/react and posthog-js"
```

---

## Task 2: Token cost calculator

**Files:**
- Create: `src/monitoring/tokenCost.ts`
- Create: `src/monitoring/__tests__/tokenCost.test.ts`

**Step 1: Write the failing tests**

Create `src/monitoring/__tests__/tokenCost.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calcScanCost } from '../tokenCost';

describe('calcScanCost', () => {
  it('sums tokens from both passes', () => {
    const result = calcScanCost(
      { inputTokens: 1000, outputTokens: 200 },
      { inputTokens: 500, outputTokens: 800 }
    );
    expect(result.totalInputTokens).toBe(1500);
    expect(result.totalOutputTokens).toBe(1000);
  });

  it('calculates cost with separate input/output rates', () => {
    // 1M input = $0.075, 1M output = $0.30
    const result = calcScanCost(
      { inputTokens: 1_000_000, outputTokens: 0 },
      { inputTokens: 0, outputTokens: 0 }
    );
    expect(result.estimatedCostUSD).toBeCloseTo(0.075, 6);
  });

  it('charges output at 4x the input rate', () => {
    const inputResult = calcScanCost(
      { inputTokens: 1000, outputTokens: 0 },
      { inputTokens: 0, outputTokens: 0 }
    );
    const outputResult = calcScanCost(
      { inputTokens: 0, outputTokens: 0 },
      { inputTokens: 0, outputTokens: 1000 }
    );
    expect(outputResult.estimatedCostUSD / inputResult.estimatedCostUSD).toBeCloseTo(4, 1);
  });

  it('preserves pass-level token breakdown', () => {
    const p1 = { inputTokens: 100, outputTokens: 50 };
    const p2 = { inputTokens: 200, outputTokens: 300 };
    const result = calcScanCost(p1, p2);
    expect(result.pass1).toEqual(p1);
    expect(result.pass2).toEqual(p2);
  });

  it('returns zero cost for zero tokens', () => {
    const result = calcScanCost(
      { inputTokens: 0, outputTokens: 0 },
      { inputTokens: 0, outputTokens: 0 }
    );
    expect(result.estimatedCostUSD).toBe(0);
  });
});
```

**Step 2: Run to verify they fail**

```bash
npm test -- src/monitoring/__tests__/tokenCost.test.ts
```

Expected: FAIL — `Cannot find module '../tokenCost'`

**Step 3: Implement `tokenCost.ts`**

Create `src/monitoring/tokenCost.ts`:

```typescript
export interface PassTokens {
  inputTokens: number;   // promptTokenCount from Gemini usageMetadata
  outputTokens: number;  // candidatesTokenCount from Gemini usageMetadata
}

export interface ScanTokens {
  pass1: PassTokens;
  pass2: PassTokens;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUSD: number;
}

// Gemini 2.5 Flash pricing (April 2026)
const INPUT_COST_PER_TOKEN  = 0.075 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 0.30  / 1_000_000;

export function calcScanCost(pass1: PassTokens, pass2: PassTokens): ScanTokens {
  const totalInputTokens  = pass1.inputTokens  + pass2.inputTokens;
  const totalOutputTokens = pass1.outputTokens + pass2.outputTokens;
  const estimatedCostUSD  =
    totalInputTokens  * INPUT_COST_PER_TOKEN +
    totalOutputTokens * OUTPUT_COST_PER_TOKEN;

  return { pass1, pass2, totalInputTokens, totalOutputTokens, estimatedCostUSD };
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- src/monitoring/__tests__/tokenCost.test.ts
```

Expected: 5 tests PASS.

**Step 5: Commit**

```bash
git add src/monitoring/tokenCost.ts src/monitoring/__tests__/tokenCost.test.ts
git commit -m "feat: add token cost calculator for Gemini 2.5 Flash"
```

---

## Task 3: Typed event schema

**Files:**
- Create: `src/monitoring/events.ts`

No tests needed — this is pure TypeScript types. Correctness is enforced at every call site by the compiler.

**Step 1: Create `src/monitoring/events.ts`**

```typescript
// All PostHog event names and their required properties.
// TypeScript enforces correct properties at every monitoring.track() call.

export type MonitoringEvent =
  | 'scan_started'
  | 'scan_ocr_completed'
  | 'scan_completed'
  | 'scan_failed'
  | 'scan_retried'
  | 'item_manually_edited'
  | 'item_added_manually'
  | 'item_deleted'
  | 'screen_viewed'
  | 'split_completed'
  | 'summary_shared'
  | 'sign_in_completed'
  | 'sign_out'
  | 'paywall_shown'
  | 'paywall_converted';

export interface EventProperties {
  scan_started: {
    source: 'camera' | 'upload';
  };
  scan_ocr_completed: {
    pass1_input_tokens: number;
    pass1_output_tokens: number;
  };
  scan_completed: {
    receipt_type: string;
    item_count: number;
    confidence: string;
    pass1_input_tokens: number;
    pass1_output_tokens: number;
    pass2_input_tokens: number;
    pass2_output_tokens: number;
    total_input_tokens: number;
    total_output_tokens: number;
    estimated_cost_usd: number;
  };
  scan_failed: {
    error_code: string;
    failed_pass: 1 | 2;
    total_input_tokens: number;
    total_output_tokens: number;
    estimated_cost_usd: number;
  };
  scan_retried: {
    previous_error_code: string;
  };
  item_manually_edited: {
    field: 'name' | 'price' | 'quantity';
    receipt_type: string;
    confidence: string;
  };
  item_added_manually: {
    receipt_type: string;
  };
  item_deleted: {
    receipt_type: string;
  };
  screen_viewed: {
    screen: string;
  };
  split_completed: {
    person_count: number;
    item_count: number;
    has_tip: boolean;
    tip_percent: number;
    currency: string;
    receipt_type: string;
  };
  summary_shared: {
    method: 'native' | 'clipboard';
  };
  sign_in_completed: {
    method: 'google' | 'email';
  };
  sign_out: Record<string, never>;
  paywall_shown: {
    scans_used: number;
  };
  paywall_converted: Record<string, never>;
}
```

**Step 2: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: clean build.

**Step 3: Commit**

```bash
git add src/monitoring/events.ts
git commit -m "feat: add typed monitoring event schema"
```

---

## Task 4: Sentry module

**Files:**
- Create: `src/monitoring/sentry.ts`

**Step 1: Create `src/monitoring/sentry.ts`**

```typescript
import * as Sentry from '@sentry/react';

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return; // no-op in local dev if DSN not set

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE, // 'development' | 'production'
    tracesSampleRate: 0.2,             // 20% of transactions for performance
    replaysOnErrorSampleRate: 1.0,     // full replay on every error
    sendDefaultPii: false,             // no cookies, no IPs
    integrations: [
      Sentry.replayIntegration({
        maskAllInputs: true,           // mask all <input> fields in replay
        maskAllText: false,
      }),
    ],
  });
}

export function sentryCapture(err: Error, ctx?: Record<string, unknown>): void {
  Sentry.withScope((scope) => {
    if (ctx) scope.setExtras(ctx);
    Sentry.captureException(err);
  });
}

export function sentryIdentify(userId: string, email?: string): void {
  Sentry.setUser({ id: userId, email });
}

export function sentryReset(): void {
  Sentry.setUser(null);
}
```

**Step 2: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: clean build.

**Step 3: Commit**

```bash
git add src/monitoring/sentry.ts
git commit -m "feat: add Sentry module"
```

---

## Task 5: PostHog module

**Files:**
- Create: `src/monitoring/posthog.ts`

**Step 1: Create `src/monitoring/posthog.ts`**

```typescript
import posthog from 'posthog-js';
import type { MonitoringEvent, EventProperties } from './events';

export function initPostHog(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return; // no-op in local dev if key not set

  posthog.init(key, {
    api_host: 'https://app.posthog.com',
    capture_pageview: false,             // we fire $pageview manually via monitoring.page()
    session_recording: {
      maskAllInputs: true,               // mask input fields in session replay
    },
    enable_recording_console_log: true,
  });
}

export function posthogTrack<E extends MonitoringEvent>(
  event: E,
  props: EventProperties[E]
): void {
  posthog.capture(event, props as Record<string, unknown>);
}

export function posthogIdentify(
  userId: string,
  traits?: { email?: string; isPremium?: boolean }
): void {
  posthog.identify(userId, traits);
}

export function posthogReset(): void {
  posthog.reset();
}

export function posthogPage(screen: string): void {
  posthog.capture('$pageview', { screen });
}
```

**Step 2: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: clean build.

**Step 3: Commit**

```bash
git add src/monitoring/posthog.ts
git commit -m "feat: add PostHog module"
```

---

## Task 6: Monitoring facade

**Files:**
- Create: `src/monitoring/index.ts`

This is the ONLY file components ever import from. It wires Sentry and PostHog together behind a single API.

**Step 1: Create `src/monitoring/index.ts`**

```typescript
import { sentryCapture, sentryIdentify, sentryReset } from './sentry';
import { posthogTrack, posthogIdentify, posthogReset, posthogPage } from './posthog';
import type { MonitoringEvent, EventProperties } from './events';

export type { MonitoringEvent, EventProperties };

export const monitoring = {
  /**
   * Report an exception to Sentry with optional structured context.
   * Call this in every catch block that currently silently swallows errors.
   */
  captureError(err: Error, ctx?: Record<string, unknown>): void {
    sentryCapture(err, ctx);
  },

  /**
   * Send a typed product event to PostHog.
   * TypeScript enforces that props match the event name.
   */
  track<E extends MonitoringEvent>(event: E, props: EventProperties[E]): void {
    posthogTrack(event, props);
  },

  /**
   * Associate a signed-in user with both Sentry and PostHog.
   * Call on Firebase auth state change when user is non-null.
   */
  identify(userId: string, traits?: { email?: string; isPremium?: boolean }): void {
    sentryIdentify(userId, traits?.email);
    posthogIdentify(userId, traits);
  },

  /**
   * Clear user identity in both vendors on sign-out.
   */
  reset(): void {
    sentryReset();
    posthogReset();
  },

  /**
   * Record a screen navigation as a PostHog $pageview.
   * Call whenever the active screen changes.
   */
  page(screen: string): void {
    posthogPage(screen);
  },
};
```

**Step 2: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: clean build.

**Step 3: Commit**

```bash
git add src/monitoring/index.ts
git commit -m "feat: add monitoring facade (Sentry + PostHog)"
```

---

## Task 7: Initialize monitoring in main.tsx

**Files:**
- Modify: `src/main.tsx`

**Step 1: Update `src/main.tsx`**

Add `initSentry` and `initPostHog` imports and call them **before** `ReactDOM.createRoot`. They must fire before any React component renders.

```typescript
import './i18n';
import { initSentry } from './monitoring/sentry';
import { initPostHog } from './monitoring/posthog';
import ReactDOM from 'react-dom/client';
// ... rest of existing imports unchanged ...

// Initialize monitoring before React renders
initSentry();
initPostHog();

ReactDOM.createRoot(document.getElementById('root')!).render(
  // ... existing JSX unchanged ...
);
```

**Step 2: Build**

```bash
npm run build
```

Expected: clean build.

**Step 3: Commit**

```bash
git add src/main.tsx
git commit -m "feat: initialize Sentry and PostHog on app boot"
```

---

## Task 8: Update geminiVision.ts to return token data

**Files:**
- Modify: `src/services/geminiVision.ts`
- Modify: `src/types/receipt.types.ts` (add `ScanResult`)

**Step 1: Check what `receipt.types.ts` exports**

Read `src/types/receipt.types.ts` to see existing exports. Add `ScanResult` at the bottom.

**Step 2: Add `ScanResult` to `src/types/receipt.types.ts`**

Open `src/types/receipt.types.ts` and add at the bottom:

```typescript
import type { ScanTokens } from '../monitoring/tokenCost';

export interface ScanResult {
  receipt: ParsedReceipt;
  tokens: ScanTokens;
}
```

**Step 3: Rewrite `src/services/geminiVision.ts`**

The key changes:
1. Both `geminiOCR` and `geminiStructure` extract `usageMetadata` and return `PassTokens` alongside their primary output.
2. `scanReceipt` aggregates both and returns `ScanResult`.

```typescript
import type { ParsedReceipt, ScanResult } from '../types/receipt.types';
import { type PassTokens, calcScanCost } from '../monitoring/tokenCost';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

export async function scanReceipt(
  imageBlob: Blob,
  mimeType: string
): Promise<ScanResult> {
  const imageBase64 = await blobToBase64(imageBlob);

  // Pass 1: OCR
  const { transcript, tokens: pass1Tokens } = await geminiOCR(imageBase64, mimeType);

  // Pass 2: Structure
  const { receipt, tokens: pass2Tokens } = await geminiStructure(transcript);

  return {
    receipt,
    tokens: calcScanCost(pass1Tokens, pass2Tokens),
  };
}

async function geminiOCR(
  imageBase64: string,
  mimeType: string
): Promise<{ transcript: string; tokens: PassTokens }> {
  const response = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: OCR_PROMPT },
        ],
      }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0 },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) throw new Error('TOO_MANY_REQUESTS');
    throw new Error(`HTTP_${status}`);
  }

  const json = await response.json();
  const tokens: PassTokens = {
    inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  };

  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text.trim()) throw new Error('EMPTY_RESPONSE');

  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (parsed.error) throw new Error(parsed.error as string);
  }

  return { transcript: trimmed, tokens };
}

async function geminiStructure(
  transcript: string
): Promise<{ receipt: ParsedReceipt; tokens: PassTokens }> {
  const response = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${STRUCTURE_PROMPT}\n\n---RECEIPT TRANSCRIPT---\n${transcript}` }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.1,
      },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) throw new Error('TOO_MANY_REQUESTS');
    throw new Error(`HTTP_${status}`);
  }

  const json = await response.json();
  const tokens: PassTokens = {
    inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('EMPTY_RESPONSE');

  const parsed = JSON.parse(text);
  if (parsed.error) throw new Error(parsed.error as string);

  return { receipt: parsed as ParsedReceipt, tokens };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const OCR_PROMPT = `Act as a high-precision OCR engine. Your goal is to transcribe this receipt image into raw text.

- List every line exactly as printed
- Keep item and price on the same line (preserve horizontal relationships)
- Preserve prefixes like -, +, or 'points' which indicate discounts or sub-items
- Preserve the original language and script (Hebrew, Arabic, Chinese, etc.)
- Do NOT translate or interpret — transcribe only

If the image quality prevents accurate reading, return ONLY one of these JSON objects:
{ "error": "BLURRY" }
{ "error": "CROPPED" }
{ "error": "LOW_LIGHT" }
{ "error": "OCCLUDED" }
{ "error": "NOT_A_RECEIPT" }

Otherwise return the raw transcript as plain text (no JSON, no formatting).`;

const STRUCTURE_PROMPT = `Below is a raw text transcript of a receipt. Convert it into a JSON object.

Item types:
- MAIN: a chargeable item or dish with its own price
- SUB_ITEM: an extra, modifier, or discount belonging to the MAIN above (indented, starts with +/-)
- NOTE: a modifier with no price
- RECEIPT_TOTAL / TAX / SERVICE: totals and charges
- NOISE: ads, phone numbers, loyalty text — ignore completely

For each MAIN item, collect following SUB_ITEM/NOTE lines into sub_items until the next MAIN.

Output JSON schema (respond with ONLY the JSON, no markdown):
{
  "receipt_type": "grocery" | "restaurant" | "gas" | "other",
  "restaurant_name": string | null,
  "currency": string (ISO 4217 code),
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
- quantity defaults to 1 if not shown
- total_price = unit_price × quantity (before sub_items)
- confidence = "low" if data seems incomplete or ambiguous
- If no items can be extracted: { "error": "NO_ITEMS_FOUND" }`;
```

**Step 4: Build**

```bash
npm run build
```

This will surface TypeScript errors in `HomeScreen.tsx` because `scanReceipt` now returns `ScanResult` instead of `ParsedReceipt`. That's expected — fix in next task.

**Step 5: Commit**

```bash
git add src/services/geminiVision.ts src/types/receipt.types.ts
git commit -m "feat: extract Gemini token usage from both OCR and structure passes"
```

---

## Task 9: Wire monitoring into HomeScreen

**Files:**
- Modify: `src/screens/HomeScreen.tsx`

This is the most important integration point. The scan flow is where all token data flows through.

The current `doScan` function at line ~45 calls `scanReceipt(blob, mimeType)` which now returns `ScanResult`. Update it to destructure `{ receipt, tokens }` and fire all scan-related events.

Additionally:
- `scan_started` fires when the user confirms the photo (in `handleConfirmScan`)
- `scan_retried` fires when user taps Retake after a failure
- The `previous_error_code` for `scan_retried` comes from the last `scanError` value

**Step 1: Update `src/screens/HomeScreen.tsx`**

Add import at the top:
```typescript
import { monitoring } from '../monitoring';
```

Add `lastErrorCode` ref to track the last error for `scan_retried`:
```typescript
const lastErrorCodeRef = useRef<string>('');
```

Update `handleConfirmScan` to fire `scan_started`:
```typescript
function handleConfirmScan() {
  if (!capturedFile) return;
  setStage('home');
  monitoring.track('scan_started', { source: 'camera' }); // or 'upload' — see note below
  handleFile(capturedFile);
  setCapturedFile(null);
  if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
}
```

Note: To distinguish camera vs upload, track which input triggered the preview. Add a `sourceRef`:
```typescript
const sourceRef = useRef<'camera' | 'upload'>('camera');
```

Set it in `handleCameraChange`: `sourceRef.current = 'camera'`
Set it in `handleUploadChange`: `sourceRef.current = 'upload'`

Then in `handleConfirmScan`: `monitoring.track('scan_started', { source: sourceRef.current })`

Update `handleRetake` to fire `scan_retried`:
```typescript
function handleRetake() {
  if (lastErrorCodeRef.current) {
    monitoring.track('scan_retried', { previous_error_code: lastErrorCodeRef.current });
  }
  // ... existing retake logic unchanged
}
```

Update `doScan` to destructure `ScanResult` and fire events:
```typescript
async function doScan(file: File) {
  if (scanningRef.current) return;
  scanningRef.current = true;
  setScanCooldown(10);
  incrementLocalScansUsed();
  setScanError(null);
  setScreen('processing');
  try {
    const { blob, mimeType } = await prepareImage(file);
    const { receipt, tokens } = await scanReceipt(blob, mimeType);

    monitoring.track('scan_completed', {
      receipt_type: receipt.receipt_type ?? 'other',
      item_count: receipt.items?.length ?? 0,
      confidence: receipt.confidence ?? 'low',
      pass1_input_tokens:   tokens.pass1.inputTokens,
      pass1_output_tokens:  tokens.pass1.outputTokens,
      pass2_input_tokens:   tokens.pass2.inputTokens,
      pass2_output_tokens:  tokens.pass2.outputTokens,
      total_input_tokens:   tokens.totalInputTokens,
      total_output_tokens:  tokens.totalOutputTokens,
      estimated_cost_usd:   tokens.estimatedCostUSD,
    });
    lastErrorCodeRef.current = '';

    const items = parseReceiptToItems(receipt);
    setReceiptData(items, {
      restaurantName: receipt.restaurantName,
      tax: receipt.currency === 'ILS' ? 0 : (receipt.tax ?? 0),
      serviceCharge: receipt.serviceCharge ?? 0,
      currency: receipt.currency ?? 'ILS',
      subtotal: receipt.subtotal ?? null,
      scanConfidence: receipt.confidence ?? null,
    });
    setScreen('review');
  } catch (err) {
    const raw = err instanceof Error ? err.message : '';
    lastErrorCodeRef.current = raw;

    // Determine which pass failed (pass 2 errors don't include image quality codes)
    const isPass1Error = ['BLURRY','CROPPED','LOW_LIGHT','OCCLUDED','NOT_A_RECEIPT'].includes(raw);
    monitoring.track('scan_failed', {
      error_code: raw || 'UNKNOWN',
      failed_pass: isPass1Error ? 1 : 2,
      // Tokens consumed before failure (0 if pass 1 failed immediately)
      total_input_tokens: 0,
      total_output_tokens: 0,
      estimated_cost_usd: 0,
    });
    monitoring.captureError(err instanceof Error ? err : new Error(raw), { error_code: raw });

    let message: string | null = null;
    if (raw.includes('BLURRY')) {
      message = "The photo came out a bit blurry. Try holding the phone steadier and shoot again.";
    } else if (raw.includes('CROPPED')) {
      message = "Part of the receipt looks cut off. Make sure all edges are in frame.";
    } else if (raw.includes('LOW_LIGHT')) {
      message = "It's too dark here. Try turning on a light or using flash.";
    } else if (raw.includes('OCCLUDED')) {
      message = "Something is covering the text. Try shooting again with the receipt fully exposed.";
    } else if (raw.includes('NOT_A_RECEIPT')) {
      message = "We couldn't identify a receipt here. Make sure you're photographing a clear bill or receipt.";
    } else if (raw.includes('NO_ITEMS_FOUND')) {
      message = "We couldn't find any items. Try a better-lit photo.";
    } else if (raw.includes('SCAN_LIMIT_REACHED')) {
      setReceiptData([], {});
      setScreen('home');
      setShowPaywall(true);
      return;
    } else if (raw.includes('TOO_MANY_REQUESTS') || raw.includes('429')) {
      message = 'Please wait a moment before scanning again.';
    } else {
      message = "Something went wrong. Please try again.";
    }
    setScanError(message);
    setReceiptData([], {});
    setScreen('home');
  } finally {
    scanningRef.current = false;
  }
}
```

**Step 2: Build**

```bash
npm run build
```

Expected: clean build.

**Step 3: Commit**

```bash
git add src/screens/HomeScreen.tsx
git commit -m "feat: track scan_started, scan_completed, scan_failed, scan_retried with token data"
```

---

## Task 10: Wire monitoring into ReviewScreen

**Files:**
- Modify: `src/screens/ReviewScreen.tsx`

Track item edits as the ground-truth signal for prompt quality. The existing `updateItem` calls are at:
- Name input `onChange` (line ~169): `updateItem(item.id, { name: e.target.value })`
- Quantity input `onChange` (line ~187): `updateItem(item.id, { quantity: ... })`
- Price input `onChange` (line ~199): `updateItem(item.id, { unitPrice: ... })`

We only want to fire `item_manually_edited` once per field per item (on blur / save, not on every keystroke). The `setEditingId(null)` call marks when the user is "done" editing — fire the event then.

**Step 1: Update `src/screens/ReviewScreen.tsx`**

Add import:
```typescript
import { monitoring } from '../monitoring';
```

Track which fields were changed during an edit session using a ref:
```typescript
const editedFieldsRef = useRef<Set<'name' | 'price' | 'quantity'>>(new Set());
```

Reset it when editing starts:
```typescript
// In the Edit button onClick:
onClick={() => {
  setEditingId(item.id);
  editedFieldsRef.current = new Set();
}}
```

Mark fields as edited in the onChange handlers:
```typescript
// Name input onChange:
onChange={(e) => {
  editedFieldsRef.current.add('name');
  updateItem(item.id, { name: e.target.value });
}}

// Quantity input onChange:
onChange={(e) => {
  const q = Number(e.target.value) || 1;
  editedFieldsRef.current.add('quantity');
  updateItem(item.id, { quantity: q, totalPrice: item.unitPrice * q });
}}

// Price input onChange:
onChange={(e) => {
  const p = Number(e.target.value) || 0;
  editedFieldsRef.current.add('price');
  updateItem(item.id, { unitPrice: p, totalPrice: p * item.quantity });
}}
```

Fire the event when editing is saved (the "Done" button and Enter key both call `setEditingId(null)`):
```typescript
function handleSaveEdit() {
  for (const field of editedFieldsRef.current) {
    monitoring.track('item_manually_edited', {
      field,
      receipt_type: session.scanConfidence ? 'scanned' : 'manual',
      confidence: session.scanConfidence ?? 'none',
    });
  }
  editedFieldsRef.current = new Set();
  setEditingId(null);
}
```

Replace all `setEditingId(null)` calls in the edit form with `handleSaveEdit()`.

Track manual add and delete:
```typescript
// In handleAddManual:
function handleAddManual() {
  const item = createManualItem();
  addItem(item);
  setEditingId(item.id);
  monitoring.track('item_added_manually', {
    receipt_type: session.scanConfidence ? 'scanned' : 'manual',
  });
}

// In the delete button onClick:
onClick={() => {
  deleteItem(item.id);
  monitoring.track('item_deleted', {
    receipt_type: session.scanConfidence ? 'scanned' : 'manual',
  });
}}
```

**Step 2: Build**

```bash
npm run build
```

Expected: clean build.

**Step 3: Commit**

```bash
git add src/screens/ReviewScreen.tsx
git commit -m "feat: track item_manually_edited, item_added_manually, item_deleted"
```

---

## Task 11: Wire monitoring into SummaryScreen and App

**Files:**
- Modify: `src/screens/SummaryScreen.tsx`
- Modify: `src/App.tsx`

**Step 1: Update `src/screens/SummaryScreen.tsx`**

Add import:
```typescript
import { monitoring } from '../monitoring';
```

Fire `split_completed` when the summary screen first renders. Use a `useEffect` with an empty dep array:
```typescript
useEffect(() => {
  monitoring.track('split_completed', {
    person_count: people.length,
    item_count: receiptItems.length,
    has_tip: tip.value > 0,
    tip_percent: tip.mode === 'percent' ? tip.value : 0,
    currency,
    receipt_type: 'restaurant', // session doesn't store receipt_type; use a sensible default
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // fire once on mount
```

Update `shareAll` to track the method used:
```typescript
function shareAll() {
  const text = people
    .map((p) => `${p.name}: ${formatCurrency(totals[p.id]?.total ?? 0, currency)}`)
    .join('\n');
  if (navigator.share) {
    navigator.share({ title: `${restaurantName ?? 'Bill'} Split`, text }).catch(() => {});
    monitoring.track('summary_shared', { method: 'native' });
  } else {
    navigator.clipboard.writeText(text).catch(() => {});
    monitoring.track('summary_shared', { method: 'clipboard' });
  }
}
```

**Step 2: Update `src/App.tsx` to fire `screen_viewed` on every navigation**

Add import:
```typescript
import { monitoring } from './monitoring';
```

Add a `useEffect` inside `AppRouter` that fires whenever `screen` changes:
```typescript
export function AppRouter() {
  useDirection();
  const { screen } = useSession();

  useEffect(() => {
    monitoring.page(screen);
  }, [screen]);

  return (
    // ... existing JSX unchanged
  );
}
```

**Step 3: Build**

```bash
npm run build
```

Expected: clean build.

**Step 4: Commit**

```bash
git add src/screens/SummaryScreen.tsx src/App.tsx
git commit -m "feat: track split_completed, summary_shared, screen_viewed"
```

---

## Task 12: Wire monitoring into auth and paywall

**Files:**
- Modify: `src/context/AuthContext.tsx`
- Modify: `src/components/auth/SignInModal.tsx`
- Modify: `src/components/paywall/PaywallModal.tsx`

**Step 1: Update `src/context/AuthContext.tsx`**

Add import:
```typescript
import { monitoring } from '../monitoring';
```

Update `onAuthStateChanged` handler to call `monitoring.identify` and `monitoring.reset`:
```typescript
const unsubscribe = onAuthStateChanged(auth, (u) => {
  if (u) {
    monitoring.identify(u.uid, { email: u.email ?? undefined });
  } else if (user !== null) {
    // Only reset if there was a previous user (sign-out, not initial load)
    monitoring.reset();
  }
  setUser(u);
  setLoading(false);
});
```

Note: The condition `user !== null` prevents firing `reset()` on the very first auth state check (when `user` is still the initial `null`). Track `sign_out` in SettingsScreen (Step 3 below).

**Step 2: Update `src/components/auth/SignInModal.tsx`**

Add import:
```typescript
import { monitoring } from '../../monitoring';
```

In `handleGoogle`, after `onSuccess()`:
```typescript
monitoring.track('sign_in_completed', { method: 'google' });
```

In `handleEmail`, after each `onSuccess()`:
```typescript
monitoring.track('sign_in_completed', { method: 'email' });
```

**Step 3: Update `src/screens/SettingsScreen.tsx` sign-out button**

The sign-out button already calls `signOut(auth).then(() => setScreen('home'))`. Add monitoring:
```typescript
onClick={() =>
  signOut(auth).then(() => {
    monitoring.track('sign_out', {});
    setScreen('home');
  })
}
```

Add import: `import { monitoring } from '../monitoring';`

**Step 4: Update `src/components/paywall/PaywallModal.tsx`**

Add import:
```typescript
import { monitoring } from '../../monitoring';
```

Fire `paywall_shown` when the modal opens. Add a `useEffect`:
```typescript
useEffect(() => {
  if (open) {
    monitoring.track('paywall_shown', { scans_used: 5 }); // always shown at 5
  }
}, [open]);
```

In the `onSnapshot` listener where `isPremium === true` triggers `onUnlocked`:
```typescript
if (snap.data()?.isPremium === true) {
  monitoring.track('paywall_converted', {});
  onUnlocked();
}
```

**Step 5: Build**

```bash
npm run build
```

Expected: clean build.

**Step 6: Commit**

```bash
git add src/context/AuthContext.tsx src/components/auth/SignInModal.tsx src/screens/SettingsScreen.tsx src/components/paywall/PaywallModal.tsx
git commit -m "feat: track auth events and paywall conversion"
```

---

## Task 13: Environment variables + CI secrets

**Files:**
- Modify: `.env.local` (local only, never committed)
- Modify: `.github/workflows/firebase-hosting-merge.yml`

**Step 1: Add env vars to `.env.local`**

Create or update `.env.local` in the project root:

```
VITE_SENTRY_DSN=https://YOUR_KEY@o0.ingest.sentry.io/YOUR_PROJECT_ID
VITE_POSTHOG_KEY=phc_YOUR_KEY
```

Get the Sentry DSN from: sentry.io → Your Project → Settings → Client Keys (DSN)
Get the PostHog key from: app.posthog.com → Project Settings → Project API Key

**Step 2: Confirm `.env.local` is gitignored**

```bash
grep ".env.local" .gitignore
```

Expected output: `.env.local` (already present in standard Vite .gitignore).

**Step 3: Add secrets to GitHub Actions**

Go to github.com → your repo → Settings → Secrets and variables → Actions → New repository secret:
- Name: `VITE_SENTRY_DSN`, Value: your Sentry DSN
- Name: `VITE_POSTHOG_KEY`, Value: your PostHog key

**Step 4: Expose secrets in the merge workflow**

Update `.github/workflows/firebase-hosting-merge.yml` to pass secrets as env vars to the build step:

```yaml
      - run: npm ci && npm run build
        env:
          VITE_SENTRY_DSN: ${{ secrets.VITE_SENTRY_DSN }}
          VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
          VITE_GEMINI_API_KEY: ${{ secrets.VITE_GEMINI_API_KEY }}
          VITE_FIREBASE_API_KEY: ${{ secrets.VITE_FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ secrets.VITE_FIREBASE_AUTH_DOMAIN }}
          VITE_FIREBASE_PROJECT_ID: ${{ secrets.VITE_FIREBASE_PROJECT_ID }}
          VITE_FIREBASE_STORAGE_BUCKET: ${{ secrets.VITE_FIREBASE_STORAGE_BUCKET }}
          VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ secrets.VITE_FIREBASE_MESSAGING_SENDER_ID }}
          VITE_FIREBASE_APP_ID: ${{ secrets.VITE_FIREBASE_APP_ID }}
```

**Step 5: Commit the workflow change**

```bash
git add .github/workflows/firebase-hosting-merge.yml
git commit -m "feat: pass monitoring and Firebase secrets to CI build"
git push
```

---

## Task 14: Run full test suite and final build

**Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass, including the new `tokenCost.test.ts`.

**Step 2: Final build**

```bash
npm run build
```

Expected: clean build.

**Step 3: Push**

```bash
git push
```

---

## Verification checklist (manual, after deploy)

- [ ] Open the app in Chrome → DevTools → Network tab → filter by `sentry.io` — confirm events firing
- [ ] DevTools → Network tab → filter by `posthog.com` — confirm `scan_started`, `screen_viewed` etc.
- [ ] PostHog → Live Events — see events arriving in real time
- [ ] Sentry → Issues — confirm no unexpected errors on launch
- [ ] Take a deliberately blurry photo — confirm `scan_failed` event with `error_code: BLURRY` appears in PostHog
- [ ] Complete a full scan → review → split flow — confirm full funnel events fire in PostHog
- [ ] Check `estimated_cost_usd` on `scan_completed` events — should be ~$0.0005–$0.002
