import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '../context/SplitSessionContext';
import { calculateAllTotals } from '../services/splitCalculator';
import { AnimatedNumber } from '../components/common/AnimatedNumber';
import { getCurrencySymbol } from '../utils/currency';

export function RoundRobinScreen() {
  const { session } = useSession();
  const { people, receiptItems, claims, tip, tax, serviceCharge, currency } = session;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);

  const totals = calculateAllTotals(
    people.map((p) => p.id),
    claims,
    receiptItems,
    tip,
    tax,
    serviceCharge
  );

  const current = people[currentIndex];
  const currentTotal = totals[current?.id ?? ''];

  function next() {
    if (currentIndex < people.length - 1) {
      setCurrentIndex((i) => i + 1);
      setRevealed(false);
    } else {
      setDone(true);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-success flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 15 }}
          className="text-6xl mb-6"
        >
          ✅
        </motion.div>
        <h2 className="font-display text-3xl font-bold text-white mb-2">All done!</h2>
        <p className="text-white/80 mb-8">Everyone's seen their total</p>
        <button
          onClick={() => window.history.back()}
          className="px-8 py-4 bg-white text-success font-bold rounded-2xl"
        >
          Back to Summary
        </button>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-muted">No people to show</p>
      </div>
    );
  }

  if (!revealed) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-6"
        >
          <div className="text-5xl">📱</div>
          <div>
            <p className="text-muted text-sm mb-2">Pass phone to</p>
            <h2 className="font-display text-4xl font-bold text-primary">{current.name}</h2>
          </div>
          <p className="text-muted text-sm">
            ({currentIndex + 1} of {people.length})
          </p>
          <motion.button
            onClick={() => setRevealed(true)}
            className="mt-4 px-10 py-5 bg-primary text-white text-lg font-bold rounded-3xl shadow-xl"
            whileTap={{ scale: 0.96 }}
          >
            Show my total →
          </motion.button>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ backgroundColor: `${current.color}15` }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key="revealed"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-4 w-full max-w-sm"
        >
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white mb-2"
            style={{ backgroundColor: current.color }}
          >
            {current.avatar}
          </div>
          <p className="text-muted text-sm">{current.name}, you owe</p>
          <div className="font-display text-6xl font-bold text-primary">
            {getCurrencySymbol(currency)}
            <AnimatedNumber value={currentTotal?.total ?? 0} format={(n) => n.toFixed(2)} />
          </div>

          {/* Breakdown */}
          <div className="w-full mt-4 space-y-2 bg-surface/80 rounded-2xl p-4">
            {currentTotal?.items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm text-muted">
                <span>{item.name}{item.shared ? ' (shared)' : ''}</span>
                <span>{getCurrencySymbol(currency)}{item.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>

          <motion.button
            onClick={next}
            className="mt-6 px-10 py-4 bg-primary text-white font-bold rounded-3xl"
            whileTap={{ scale: 0.96 }}
          >
            {currentIndex < people.length - 1
              ? `Done — Pass to ${people[currentIndex + 1]?.name} →`
              : 'Finish ✓'}
          </motion.button>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
