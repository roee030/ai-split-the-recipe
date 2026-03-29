import type { ParsedReceipt, ReceiptItem } from '../types/receipt.types';
import { generateId } from '../utils/idGenerator';

const ROUNDING_TOLERANCE = 0.11; // 0.10 + floating point buffer

export function parseReceiptToItems(parsed: ParsedReceipt): ReceiptItem[] {
  return parsed.items.map((item) => {
    const qty = item.quantity || 1;
    const basePrice = item.totalPrice ?? 0;

    // Sum all sub_item prices (extras add, discounts subtract)
    const subItems = item.sub_items ?? [];
    const subTotal = subItems.reduce((sum, si) => sum + (si.price ?? 0), 0);
    const effectiveTotalPrice = parseFloat((basePrice + subTotal).toFixed(2));

    // Append sub_item names to the parent name for display
    // Zero-price sub_items are notes (e.g. "ללא גלוטן"), non-zero are charges/discounts
    const subNames = subItems.map((si) => si.name).filter(Boolean);
    const displayName = subNames.length > 0
      ? `${item.name} (${subNames.join(', ')})`
      : item.name;

    const unitPrice = item.unitPrice ?? 0;

    // Math invariant: unitPrice x qty should equal effectiveTotalPrice
    const expected = parseFloat((unitPrice * qty).toFixed(2));
    const mathBroken = Math.abs(expected - effectiveTotalPrice) > ROUNDING_TOLERANCE && effectiveTotalPrice !== 0;

    // effectiveTotalPrice is ground truth — re-derive unitPrice if math is broken
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
      hasExtras: subItems.some((si) => (si.price ?? 0) !== 0),
      flagged: mathBroken,
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
