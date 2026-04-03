import type { ParsedReceipt, ReceiptItem } from '../types/receipt.types';
import { generateId } from '../utils/idGenerator';

const ROUNDING_TOLERANCE = 0.11; // 0.10 + floating point buffer

/**
 * Safely converts any price value from Gemini to a JS number.
 * Handles: null/undefined → 0, currency symbols (₪$€£¥), comma decimal separators,
 * thousands separators. This is the last line of defence after the prompt fix.
 */
export function parsePrice(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  const str = String(raw).trim();
  // Strip currency symbols
  const stripped = str.replace(/[₪$€£¥]/g, '').trim();
  // Handle comma as decimal separator: "25,90" → "25.90"
  // But not thousands separator: "1,250.00" stays as "1250.00"
  const normalized = stripped.replace(/,(\d{2})$/, '.$1').replace(/,/g, '');
  const result = parseFloat(normalized);
  return isNaN(result) ? 0 : result;
}

export function parseReceiptToItems(parsed: ParsedReceipt): ReceiptItem[] {
  return parsed.items.map((item) => {
    const qty = item.quantity || 1;

    // Use snake_case fields from Gemini if camelCase not set
    const rawTotal = item.totalPrice ?? (item as Record<string, unknown>).total_price;
    const rawUnit  = item.unitPrice  ?? (item as Record<string, unknown>).unit_price;
    const priceMissing = !!(item as Record<string, unknown>).price_missing;

    const basePrice = parsePrice(rawTotal);
    const unitPrice = parsePrice(rawUnit);

    // Sum all sub_item prices (extras add, discounts subtract)
    const subItems = item.sub_items ?? [];
    const subTotal = subItems.reduce((sum, si) => sum + parsePrice(si.price), 0);
    const effectiveTotalPrice = parseFloat((basePrice + subTotal).toFixed(2));

    // Append sub_item names to the parent name for display
    const subNames = subItems.map((si) => si.name).filter(Boolean);
    const displayName = subNames.length > 0
      ? `${item.name} (${subNames.join(', ')})`
      : item.name;

    // Math invariant: unitPrice x qty should equal effectiveTotalPrice
    const expected = parseFloat((unitPrice * qty).toFixed(2));
    const mathBroken = !priceMissing &&
      Math.abs(expected - effectiveTotalPrice) > ROUNDING_TOLERANCE &&
      effectiveTotalPrice !== 0;

    const correctedUnitPrice = mathBroken
      ? parseFloat((effectiveTotalPrice / qty).toFixed(4))
      : unitPrice;

    return {
      id: item.id || generateId(),
      name: displayName,
      quantity: qty,
      unitPrice: correctedUnitPrice,
      totalPrice: effectiveTotalPrice,
      category: item.category || 'other',
      isEdited: false,
      hasExtras: subItems.some((si) => parsePrice(si.price) !== 0),
      // price_missing items get flagged so ⚠️ shows in ReviewScreen
      flagged: mathBroken || priceMissing,
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
