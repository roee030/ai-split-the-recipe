import { describe, it, expect } from 'vitest';
import { parseReceiptToItems, checkSubtotalMismatch, parsePrice } from '../receiptParser';
import type { ParsedReceipt } from '../../types/receipt.types';

describe('parsePrice', () => {
  it('returns number as-is', () => {
    expect(parsePrice(25.9)).toBe(25.9);
  });

  it('handles null → 0', () => {
    expect(parsePrice(null)).toBe(0);
  });

  it('handles undefined → 0', () => {
    expect(parsePrice(undefined)).toBe(0);
  });

  it('strips ₪ symbol', () => {
    expect(parsePrice('₪25.90')).toBe(25.9);
  });

  it('strips $ symbol', () => {
    expect(parsePrice('$12.50')).toBe(12.5);
  });

  it('converts comma decimal separator', () => {
    expect(parsePrice('25,90')).toBe(25.9);
  });

  it('handles thousands separator with comma', () => {
    expect(parsePrice('1,250.00')).toBe(1250);
  });

  it('handles price with trailing ₪', () => {
    expect(parsePrice('25.90₪')).toBe(25.9);
  });

  it('returns 0 for unparseable string', () => {
    expect(parsePrice('???')).toBe(0);
  });
});

const baseReceipt: ParsedReceipt = {
  isReceipt: true,
  receipt_type: 'restaurant',
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

  it('flags item when unitPrice x qty does not equal totalPrice', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{ id: '1', name: 'Pizza', quantity: 1, unitPrice: 50, totalPrice: 58, category: 'food' }],
    });
    expect(items[0].flagged).toBe(true);
    expect(items[0].unitPrice).toBe(58); // re-derived from totalPrice
  });

  it('corrects unitPrice from totalPrice when extras rolled in', () => {
    // Burger base=45, but unitPrice mismatches because extras were not yet accounted for
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{ id: '1', name: 'Burger (extra cheese)', quantity: 1, unitPrice: 45, totalPrice: 53, category: 'food' }],
    });
    expect(items[0].unitPrice).toBe(53);
    expect(items[0].flagged).toBe(true);
  });

  it('does not flag when difference is within rounding tolerance', () => {
    // 3 x 15.33 = 45.99 but totalPrice = 46 (rounding)
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{ id: '1', name: 'Beer', quantity: 3, unitPrice: 15.33, totalPrice: 46, category: 'drink' }],
    });
    expect(items[0].flagged).toBe(false);
  });

  it('defaults quantity to 1 when zero', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{ id: '1', name: 'Salad', quantity: 0, unitPrice: 38, totalPrice: 38, category: 'food' }],
    });
    expect(items[0].quantity).toBe(1);
  });

  it('rolls up sub_item prices into parent totalPrice', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{
        id: '1', name: 'Burger', quantity: 1, unitPrice: 45, totalPrice: 45, category: 'food',
        sub_items: [
          { name: 'Extra cheese', price: 8 },
          { name: 'Club discount', price: -5 },
        ],
      }],
    });
    expect(items[0].totalPrice).toBe(48); // 45 + 8 - 5
    expect(items[0].hasExtras).toBe(true);
  });

  it('appends sub_item names to parent name', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{
        id: '1', name: 'Burger', quantity: 1, unitPrice: 45, totalPrice: 45, category: 'food',
        sub_items: [{ name: 'ללא גלוטן', price: 0 }],
      }],
    });
    expect(items[0].name).toBe('Burger (ללא גלוטן)');
  });

  it('hasExtras is false when all sub_items have zero price (notes only)', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [{
        id: '1', name: 'Steak', quantity: 1, unitPrice: 89, totalPrice: 89, category: 'food',
        sub_items: [{ name: 'well done', price: 0 }],
      }],
    });
    expect(items[0].hasExtras).toBe(false);
  });
});

describe('checkSubtotalMismatch', () => {
  it('returns null when items sum matches subtotal', () => {
    const items = parseReceiptToItems({
      ...baseReceipt,
      items: [
        { id: '1', name: 'A', quantity: 1, unitPrice: 40, totalPrice: 40, category: 'food' },
        { id: '2', name: 'B', quantity: 1, unitPrice: 60, totalPrice: 60, category: 'food' },
      ],
    });
    expect(checkSubtotalMismatch(items, 100)).toBeNull();
  });

  it('returns warning string when subtotal differs by more than 5 percent', () => {
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

  it('returns null when printedSubtotal is zero', () => {
    expect(checkSubtotalMismatch([], 0)).toBeNull();
  });
});
