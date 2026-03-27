const SYMBOLS: Record<string, string> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function getCurrencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? currency;
}

export function formatCurrency(amount: number, currency: string): string {
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${amount.toFixed(2)}`;
}
