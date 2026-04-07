import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BackButton } from '../components/common/BackButton';
import { useSession } from '../context/SplitSessionContext';
import { ScreenContainer } from '../components/common/ScreenContainer';
import { CurrencyDisplay } from '../components/common/CurrencyDisplay';
import { calculateAllTotals } from '../services/splitCalculator';

const TIP_PRESETS = [10, 12, 15, 18, 20];

export function TipScreen() {
  const { session, setScreen, setTip, setTax } = useSession();
  const { tip, tax, currency, people, receiptItems, claims, serviceCharge } = session;
  const { t } = useTranslation();
  const [customTip, setCustomTip] = useState('');

  const totals = calculateAllTotals(
    people.map((p) => p.id),
    claims,
    receiptItems,
    tip,
    tax,
    serviceCharge
  );

  function selectPreset(pct: number) {
    setCustomTip('');
    setTip({ ...tip, mode: 'percent', value: pct });
  }

  function handleCustom(val: string) {
    setCustomTip(val);
    const num = parseFloat(val);
    if (!isNaN(num)) setTip({ ...tip, mode: 'percent', value: num });
  }

  return (
    <ScreenContainer>
      <div className="px-5 pt-12 pb-6">
        <div className="flex items-center justify-between mb-6">
          <BackButton screen="tip" />
          <p className="text-xs font-semibold text-muted">SplitSnap</p>
        </div>
        <h2 className="font-display text-3xl font-bold text-primary">{t('tip.title')}</h2>
        <p className="text-muted text-sm mt-1">{t('tip.subtitle')}</p>
      </div>

      <div className="px-5 space-y-5 pb-32 overflow-y-auto flex-1">
        {/* Tip presets */}
        <div>
          <p className="text-xs font-bold text-primary uppercase tracking-widest mb-3">{t('tip.amount')}</p>
          <div className="grid grid-cols-5 gap-2 mb-3">
            {TIP_PRESETS.map((pct) => (
              <motion.button
                key={pct}
                onClick={() => selectPreset(pct)}
                className={`py-3 rounded-2xl border text-sm font-bold transition-colors ${
                  tip.value === pct && !customTip
                    ? 'bg-accent border-accent text-white shadow-md shadow-accent/30'
                    : 'bg-surface border-border text-primary'
                }`}
                whileTap={{ scale: 0.97 }}
              >
                {pct}%
              </motion.button>
            ))}
          </div>
          <input
            type="number"
            placeholder={t('tip.customPct')}
            value={customTip}
            onChange={(e) => handleCustom(e.target.value)}
            className="w-full px-4 py-3 border border-border rounded-2xl text-sm bg-surface outline-none focus:border-accent"
          />
        </div>

        {/* Split mode */}
        <div>
          <p className="text-xs font-bold text-primary uppercase tracking-widest mb-3">{t('tip.splitBy')}</p>
          <div className="grid grid-cols-2 gap-2">
            {(['proportional', 'equal'] as const).map((mode) => (
              <motion.button
                key={mode}
                onClick={() => setTip({ ...tip, splitMode: mode })}
                className={`py-3 rounded-2xl border text-sm font-semibold transition-colors ${
                  tip.splitMode === mode
                    ? 'bg-primary border-primary text-white'
                    : 'bg-surface border-border text-primary'
                }`}
                whileTap={{ scale: 0.97 }}
              >
                {mode === 'proportional' ? t('tip.byOrderSize') : t('tip.splitEqually')}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Tax */}
        <div>
          <p className="text-xs font-bold text-primary uppercase tracking-widest mb-3">{t('tip.tax')}</p>
          {currency === 'ILS' ? (
            <div className="px-4 py-3.5 bg-surface border border-border rounded-2xl">
              <p className="text-sm text-muted">{t('tip.taxIncluded')}</p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.01"
                value={tax}
                onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
                className="flex-1 px-4 py-3 border border-border rounded-2xl text-sm bg-surface outline-none focus:border-accent"
              />
              <span className="text-muted text-sm font-medium">{currency}</span>
            </div>
          )}
        </div>

        {/* Live preview */}
        <div>
          <p className="text-xs font-bold text-primary uppercase tracking-widest mb-3">{t('tip.preview')}</p>
          <div className="bg-surface rounded-2xl border border-border overflow-hidden">
            {people.map((person) => {
              const t2 = totals[person.id];
              return (
                <div key={person.id} className="flex items-center justify-between px-4 py-3.5 border-b border-border last:border-b-0">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-bold"
                      style={{ backgroundColor: person.color }}
                    >
                      {person.avatar}
                    </div>
                    <span className="text-sm font-medium text-primary">{person.name}</span>
                  </div>
                  <CurrencyDisplay amount={t2?.total ?? 0} currency={currency} className="text-sm font-bold text-primary" />
                </div>
              );
            })}
            {people.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted">{t('tip.noPeople')}</div>
            )}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="fixed bottom-0 inset-x-0 p-5 bg-bg/95 backdrop-blur-md border-t border-border">
        <motion.button
          onClick={() => setScreen('summary')}
          className="w-full flex items-center justify-center gap-2 py-4 bg-accent text-white font-bold rounded-2xl shadow-lg shadow-accent/30"
          whileTap={{ scale: 0.97 }}
        >
          {t('tip.viewSummary')}
          <ChevronRight className="w-5 h-5" />
        </motion.button>
      </div>
    </ScreenContainer>
  );
}
