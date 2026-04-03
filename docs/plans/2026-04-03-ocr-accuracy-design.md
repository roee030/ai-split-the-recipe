# OCR Accuracy & Magic Fix Design

**Goal:** Fix missing/wrong prices in Gemini receipt scanning, especially for Israeli receipts with comma decimals, old printers, and discount lines.

**Approach:** Hybrid C+B — deep-clean prompts and parser first (always on), add a user-triggered "Magic Fix" button (optional 3rd Gemini call) when totals don't match.

---

## Section 1 — Prompt Improvements

### OCR Prompt (Pass 1)
Gemini acts as a camera — transcribe only, never interpret.

New rules added:
- *"If a price is partially obscured, transcribe what is readable and mark unclear digits with `?`"*
- *"Prices may appear as `25.90`, `25,90`, `₪25`, `$12.50` — transcribe exactly as printed, including the currency symbol"*

### Structure Prompt (Pass 2)
Gemini acts as the brain — interpret and structure.

Four targeted additions:
1. **Decimal normalization:** *"If you see a comma as decimal separator (e.g. `25,90`), convert to dot notation (`25.90`) in the output"* — critical for Israeli receipts where old thermal printers print commas.
2. **Currency stripping:** *"Strip all currency symbols from numeric fields — output numbers only"*
3. **`price_missing` flag:** *"If a price is unreadable or not present, set `unit_price: null`, `total_price: null`, `price_missing: true`"*
4. **Discount clarity:** *"Discounts must appear as negative `sub_items`, never as negative `total_price` on the MAIN item"* — prevents confusing negative totals during split.

---

## Section 2 — Schema & Type Changes

All changes are backward-compatible (optional fields).

### `RawReceiptItem` (receipt.types.ts)
```typescript
price_missing?: boolean;
unit_price: number | null;   // was number — allow null for unreadable prices
total_price: number | null;  // was number — allow null for unreadable prices
```

### `SplitSession` (split.types.ts)
```typescript
lastTranscript: string | null;  // stores Pass 1 OCR output for Magic Fix
```
Avoids re-sending the image for Pass 3 — saves ~50% latency and all image tokens.

### `ScanResult` (geminiVision.ts)
```typescript
export type ScanResult = {
  receipt: ParsedReceipt;
  tokens: ScanTokens;
  transcript: string;   // Pass 1 output, forwarded to session
};
```

`HomeScreen` stores `transcript` into `session.lastTranscript` after a successful scan.

---

## Section 3 — Parser Fixes (receiptParser.ts)

### Fix 1 — Silent zero bug
`item.totalPrice ?? 0` currently hides missing prices as `₪0.00` with no warning.

New behaviour: if `price_missing === true` → set `totalPrice: 0` AND `flagged: true`. Item shows ⚠️ in ReviewScreen. User can edit manually or trigger Magic Fix.

### Fix 2 — `parsePrice` defensive helper
```typescript
function parsePrice(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return raw;
  const cleaned = String(raw)
    .replace(/[₪$€£¥]/g, '')   // strip currency symbols
    .replace(/,(\d{2})$/, '.$1') // "25,90" → "25.90" (decimal comma)
    .replace(/,/g, '');           // remove thousands separators
  return parseFloat(cleaned) || 0;
}
```

All reads of `item.unit_price`, `item.total_price`, `sub_item.price` go through this helper. Parser is the last line of defence even if the prompt fix already handles it.

---

## Section 4 — Magic Fix Button

### New function: `geminiReVerify`
In `geminiVision.ts`:
```typescript
export async function geminiReVerify(
  transcript: string,
  items: ReceiptItem[],
  printedSubtotal: number
): Promise<ReceiptItem[]>
```

Pass 3 prompt sent to Gemini:
```
The following receipt was parsed but the item prices don't add up correctly.

TRANSCRIPT:
{transcript}

CURRENT PARSED ITEMS SUM: {itemsSum}
RECEIPT PRINTED TOTAL: {printedSubtotal}
DIFFERENCE: {diff}

Re-examine the transcript carefully. Return ONLY a corrected JSON array of items
using the same schema as before. Focus on: misread prices, missing items,
wrong decimal separators, items whose price was merged with a neighbour.
```

No image is sent — transcript only. Token cost is ~10× cheaper than a full scan.

### ReviewScreen changes
- Existing `subtotalWarning` banner gets a **"✨ Magic Fix"** button (only shown when `session.lastTranscript` is not null)
- Button tap → loading state → `geminiReVerify` call → replace `receiptItems` in session
- If mismatch persists after re-verify → show: *"Gemini couldn't resolve the difference — please check items manually"*
- Magic Fix fires `monitoring.track('magic_fix_triggered', { success: boolean })` for analytics

---

## Files Changed
| File | Change |
|---|---|
| `src/services/geminiVision.ts` | Improved OCR + structure prompts, expose `transcript` in `ScanResult`, add `geminiReVerify()` |
| `src/services/receiptParser.ts` | `parsePrice()` helper, silent-zero fix, `price_missing` handling |
| `src/types/receipt.types.ts` | `price_missing?: boolean`, `unit_price/total_price: number \| null` |
| `src/types/split.types.ts` | `lastTranscript: string \| null` in `SplitSession` |
| `src/hooks/useSplitSession.ts` | `setTranscript()` action, reset includes `lastTranscript: null` |
| `src/context/SplitSessionContext.tsx` | Expose `setTranscript` |
| `src/screens/HomeScreen.tsx` | Call `setTranscript(transcript)` after scan |
| `src/screens/ReviewScreen.tsx` | Magic Fix button in mismatch banner |
| `src/monitoring/events.ts` | Add `magic_fix_triggered` event |
