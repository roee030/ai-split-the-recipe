import { formatCurrency } from '../../utils/currency';

interface CurrencyDisplayProps {
  amount: number;
  currency: string;
  className?: string;
}

export function CurrencyDisplay({ amount, currency, className = '' }: CurrencyDisplayProps) {
  return <span className={className}>{formatCurrency(amount, currency)}</span>;
}
