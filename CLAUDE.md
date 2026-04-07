# SplitSnap — Architecture Notes

## Vision Strategy Evaluation

Last evaluated: **2026-04-05**
Tool: `tests/scripts/evaluate.ts`
Models tested: Gemini 2.0 Flash → Claude Sonnet 4.5 (cascade fallback)

---

### Scoring Methodology

| Metric            | Weight | Definition                                                 |
|-------------------|--------|------------------------------------------------------------|
| extractionScore   |  60 %  | Levenshtein name-match % (golden) or price-present % (self)|
| confidenceScore   |  40 %  | Model self-reported confidence mapped to 0-100             |
| **composite**     | 100 %  | Weighted sum                                               |

Ground truth provided for: WhatsApp restaurant receipt (14 items).

---

### Strategy Descriptions

| Strategy  | Passes | Description                                                   |
|-----------|--------|---------------------------------------------------------------|
| Classic   | 2      | image→OCR text (Pass 1), then text→JSON (Pass 2)              |
| Direct    | 1      | image→JSON, minimal extraction prompt                         |
| Optimized | 1      | image→JSON, high-fidelity Hebrew receipt prompt               |

---

### Results (avg across 4 sample receipts)

| Strategy   | Avg Extr%  | Avg Conf%  | Avg Comp%  | Avg Latency  |
|------------|------------|------------|------------|--------------|
| Classic    | 81%        | 100%       | 89%        | 96164ms      |
| Direct     | 58%        | 63%        | 60%        | 42041ms      |
| Optimized  | 86%        | 100%       | 92%        | 47130ms      |

---

### Production Decision

**Optimized** (one-shot high-fidelity) outperforms the two-pass approach.

To implement: update Pass 1 in `src/services/geminiVision.ts` to send image + `OPTIMIZED_PROMPT` in a single call with `responseMimeType: 'application/json'`, bypassing Pass 2 entirely.

---

### How to Re-run

```bash
npm run evaluate      # parallel (paid keys)
npm run evaluate:seq  # sequential, 20 s gap (free-tier keys)
```

---

### Production Configuration

Provider defaults (`src/config/providers.ts`):

```
VITE_PASS1_PROVIDER=gemini-2.0-flash   # image → OCR text
VITE_PASS2_PROVIDER=gemini-2.0-flash   # OCR text → JSON
VITE_MAGIC_PROVIDER=gemini-2.0-flash   # math self-healing (Pass 3)
```

Override via `.env.local` — no code changes needed.
Valid values: `gemini-2.0-flash` | `gemini-2.5-flash` | `gemini-1.5-pro` | `claude-sonnet-4-5`

---

### Fallback Chain (`src/services/geminiVision.ts`)

1. **Tier 1** — configured primary provider
2. **Tier 2** — `gemini-2.0-flash` on transient 429 / 500
3. **Tier 3** — `claude-sonnet-4-5` on daily Gemini quota exhaustion
   (requires `VITE_ANTHROPIC_API_KEY` or `VITE_ANTHROPIC_PROXY_URL`)

## Model Benchmark Results

Last benchmarked: **2026-04-05**
Tool: `tests/scripts/benchmark.ts`
Strategy: Optimized single-pass (high-fidelity prompt, winner from `evaluate.ts`)
Images tested: 5 (WhatsApp receipt + caption.jpg + recipe_test + kabala colbo + caption2)

### Results

| Model      | Avg Extr%  | Avg Comp%  | Avg TTFB   | Avg Total    | JSON OK% |
|------------|------------|------------|------------|--------------|----------|
| Flash Lite | 85%        | 91%        | 6885ms     | 6886ms       | 100%     |
| Flash      | 78%        | 84%        | 10962ms    | 10963ms      | 100%     |
| Pro        | 0%         | 0%         | 0ms        | 0ms          | 0%       |

### Pass 1 / Pass 2 Recommendations

**Pass 1 (Speed / OCR vision):** `gemini-3.1-flash-lite-preview`
- Avg TTFB: 6885ms · Composite: 91% · JSON integrity: 100%
- Best choice for image→text/JSON first pass: low latency, acceptable accuracy

**Pass 2 (Accuracy / JSON fix):** `gemini-3.1-flash-lite-preview`
- Avg Total: 6886ms · Composite: 91% · JSON integrity: 100%
- Best choice for structuring/self-healing: highest accuracy, latency less critical

To apply in production, update `.env.local`:
```
VITE_PASS1_PROVIDER=gemini-3.1-flash-lite-preview
VITE_PASS2_PROVIDER=gemini-3.1-flash-lite-preview
```

---

### How to Re-run

```bash
npm run benchmark       # model benchmark (this script)
npm run evaluate:seq    # strategy comparison (evaluate.ts)
```

---

## Hebrew Localization

Last updated: **2026-04-07**
Design doc: `docs/plans/2026-04-05-hebrew-rtl-localization-design.md`
Implementation plan: `docs/plans/2026-04-05-hebrew-rtl-localization.md`

### Components Localized

| Component | Changes |
|---|---|
| `src/components/claim/ItemCard.tsx` | "Claimed ✓", "Tap to claim", "Shared ÷ N", "X of Y" → `t(claim.*)` |
| `src/components/payment/SummaryCard.tsx` | "Subtotal", "Tip", "Tax", "Service", "(shared)", copy text → `t(summary.*)` |
| `src/components/common/BackButton.tsx` | Hardcoded EN labels + fixed `ChevronLeft` → i18n `nav.*` keys + RTL icon flip |
| `src/screens/ClaimScreen.tsx` | "See My Total", "Done →", "N unclaimed" → `t(claim.*)` |
| `src/screens/SummaryScreen.tsx` | "Bill", "Bill Split", "People" → i18n |
| `src/screens/ReviewScreen.tsx` | Partial service charge JSX → `t('review.serviceChargeDetected', {amount})` |
| `src/components/review/ItemRow.tsx` | Framer `x` offsets RTL-aware; `text-right` → `text-end` |
| `src/components/home/PhotoPreviewOverlay.tsx` | Confirm button chevron → RTL-flipped |
| 9 screen/modal files | `fixed bottom-0 left-0 right-0` → `fixed bottom-0 inset-x-0` |

### CSS Classes Migrated (Physical → Logical)

| Physical | Logical | Semantic |
|---|---|---|
| `ml-*` | `ms-*` | margin inline-start |
| `mr-*` | `me-*` | margin inline-end |
| `text-left` | `text-start` | align to reading start |
| `text-right` | `text-end` | align to reading end |
| `left-0 right-0` (fixed) | `inset-x-0` | full-width sticky bars |

### New i18n Keys Added (all 7 locales)

- `claim.claimed`, `claim.tapToClaim`, `claim.shared`, `claim.sharedBy`, `claim.myQtyOf`
- `summary.subtotal`, `summary.tip`, `summary.tax`, `summary.service`, `summary.sharedLabel`, `summary.owes`, `summary.copyOwes`
- `nav.back`, `nav.home`, `nav.reviewItems`, `nav.whosJoining`, `nav.claimDishes`, `nav.tipAndTax`, `nav.summary`

Hebrew values use professional native-reviewed terminology. Other 6 locales use English placeholders pending translation.

### Typography

- Font changed: `DM Sans` → **`Assistant`** (primary) + `DM Sans` (Latin fallback)
- `Assistant` weights loaded: 400, 500, 600, 700 — covers `font-normal` through `font-bold`
- Eliminates Times New Roman / system serif fallback for Hebrew on Windows and Android

### Currency

- `formatCurrency` now uses `Intl.NumberFormat('he-IL')` for ILS → renders `120.00 ₪` (symbol after, Israeli standard)
- All other currencies use `Intl.NumberFormat` with default locale
- `getCurrencySymbol` unchanged for bare-symbol use cases
