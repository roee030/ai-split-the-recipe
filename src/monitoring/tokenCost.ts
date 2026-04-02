export interface PassTokens {
  inputTokens: number;
  outputTokens: number;
}

export interface ScanTokens {
  pass1: PassTokens;
  pass2: PassTokens;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUSD: number;
}

const INPUT_COST_PER_TOKEN  = 0.075 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 0.30  / 1_000_000;

export function calcScanCost(pass1: PassTokens, pass2: PassTokens): ScanTokens {
  const totalInputTokens  = pass1.inputTokens  + pass2.inputTokens;
  const totalOutputTokens = pass1.outputTokens + pass2.outputTokens;
  const estimatedCostUSD  =
    totalInputTokens  * INPUT_COST_PER_TOKEN +
    totalOutputTokens * OUTPUT_COST_PER_TOKEN;

  return { pass1, pass2, totalInputTokens, totalOutputTokens, estimatedCostUSD };
}
