import { motion } from 'framer-motion';
import { Share2, RotateCcw, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';
import { useSession } from '../context/SplitSessionContext';
import { ScreenContainer } from '../components/common/ScreenContainer';
import { SummaryCard } from '../components/payment/SummaryCard';
import { calculateAllTotals } from '../services/splitCalculator';
import { formatCurrency } from '../utils/currency';
import { CurrencyDisplay } from '../components/common/CurrencyDisplay';

export function SummaryScreen() {
  const { session, setScreen, reset } = useSession();
  const { people, receiptItems, claims, tip, tax, serviceCharge, currency, restaurantName } = session;

  const totals = calculateAllTotals(
    people.map((p) => p.id),
    claims,
    receiptItems,
    tip,
    tax,
    serviceCharge
  );

  const grandTotal = receiptItems.reduce((s, i) => s + i.totalPrice, 0) + tax + serviceCharge;
  const splitTotal = Object.values(totals).reduce((s, t) => s + t.total, 0);
  const diff = Math.abs(grandTotal - splitTotal);
  const checksOut = diff < 0.05;

  function shareAll() {
    const text = people
      .map((p) => `${p.name}: ${formatCurrency(totals[p.id]?.total ?? 0, currency)}`)
      .join('\n');
    if (navigator.share) {
      navigator.share({ title: `${restaurantName ?? 'Bill'} Split`, text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  return (
    <ScreenContainer>
      <div className="px-5 pt-12 pb-6">
        <div className="flex items-center justify-between mb-6">
          <p className="text-xs font-bold text-accent uppercase tracking-widest">Step 04 of 04</p>
          <p className="text-xs font-semibold text-muted">SplitSnap</p>
        </div>
        <button onClick={() => setScreen('tip')} className="text-muted mb-4 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back</span>
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-3xl font-bold text-primary">Summary</h2>
            <p className="text-muted text-sm mt-1">{restaurantName ?? 'Bill Split'}</p>
          </div>
          {checksOut ? (
            <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
              <CheckCircle className="w-3.5 h-3.5 text-green-600" />
              <span className="text-green-700 text-xs font-bold">Balanced</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-amber-700 text-xs font-bold">{formatCurrency(diff, currency)} off</span>
            </div>
          )}
        </div>
      </div>

      {/* Grand total banner */}
      <div className="px-5 mb-4">
        <div className="rounded-2xl px-5 py-4 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #0D0D1A 0%, #1a1040 100%)' }}>
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wider font-semibold">Grand Total</p>
            <CurrencyDisplay amount={grandTotal} currency={currency} className="font-display text-2xl font-bold text-white" />
          </div>
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wider font-semibold text-right">People</p>
            <p className="font-display text-2xl font-bold text-white text-right">{people.length}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-40 space-y-3">
        <p className="text-xs font-bold text-primary uppercase tracking-widest mb-1">The Ledger</p>
        {people.map((person, i) => (
          <SummaryCard
            key={person.id}
            person={person}
            total={totals[person.id]}
            currency={currency}
            index={i}
          />
        ))}
        {people.length === 0 && (
          <div className="text-center py-12 text-muted text-sm">No people to summarize</div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="fixed bottom-0 left-0 right-0 p-5 bg-bg/95 backdrop-blur-md border-t border-border space-y-3">
        <div className="flex gap-3">
          <motion.button
            onClick={shareAll}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-surface border border-border rounded-2xl text-primary font-semibold text-sm"
            whileTap={{ scale: 0.97 }}
          >
            <Share2 className="w-4 h-4" />
            Share All
          </motion.button>
          <motion.button
            onClick={() => setScreen('roundrobin')}
            className="flex-1 py-3.5 bg-accent text-white font-bold rounded-2xl text-sm shadow-lg shadow-accent/30"
            whileTap={{ scale: 0.97 }}
          >
            Round Robin 📱
          </motion.button>
        </div>
        <button
          onClick={reset}
          className="w-full flex items-center justify-center gap-2 py-3 text-muted text-sm"
        >
          <RotateCcw className="w-4 h-4" />
          Start over
        </button>
      </div>
    </ScreenContainer>
  );
}
