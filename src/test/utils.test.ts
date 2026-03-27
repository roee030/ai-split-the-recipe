import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../utils/currency';
import { containsHebrew } from '../utils/hebrewDetection';
import { getPersonColor, getPersonInitials } from '../utils/colorPalette';

describe('formatCurrency', () => {
  it('formats ILS with shekel symbol', () => {
    expect(formatCurrency(12.5, 'ILS')).toBe('₪12.50');
  });
  it('formats USD with dollar symbol', () => {
    expect(formatCurrency(9.99, 'USD')).toBe('$9.99');
  });
  it('rounds to 2 decimal places', () => {
    expect(formatCurrency(10.556, 'ILS')).toBe('₪10.56');
  });
});

describe('containsHebrew', () => {
  it('returns true for Hebrew text', () => {
    expect(containsHebrew('שלום')).toBe(true);
  });
  it('returns false for English', () => {
    expect(containsHebrew('hello')).toBe(false);
  });
  it('returns true for mixed', () => {
    expect(containsHebrew('Coca Cola קוקה')).toBe(true);
  });
});

describe('getPersonColor', () => {
  it('returns first color for index 0', () => {
    expect(getPersonColor(0)).toBe('#FF6B35');
  });
  it('wraps around after 8 colors', () => {
    expect(getPersonColor(8)).toBe('#FF6B35');
  });
});

describe('getPersonInitials', () => {
  it('returns first letter uppercase for single name', () => {
    expect(getPersonInitials('roee')).toBe('R');
  });
  it('returns first letters of two words', () => {
    expect(getPersonInitials('John Doe')).toBe('JD');
  });
  it('returns ? for empty name', () => {
    expect(getPersonInitials('')).toBe('?');
  });
});
