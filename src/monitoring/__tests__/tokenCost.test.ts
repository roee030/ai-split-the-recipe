import { describe, it, expect } from 'vitest';
import { calcScanCost } from '../tokenCost';

describe('calcScanCost', () => {
  it('sums tokens from both passes', () => {
    const result = calcScanCost(
      { inputTokens: 1000, outputTokens: 200 },
      { inputTokens: 500, outputTokens: 800 }
    );
    expect(result.totalInputTokens).toBe(1500);
    expect(result.totalOutputTokens).toBe(1000);
  });

  it('calculates cost with separate input/output rates', () => {
    // 1M input = $0.075
    const result = calcScanCost(
      { inputTokens: 1_000_000, outputTokens: 0 },
      { inputTokens: 0, outputTokens: 0 }
    );
    expect(result.estimatedCostUSD).toBeCloseTo(0.075, 6);
  });

  it('charges output at 4x the input rate', () => {
    const inputResult = calcScanCost(
      { inputTokens: 1000, outputTokens: 0 },
      { inputTokens: 0, outputTokens: 0 }
    );
    const outputResult = calcScanCost(
      { inputTokens: 0, outputTokens: 0 },
      { inputTokens: 0, outputTokens: 1000 }
    );
    expect(outputResult.estimatedCostUSD / inputResult.estimatedCostUSD).toBeCloseTo(4, 1);
  });

  it('preserves pass-level token breakdown', () => {
    const p1 = { inputTokens: 100, outputTokens: 50 };
    const p2 = { inputTokens: 200, outputTokens: 300 };
    const result = calcScanCost(p1, p2);
    expect(result.pass1).toEqual(p1);
    expect(result.pass2).toEqual(p2);
  });

  it('handles zero tokens without error', () => {
    const result = calcScanCost(
      { inputTokens: 0, outputTokens: 0 },
      { inputTokens: 0, outputTokens: 0 }
    );
    expect(result.estimatedCostUSD).toBe(0);
    expect(result.totalInputTokens).toBe(0);
    expect(result.totalOutputTokens).toBe(0);
  });
});
