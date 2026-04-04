import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── We test the helpers via the exported scanReceipt function
// ─── using mocked adapters. The helpers are private so we test
// ─── their behaviour through the public API.

// Mock llmAdapters so no real API calls are made
vi.mock('./llmAdapters', () => ({
  transcribeImage:     vi.fn(),
  structureTranscript: vi.fn(),
  magicFix:            vi.fn(),
}));

// Mock providers to a non-flash primary so the fallback guard
// (primary !== 'gemini-2.0-flash') fires correctly in retry tests.
vi.mock('../config/providers', () => ({
  PROVIDERS: {
    pass1:  'gemini-2.5-flash',
    pass2:  'gemini-2.5-flash',
    magic:  'gemini-2.5-flash',
  },
}));

import { scanReceipt } from './geminiVision';
import * as adapters from './llmAdapters';
import type { ParsedReceipt } from '../types/receipt.types';

// Helpers
const mockTokens = { inputTokens: 10, outputTokens: 20 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReceipt(overrides: Record<string, any> = {}): ParsedReceipt {
  return {
    isReceipt: true,
    receipt_type: 'restaurant',
    restaurantName: 'Test',
    items: [
      { id: '1', name: 'Item A', quantity: 1, unitPrice: 50, totalPrice: 50, category: 'food', unit_price: 50, total_price: 50 },
    ],
    subtotal: 50,
    tax: null,
    taxPercent: null,
    serviceCharge: null,
    total: null,
    currency: 'ILS',
    confidence: 'high',
    ...overrides,
  } as ParsedReceipt;
}

// ─── callWithFallback behaviour ───────────────────────────────────

describe('callWithFallback — Pass 1 retries on 429', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retries with gemini-2.0-flash when primary throws TOO_MANY_REQUESTS', async () => {
    vi.mocked(adapters.transcribeImage)
      .mockRejectedValueOnce(new Error('TOO_MANY_REQUESTS'))
      .mockResolvedValueOnce({ transcript: 'Line1', tokens: mockTokens });

    vi.mocked(adapters.structureTranscript)
      .mockResolvedValue({ receipt: makeReceipt(), tokens: mockTokens });

    const result = await scanReceipt(new Blob(['img']), 'image/jpeg');
    expect(adapters.transcribeImage).toHaveBeenCalledTimes(2);
    expect(result.receipt.isReceipt).toBe(true);
  });

  it('does NOT retry on DAILY_QUOTA_EXCEEDED', async () => {
    vi.mocked(adapters.transcribeImage)
      .mockRejectedValue(new Error('DAILY_QUOTA_EXCEEDED'));

    await expect(
      scanReceipt(new Blob(['img']), 'image/jpeg')
    ).rejects.toThrow('DAILY_QUOTA_EXCEEDED');

    expect(adapters.transcribeImage).toHaveBeenCalledTimes(1);
  });

  it('propagates error when fallback also fails (no infinite loop)', async () => {
    // Primary (2.5-flash) fails → fallback (2.0-flash) also fails → error thrown, 2 total calls
    vi.mocked(adapters.transcribeImage)
      .mockRejectedValueOnce(new Error('TOO_MANY_REQUESTS'))  // primary
      .mockRejectedValueOnce(new Error('TOO_MANY_REQUESTS')); // fallback

    await expect(
      scanReceipt(new Blob(['img']), 'image/jpeg')
    ).rejects.toThrow('TOO_MANY_REQUESTS');

    expect(adapters.transcribeImage).toHaveBeenCalledTimes(2);
  });

  it('retries on HTTP_500', async () => {
    vi.mocked(adapters.transcribeImage)
      .mockRejectedValueOnce(new Error('HTTP_500'))
      .mockResolvedValueOnce({ transcript: 'Line1', tokens: mockTokens });

    vi.mocked(adapters.structureTranscript)
      .mockResolvedValue({ receipt: makeReceipt(), tokens: mockTokens });

    await scanReceipt(new Blob(['img']), 'image/jpeg');
    expect(adapters.transcribeImage).toHaveBeenCalledTimes(2);
  });
});

// ─── validateReceiptMath + auto-fix ──────────────────────────────

describe('auto-magic-fix fires on math mismatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires magicFix when items sum differs from subtotal by >5%', async () => {
    const mismatchedReceipt = makeReceipt({
      items: [{ name: 'A', quantity: 1, unit_price: 40, total_price: 40 }],
      subtotal: 50,
    });
    const fixedReceipt = makeReceipt({
      subtotal: 50,
      items: [{ name: 'A', quantity: 1, unit_price: 50, total_price: 50 }],
    });

    vi.mocked(adapters.transcribeImage)
      .mockResolvedValue({ transcript: 'receipt text', tokens: mockTokens });
    vi.mocked(adapters.structureTranscript)
      .mockResolvedValue({ receipt: mismatchedReceipt, tokens: mockTokens });
    vi.mocked(adapters.magicFix)
      .mockResolvedValue(fixedReceipt);

    const result = await scanReceipt(new Blob(['img']), 'image/jpeg');

    expect(adapters.magicFix).toHaveBeenCalledTimes(1);
    expect(result.autoFixed).toBe(true);
    expect(result.receipt.items[0].total_price).toBe(50);
  });

  it('does NOT fire magicFix when math matches', async () => {
    vi.mocked(adapters.transcribeImage)
      .mockResolvedValue({ transcript: 'text', tokens: mockTokens });
    vi.mocked(adapters.structureTranscript)
      .mockResolvedValue({ receipt: makeReceipt(), tokens: mockTokens });

    const result = await scanReceipt(new Blob(['img']), 'image/jpeg');

    expect(adapters.magicFix).not.toHaveBeenCalled();
    expect(result.autoFixed).toBe(false);
  });

  it('does NOT fire magicFix when subtotal is null', async () => {
    vi.mocked(adapters.transcribeImage)
      .mockResolvedValue({ transcript: 'text', tokens: mockTokens });
    vi.mocked(adapters.structureTranscript)
      .mockResolvedValue({ receipt: makeReceipt({ subtotal: null }), tokens: mockTokens });

    const result = await scanReceipt(new Blob(['img']), 'image/jpeg');

    expect(adapters.magicFix).not.toHaveBeenCalled();
    expect(result.autoFixed).toBe(false);
  });

  it('returns Pass 2 result gracefully when magicFix times out', async () => {
    const mismatchedReceipt = makeReceipt({
      items: [{ name: 'A', quantity: 1, unit_price: 40, total_price: 40 }],
      subtotal: 50,
    });

    vi.mocked(adapters.transcribeImage)
      .mockResolvedValue({ transcript: 'text', tokens: mockTokens });
    vi.mocked(adapters.structureTranscript)
      .mockResolvedValue({ receipt: mismatchedReceipt, tokens: mockTokens });
    vi.mocked(adapters.magicFix)
      .mockImplementation(() => new Promise(() => {}));

    const result = await scanReceipt(new Blob(['img']), 'image/jpeg', undefined, 100);

    expect(result.autoFixed).toBe(false);
    expect(result.receipt).toEqual(mismatchedReceipt);
  });
});
