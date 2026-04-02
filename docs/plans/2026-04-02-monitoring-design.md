# SplitSnap Monitoring & Observability Design

**Date:** 2026-04-02
**Scope:** Error tracking (Sentry) + Product analytics with token cost monitoring (PostHog)

---

## 1. Goals

- **Reliability:** Know when something breaks before users report it
- **Prompt quality:** Measure how often users must manually fix AI output (`item_manually_edited`)
- **Cost visibility:** Track Gemini token consumption per scan, per user, per receipt type
- **Funnel analysis:** See where users drop out of the scan → split flow
- **Retry signal:** Measure whether failure feedback (blurry/cropped errors) leads to successful retries

---

## 2. Vendor Stack

| Concern | Vendor | Free tier |
|---|---|---|
| Error tracking + stack traces | **Sentry** | 5K errors/month |
| Product analytics + session replay | **PostHog** | 1M events/month |
| Token cost estimation | In-house (`tokenCost.ts`) | — |

No other vendors. Components never import Sentry or PostHog directly.

---

## 3. Module Structure

```
src/monitoring/
  index.ts        ← public API, the ONLY thing components ever import
  sentry.ts       ← Sentry init + captureError wrapper
  posthog.ts      ← PostHog init + track/identify/page wrappers
  events.ts       ← typed event names and property schemas (TypeScript)
  tokenCost.ts    ← token → USD cost calculator
```

### 3.1 Public API (`index.ts`)

```typescript
export const monitoring = {
  // Reports an exception to Sentry with optional extra context
  captureError(err: Error, ctx?: Record<string, unknown>): void;

  // Sends a typed event to PostHog
  track(event: MonitoringEvent, props?: EventProperties[MonitoringEvent]): void;

  // Associates a user identity in both Sentry and PostHog
  identify(userId: string, traits?: { email?: string; isPremium?: boolean }): void;

  // Resets identity on sign-out
  reset(): void;

  // Records a screen navigation as a PostHog $pageview
  page(screen: string): void;
};
```

Components call `monitoring.track(...)` or `monitoring.captureError(...)` exclusively. Vendor-specific code lives only inside `sentry.ts` and `posthog.ts`.

### 3.2 Sentry (`sentry.ts`)

- Initialised once in `main.tsx` before React renders
- DSN read from `VITE_SENTRY_DSN` env var
- `tracesSampleRate: 0.2` (20% of transactions for performance profiling)
- `replaysOnErrorSampleRate: 1.0` (Sentry session replay on every error)
- Attaches `userId` and `isPremium` as Sentry user scope on `identify()`
- Wraps `captureException` to add structured `extra` context

### 3.3 PostHog (`posthog.ts`)

- Initialised once in `main.tsx`
- Project API key from `VITE_POSTHOG_KEY` env var
- `api_host: 'https://app.posthog.com'`
- Session replay enabled: `enable_recording_console_log: true`
- `identify()` calls `posthog.identify(userId, traits)`
- `reset()` calls `posthog.reset()` on sign-out
- `page()` calls `posthog.capture('$pageview', { screen })`

---

## 4. Token Cost Calculation (`tokenCost.ts`)

Gemini 2.5 Flash pricing (as of April 2026):

| Token type | Price |
|---|---|
| Input (prompt) | $0.075 / 1M tokens |
| Output (candidates) | $0.30 / 1M tokens |

```typescript
export interface PassTokens {
  inputTokens: number;   // promptTokenCount from usageMetadata
  outputTokens: number;  // candidatesTokenCount from usageMetadata
}

export interface ScanTokens {
  pass1: PassTokens;
  pass2: PassTokens;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUSD: number;
}

const INPUT_COST_PER_TOKEN  = 0.075 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 0.30  / 1_000_000;

export function calcScanCost(pass1: PassTokens, pass2: PassTokens): ScanTokens;
```

`estimatedCostUSD` is attached to every `scan_completed` and `scan_failed` PostHog event, enabling PostHog dashboards to:
- `SUM(estimated_cost_usd)` grouped by `receipt_type`
- `AVG(total_input_tokens)` correlated with `confidence`
- `SUM(estimated_cost_usd)` per user (session identity)

---

## 5. Gemini API Changes (`geminiVision.ts`)

The Gemini REST response already includes `usageMetadata`:

```json
{
  "candidates": [...],
  "usageMetadata": {
    "promptTokenCount": 1234,
    "candidatesTokenCount": 456,
    "totalTokenCount": 1690
  }
}
```

Both `geminiOCR` and `geminiStructure` are updated to extract and return `PassTokens` alongside their primary output. `scanReceipt` aggregates both and returns:

```typescript
export type ScanResult = {
  receipt: ParsedReceipt;
  tokens: ScanTokens;
};
```

`HomeScreen.tsx` destructures `{ receipt, tokens }` from `scanReceipt(...)` and passes `tokens` directly to `monitoring.track('scan_completed', ...)`.

---

## 6. Event Taxonomy

All events are typed in `events.ts` via a discriminated union so TypeScript enforces correct properties at every call site.

### Scan flow

| Event | Fired when | Key properties |
|---|---|---|
| `scan_started` | User taps Scan or Confirm in preview | `source: 'camera' \| 'upload'` |
| `scan_ocr_completed` | Pass 1 returns transcript | `pass1_input_tokens`, `pass1_output_tokens` |
| `scan_completed` | Pass 2 returns receipt JSON | `receipt_type`, `item_count`, `confidence`, `pass1_input_tokens`, `pass1_output_tokens`, `pass2_input_tokens`, `pass2_output_tokens`, `total_input_tokens`, `total_output_tokens`, `estimated_cost_usd` |
| `scan_failed` | Any pass throws | `error_code` (BLURRY/CROPPED/etc.), `failed_pass: 1 \| 2`, `total_input_tokens`, `total_output_tokens`, `estimated_cost_usd` (cost of the failed attempt) |
| `scan_retried` | User taps Retake after a failure | `previous_error_code` |

### Editing (prompt quality signal)

| Event | Fired when | Key properties |
|---|---|---|
| `item_manually_edited` | User changes item name or price in ReviewScreen | `field: 'name' \| 'price' \| 'quantity'`, `receipt_type`, `confidence` |
| `item_added_manually` | User adds a new item manually | `receipt_type` |
| `item_deleted` | User deletes an item | `receipt_type` |

`item_manually_edited` is the ground-truth signal for prompt quality. A high rate on receipts with `confidence: 'high'` means the AI is over-confident.

### Split flow

| Event | Fired when | Key properties |
|---|---|---|
| `screen_viewed` | Every screen navigation | `screen` |
| `split_completed` | SummaryScreen shown | `person_count`, `item_count`, `has_tip`, `tip_percent`, `currency`, `receipt_type` |
| `summary_shared` | Share/copy tapped | `method: 'native' \| 'clipboard'` |

### Auth + monetisation

| Event | Fired when | Key properties |
|---|---|---|
| `sign_in_completed` | Auth success | `method: 'google' \| 'email'` |
| `sign_out` | Sign out tapped | — |
| `paywall_shown` | Limit hit | `scans_used` |
| `paywall_converted` | isPremium flips true | — |

---

## 7. Integration Points in Components

| File | Change |
|---|---|
| `main.tsx` | Call `initSentry()` and `initPostHog()` before `ReactDOM.createRoot` |
| `src/monitoring/index.ts` | New file — public facade |
| `src/monitoring/sentry.ts` | New file |
| `src/monitoring/posthog.ts` | New file |
| `src/monitoring/events.ts` | New file — typed event names + property schemas |
| `src/monitoring/tokenCost.ts` | New file |
| `src/services/geminiVision.ts` | Extract `usageMetadata` from both passes, return `ScanResult` |
| `src/screens/HomeScreen.tsx` | `track('scan_started')`, `track('scan_completed')`, `track('scan_failed')`, `track('scan_retried')` |
| `src/screens/ReviewScreen.tsx` | `track('item_manually_edited')`, `track('item_added_manually')`, `track('item_deleted')` |
| `src/screens/SummaryScreen.tsx` | `track('split_completed')`, `track('summary_shared')` |
| `src/context/AuthContext.tsx` | `monitoring.identify(uid)` on sign-in, `monitoring.reset()` on sign-out |
| `src/App.tsx` | `monitoring.page(screen)` on every screen change |
| `src/components/paywall/PaywallModal.tsx` | `track('paywall_shown')`, `track('paywall_converted')` |
| `src/components/auth/SignInModal.tsx` | `track('sign_in_completed')` |

---

## 8. Environment Variables

```
VITE_SENTRY_DSN=https://...@sentry.io/...
VITE_POSTHOG_KEY=phc_...
```

Both added to `.env.local` (gitignored) and as GitHub Actions secrets for the CI deploy workflow.

---

## 9. Privacy Considerations

- PostHog session replay: mask all input fields (`input[type=password]`, item name inputs) so no PII is captured in replays
- Sentry: `sendDefaultPii: false` (default) — no cookies or IP addresses sent
- Both vendors declared in Privacy Policy under "Analytics" section
- Receipt image data never sent to monitoring vendors — only metadata (token counts, item count, receipt type)

---

## 10. PostHog Dashboard Queries

Once live, these queries answer the core questions:

**Prompt quality:** `COUNT(item_manually_edited)` / `COUNT(scan_completed)` → edit rate per `receipt_type` and `confidence`

**Cost per receipt type:** `AVG(estimated_cost_usd)` grouped by `receipt_type`

**Retry success rate:** `COUNT(scan_completed WHERE preceded by scan_retried)` / `COUNT(scan_retried)`

**Funnel:** `scan_started → scan_completed → screen_viewed(review) → split_completed` — drop-off at each step

**Token/failure correlation:** `AVG(total_input_tokens)` grouped by `error_code` — do high-token scans fail more?
