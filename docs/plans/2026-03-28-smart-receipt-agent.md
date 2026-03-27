# Smart Receipt Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current naive receipt parser with a hierarchical, math-aware prompt that understands parent/child line structure, rolls up extra prices into parent items, and validates totals — plus fix the Vite base URL so the app works on both localhost and GitHub Pages.

**Architecture:** Two improvements in parallel: (1) A new `PROMPT` in `geminiVision.ts` that teaches Gemini explicit line-type classification (`MAIN`, `EXTRA`, `NOTE`, `TOTAL_LINE`) and math invariants; (2) A `validateAndFlagReceipt()` post-processor in `receiptParser.ts` that checks `unitPrice × qty ≈ totalPrice` and flags broken items for the user. The Vite `base` fix is a one-liner using `process.env.NODE_ENV`.

**Tech Stack:** TypeScript, Vite, Google Gemini 2.5 Flash API (v1beta), Vitest

---

## Task 1: Fix Vite base URL (localhost + GitHub Pages)

**Files:**
- Modify: `vite.config.ts`

**Problem:** `base: "/ai-split-the-recipe/"` works on GitHub Pages but breaks localhost (`GET http://localhost:5173/Roee-Angel-09-11-2021/ 404`).

**Step 1: Update vite.config.ts**

Replace the hardcoded `base` with an env-conditional:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === "production" ? "/ai-split-the-recipe/" : "/",
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
```

**Step 2: Verify locally**

Run: `npm run dev`
Expected: App loads at `http://localhost:5173/` with no 404.

**Step 3: Verify build output**

Run: `npm run build && cat dist/index.html | grep "assets/index"`
Expected: Asset paths start with `/ai-split-the-recipe/assets/...`

**Step 4: Commit**

```bash
git add vite.config.ts
git commit -m "fix: use '/' base in dev, '/ai-split-the-recipe/' in production"
```

---

## Task 2: Rewrite the Gemini prompt with hierarchical line parsing

**Files:**
- Modify: `src/services/geminiVision.ts` — replace the `PROMPT` constant

**The core insight:** Receipts have a parent–child structure. Extras/add-ons with prices must be summed into the parent item. The AI must classify each line before deciding what to do with it.

**Step 1: Replace PROMPT in geminiVision.ts**

Replace the entire `PROMPT` constant with this new version:

```ts
const PROMPT = `You are an expert receipt accountant. Your job is to parse a receipt image into structured JSON with 100% mathematical accuracy.

## Step 1 — Classify every line on the receipt

Before outputting anything, mentally classify each printed line:

| Type | Description | Example |
|------|-------------|---------|
| MAIN | A chargeable dish/product with its own price | "Burger 45" |
| EXTRA | An add-on/modifier WITH a price that belongs to the MAIN above it | "+ Extra cheese 8" / "תוספת 8" |
| NOTE | A modifier with NO price (cooking style, allergy, free comment) | "ללא גלוטן" / "well done" |
| TOTAL_LINE | A sub-total line for the item group above | "סה״כ 53" after burger+extra |
| RECEIPT_TOTAL | The grand total line at the bottom | "סה״כ לתשלום 142" |
| TAX | Tax line | "מע״מ 18%" |
| SERVICE | Service charge line | "שירות 10%" |
| DISCOUNT | Negative adjustment | "הנחה -15" |

## Step 2 — Roll up EXTRA prices into the parent MAIN

For each MAIN item:
- Start with its own printed price as a base
- Add the price of every EXTRA line that follows it (until the next MAIN)
- If a TOTAL_LINE appears for the group, use that as the authoritative totalPrice
- Append NOTE text to the item name in parentheses: "Burger (well done, ללא גלוטן)"
- Do NOT create separate items for EXTRA or NOTE lines

## Step 3 — Verify math BEFORE outputting

For every item you output, verify this invariant:
  unitPrice × quantity = totalPrice  (within ₪0.10 / $0.10 rounding)

If it does not hold:
- totalPrice is always the ground truth (it's the number actually charged)
- Recalculate: unitPrice = totalPrice / quantity
- Never invent or guess a price

## Step 4 — Cross-check the receipt total

Sum all your item totalPrices. If this differs from the printed subtotal by more than 5%, recheck your work — you likely missed an item or double-counted an EXTRA.

## Output format

Return ONLY valid JSON (no markdown, no backticks, no explanation):

{
  "isReceipt": true,
  "restaurantName": "string or null",
  "items": [
    {
      "id": "item_1",
      "name": "string — EXACTLY as on receipt, NOTEs appended in parentheses, no translation",
      "quantity": number,
      "unitPrice": number,
      "totalPrice": number,
      "category": "food" | "drink" | "dessert" | "other",
      "hasExtras": true
    }
  ],
  "subtotal": number or null,
  "tax": number or null,
  "taxPercent": number or null,
  "serviceCharge": number or null,
  "total": number or null,
  "currency": "ILS" | "USD" | "EUR" | "GBP" | "other",
  "confidence": "high" | "medium" | "low"
}

## Additional rules

- isReceipt: false if this is NOT a bill/receipt (menu without totals, random photo, blurry paper). true otherwise.
- LANGUAGE: Never translate. Hebrew stays Hebrew. English stays English. Mixed stays mixed.
- QUANTITIES: Merge duplicate lines (same item repeated) into one item with summed quantity.
  Detect quantity from: ×N, xN, כמות N, or identical repeated lines.
- DISCOUNTS: Output as items with negative totalPrice (e.g. totalPrice: -15)
- HEBREW GLOSSARY: מע"מ=tax, שירות=service, סה"כ=total, כמות=qty, מחיר=price, הנחה=discount, תוספת=extra
- hasExtras: set true if this item had EXTRA lines rolled into it (helps UI show the user)
- If a number is illegible: set confidence to "low", use 0 for that price, do not guess
- Never return null for items — return [] only if completely unreadable`;
```

**Step 2: Add `hasExtras` to `RawReceiptItem` type**

In `src/types/receipt.types.ts`, update `RawReceiptItem`:

```ts
export interface RawReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: 'food' | 'drink' | 'dessert' | 'other';
  hasExtras?: boolean;
}
```

And add to `ReceiptItem`:

```ts
export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: 'food' | 'drink' | 'dessert' | 'other';
  isEdited: boolean;
  hasExtras?: boolean;
  flagged?: boolean;  // set by client-side validator when math is broken
}
```

**Step 3: Commit**

```bash
git add src/services/geminiVision.ts src/types/receipt.types.ts
git commit -m "feat: hierarchical line-aware receipt prompt with math verification"
```

---

## Task 3: Client-side math validation in receiptParser.ts

**Files:**
- Modify: `src/services/receiptParser.ts`

**Goal:** After Gemini responds, catch any remaining math errors and flag items for the user — without silently changing prices.

**Step 1: Add `validateAndFlag` logic to `parseReceiptToItems`**

Replace the content of `receiptParser.ts`:

```ts
import type { ParsedReceipt, ReceiptItem } from '../types/receipt.types';
import { generateId } from '../utils/idGenerator';

const ROUNDING_TOLERANCE = 0.11; // ₪0.10 + floating point buffer

export function parseReceiptToItems(parsed: ParsedReceipt): ReceiptItem[] {
  return parsed.items.map((item) => {
    const qty = item.quantity || 1;
    const totalPrice = item.totalPrice ?? 0;
    const unitPrice = item.unitPrice ?? 0;

    // Math invariant check: unitPrice × qty should equal totalPrice
    const expected = parseFloat((unitPrice * qty).toFixed(2));
    const actual = parseFloat(totalPrice.toFixed(2));
    const mathBroken = Math.abs(expected - actual) > ROUNDING_TOLERANCE && totalPrice !== 0;

    // If math is broken, re-derive unitPrice from totalPrice (totalPrice is ground truth)
    const correctedUnitPrice = mathBroken
      ? parseFloat((totalPrice / qty).toFixed(4))
      : unitPrice;

    return {
      id: item.id || generateId(),
      name: item.name,
      quantity: qty,
      unitPrice: correctedUnitPrice,
      totalPrice,
      category: item.category || 'other',
      isEdited: false,
      hasExtras: item.hasExtras ?? false,
      flagged: mathBroken, // user will see a warning badge in ReviewScreen
    };
  });
}

export function createManualItem(): ReceiptItem {
  return {
    id: generateId(),
    name: '',
    quantity: 1,
    unitPrice: 0,
    totalPrice: 0,
    category: 'food',
    isEdited: true,
    hasExtras: false,
    flagged: false,
  };
}

/**
 * Returns a warning string if the sum of item prices differs significantly
 * from the receipt's printed subtotal. Used by ReviewScreen to show a banner.
 */
export function checkSubtotalMismatch(
  items: ReceiptItem[],
  printedSubtotal: number | null
): string | null {
  if (!printedSubtotal || printedSubtotal <= 0) return null;

  const itemsSum = items.reduce((s, i) => s + i.totalPrice, 0);
  const diff = Math.abs(itemsSum - printedSubtotal);
  const pct = diff / printedSubtotal;

  if (pct > 0.05) {
    return `Items sum (${itemsSum.toFixed(2)}) differs from receipt subtotal (${printedSubtotal.toFixed(2)}) by ${(pct * 100).toFixed(0)}%. Some items may be missing.`;
  }
  return null;
}
```

**Step 2: Commit**

```bash
git add src/services/receiptParser.ts
git commit -m "feat: client-side math validation, flagged items, subtotal mismatch check"
```

---

## Task 4: Surface flagged items and subtotal warning in ReviewScreen

**Files:**
- Modify: `src/screens/ReviewScreen.tsx`
- Modify: `src/context/SplitSessionContext.tsx` (pass `subtotal` through if not already available)

**Goal:** Let the user see which items have broken math so they can fix them manually.

**Step 1: Check if `subtotal` is available in session**

Open `src/context/SplitSessionContext.tsx`. Find where `setReceiptData` is called. Confirm that `parsed.subtotal` is being stored in the session. If not, add `subtotal?: number | null` to the session type and store it.

In `HomeScreen.tsx`, `setReceiptData` call — add `subtotal: parsed.subtotal`:
```ts
setReceiptData(items, {
  restaurantName: parsed.restaurantName,
  tax: parsed.currency === 'ILS' ? 0 : (parsed.tax ?? 0),
  serviceCharge: parsed.serviceCharge ?? 0,
  currency: parsed.currency ?? 'ILS',
  subtotal: parsed.subtotal ?? null,  // ← add this
});
```

**Step 2: Add subtotal mismatch banner to ReviewScreen**

At the top of the item list in `ReviewScreen.tsx`, after the grand total card, add:

```tsx
import { checkSubtotalMismatch } from '../services/receiptParser';

// Inside the component, compute:
const subtotalWarning = checkSubtotalMismatch(receiptItems, session.subtotal ?? null);

// Render (before the item list):
{subtotalWarning && (
  <motion.div
    initial={{ opacity: 0, y: -8 }}
    animate={{ opacity: 1, y: 0 }}
    className="mx-5 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex gap-2"
  >
    <span className="text-amber-500 text-lg flex-shrink-0">⚠️</span>
    <p className="text-xs text-amber-700 font-medium">{subtotalWarning}</p>
  </motion.div>
)}
```

**Step 3: Show ⚠️ badge on flagged items in ReviewScreen**

In the item row render (the numbered list), when `item.flagged` is true, show a warning:

```tsx
{item.flagged && (
  <span
    title="Price math doesn't add up — please check"
    className="ml-1 text-amber-500 text-xs font-bold"
  >
    ⚠️
  </span>
)}
```

Also show a tooltip/note below the item price input when editing a flagged item:
```tsx
{editingId === item.id && item.flagged && (
  <p className="text-[10px] text-amber-600 mt-1">
    ⚠️ Unit price was recalculated from total. Please verify.
  </p>
)}
```

**Step 4: Commit**

```bash
git add src/screens/ReviewScreen.tsx src/context/SplitSessionContext.tsx src/screens/HomeScreen.tsx
git commit -m "feat: surface flagged items and subtotal mismatch warning in ReviewScreen"
```

---

## Task 5: Write tests for the validator

**Files:**
- Create: `src/services/__tests__/receiptParser.test.ts`

**Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseReceiptToItems, checkSubtotalMismatch } from '../receiptParser';
import type { ParsedReceipt } from '../../types/receipt.types';

const baseReceipt: ParsedReceipt = {
  isReceipt: true,
  restaurantName: 'Test',
  subtotal: null,
  tax: null,
  taxPercent: null,
  serviceCharge: null,
  total: null,
  currency: 'ILS',
  confidence: 'high',
  items: [],
};

describe('parseReceiptToItems', () => {
  it('passes through correct math without flagging', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{ id: '1', name: 'Burger', quantity: 2, unitPrice: 45, totalPrice: 90, category: 'food' }],
    });
    expect(items[0].flagged).toBe(false);
    expect(items[0].unitPrice).toBe(45);
  });

  it('flags item when unitPrice × qty ≠ totalPrice', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{ id: '1', name: 'Pizza', quantity: 1, unitPrice: 50, totalPrice: 58, category: 'food' }],
    });
    expect(items[0].flagged).toBe(true);
    // unitPrice is re-derived from totalPrice
    expect(items[0].unitPrice).toBe(58);
  });

  it('corrects unitPrice from totalPrice when math broken (extras rolled in)', () => {
    // Burger: unitPrice=45 but extras added → totalPrice=53
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{ id: '1', name: 'Burger (extra cheese)', quantity: 1, unitPrice: 45, totalPrice: 53, category: 'food' }],
    });
    expect(items[0].unitPrice).toBe(53); // re-derived
    expect(items[0].flagged).toBe(true);
  });

  it('does not flag when difference is within rounding tolerance', () => {
    // 3 × 15.33 = 45.99 but totalPrice = 46 (rounding)
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{ id: '1', name: 'Beer', quantity: 3, unitPrice: 15.33, totalPrice: 46, category: 'drink' }],
    });
    expect(items[0].flagged).toBe(false);
  });

  it('defaults quantity to 1 when missing', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{ id: '1', name: 'Salad', quantity: 0, unitPrice: 38, totalPrice: 38, category: 'food' }],
    });
    expect(items[0].quantity).toBe(1);
  });
});

describe('checkSubtotalMismatch', () => {
  it('returns null when subtotal matches items sum', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [
        { id: '1', name: 'A', quantity: 1, unitPrice: 40, totalPrice: 40, category: 'food' },
        { id: '2', name: 'B', quantity: 1, unitPrice: 60, totalPrice: 60, category: 'food' },
      ],
    });
    expect(checkSubtotalMismatch(items, 100)).toBeNull();
  });

  it('returns warning string when subtotal differs by >5%', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{ id: '1', name: 'X', quantity: 1, unitPrice: 40, totalPrice: 40, category: 'food' }],
    });
    const warning = checkSubtotalMismatch(items, 100);
    expect(warning).not.toBeNull();
    expect(warning).toContain('missing');
  });

  it('returns null when printedSubtotal is null', () => {
    expect(checkSubtotalMismatch([], null)).toBeNull();
  });
});
```

**Step 2: Run tests**

```bash
npm run test -- src/services/__tests__/receiptParser.test.ts
```
Expected: All 7 tests pass.

**Step 3: Commit**

```bash
git add src/services/__tests__/receiptParser.test.ts
git commit -m "test: receipt parser validation — flagging, math correction, subtotal check"
```

---

## Task 6: Final build + deploy check

**Step 1: Run full test suite**

```bash
npm run test
```
Expected: All tests pass.

**Step 2: Production build**

```bash
npm run build
```
Expected: No TypeScript errors, bundle builds cleanly.

**Step 3: Verify base URL in build**

```bash
grep -r "ai-split-the-recipe" dist/index.html
```
Expected: Asset links reference `/ai-split-the-recipe/assets/...`

**Step 4: Push to trigger GitHub Actions deploy**

```bash
git push origin master
```

**Step 5: Smoke test on localhost**

```bash
npm run dev
```
Expected: App loads at `http://localhost:5173/` — no 404, no base-URL error in console.
