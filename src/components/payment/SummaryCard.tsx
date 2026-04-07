import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CurrencyDisplay } from '../common/CurrencyDisplay';
import { Avatar } from '../common/Avatar';
import type { Person, PersonTotal } from '../../types/split.types';
import { formatCurrency } from '../../utils/currency';

interface SummaryCardProps {
  person: Person;
  total: PersonTotal;
  currency: string;
  index: number;
}

export function SummaryCard({ person, total, currency, index }: SummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  function copyToClipboard() {
    const text = t('summary.owes', { name: person.name, amount: formatCurrency(total.total, currency) });
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="bg-surface rounded-3xl border border-border overflow-hidden"
    >
      <button
        className="w-full flex items-center justify-between px-5 py-4"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3">
          <Avatar initials={person.avatar} color={person.color} size="md" />
          <span className="font-semibold text-primary">{person.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <CurrencyDisplay amount={total.total} currency={currency} className="text-lg font-bold text-primary" />
          {expanded ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 space-y-2">
              {total.items.map((item, i) => (
                <div key={i} className="flex justify-between items-center">
                  <span className="text-sm text-primary">
                    {item.name}
                    {item.shared && <span className="text-xs text-muted ms-1">{t('summary.sharedLabel')}</span>}
                  </span>
                  <CurrencyDisplay amount={item.amount} currency={currency} className="text-sm text-muted" />
                </div>
              ))}
              <div className="border-t border-border pt-2 space-y-1 mt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">{t('summary.subtotal')}</span>
                  <CurrencyDisplay amount={total.subtotal} currency={currency} className="text-muted" />
                </div>
                {total.tipAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">{t('summary.tip')}</span>
                    <CurrencyDisplay amount={total.tipAmount} currency={currency} className="text-muted" />
                  </div>
                )}
                {total.taxAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">{t('summary.tax')}</span>
                    <CurrencyDisplay amount={total.taxAmount} currency={currency} className="text-muted" />
                  </div>
                )}
                {total.serviceAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">{t('summary.service')}</span>
                    <CurrencyDisplay amount={total.serviceAmount} currency={currency} className="text-muted" />
                  </div>
                )}
              </div>
              <button
                onClick={copyToClipboard}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-border rounded-xl text-sm text-muted mt-3"
              >
                <Copy className="w-4 h-4" />
                {t('summary.copyOwes', { name: person.name, amount: formatCurrency(total.total, currency) })}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
