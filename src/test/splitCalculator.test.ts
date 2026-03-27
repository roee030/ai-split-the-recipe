import { describe, it, expect } from 'vitest';
import { calculatePersonTotal, calculateAllTotals } from '../services/splitCalculator';
import type { ReceiptItem } from '../types/receipt.types';
import type { ItemClaim, TipConfig } from '../types/split.types';

const ITEMS: ReceiptItem[] = [
  { id: 'i1', name: 'Steak', quantity: 1, unitPrice: 82, totalPrice: 82, category: 'food', isEdited: false },
  { id: 'i2', name: 'Wine', quantity: 1, unitPrice: 45, totalPrice: 45, category: 'drink', isEdited: false },
  { id: 'i3', name: 'Hummus', quantity: 1, unitPrice: 24, totalPrice: 24, category: 'food', isEdited: false },
];

const CLAIMS: ItemClaim[] = [
  { itemId: 'i1', personIds: ['p1'] },
  { itemId: 'i2', personIds: ['p1'] },
  { itemId: 'i3', personIds: ['p1', 'p2'] },
];

const TIP: TipConfig = { mode: 'percent', value: 15, splitMode: 'proportional' };

describe('calculatePersonTotal', () => {
  it('calculates solo items correctly', () => {
    // p1 has steak (82) + wine (45) + half hummus (12) = 139
    const result = calculatePersonTotal('p1', CLAIMS, ITEMS, TIP, 11.12, 0, 151, 2);
    expect(result.subtotal).toBeCloseTo(139, 1);
    expect(result.tipAmount).toBeGreaterThan(0);
  });

  it('splits shared items equally', () => {
    // p2 has only half of hummus = 12
    const result = calculatePersonTotal('p2', CLAIMS, ITEMS, TIP, 11.12, 0, 151, 2);
    expect(result.subtotal).toBeCloseTo(12, 1);
  });

  it('total is sum of subtotal + tip + tax + service', () => {
    const result = calculatePersonTotal('p1', CLAIMS, ITEMS, TIP, 10, 0, 151, 2);
    expect(result.total).toBeCloseTo(result.subtotal + result.tipAmount + result.taxAmount + result.serviceAmount, 2);
  });

  it('two-person totals sum to grand total + tip + tax', () => {
    // grandSubtotal = 82 + 45 + 24 = 151
    // tip = 15% of 151 = 22.65
    // tax = 10
    // grandWithAll = 151 + 22.65 + 10 = 183.65
    const p1 = calculatePersonTotal('p1', CLAIMS, ITEMS, TIP, 10, 0, 151, 2);
    const p2 = calculatePersonTotal('p2', CLAIMS, ITEMS, TIP, 10, 0, 151, 2);
    const expectedGrand = 151 * 1.15 + 10;
    expect(p1.total + p2.total).toBeCloseTo(expectedGrand, 1);
  });
});

describe('calculateAllTotals', () => {
  it('returns totals for all people', () => {
    const result = calculateAllTotals(['p1', 'p2'], CLAIMS, ITEMS, TIP, 0, 0);
    expect(result).toHaveProperty('p1');
    expect(result).toHaveProperty('p2');
  });
});
