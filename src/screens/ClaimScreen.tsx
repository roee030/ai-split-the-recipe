import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Users } from 'lucide-react';
import { useSession } from '../context/SplitSessionContext';
import { ScreenContainer } from '../components/common/ScreenContainer';
import { PersonSwitcher } from '../components/claim/PersonSwitcher';
import { ItemCard } from '../components/claim/ItemCard';
import { SharedModal } from '../components/claim/SharedModal';
import { CurrencyDisplay } from '../components/common/CurrencyDisplay';
import { calculatePersonTotal } from '../services/splitCalculator';
import type { ReceiptItem } from '../types/receipt.types';

export function ClaimScreen() {
  const {
    session,
    setScreen,
    activePersonIndex,
    setActivePersonIndex,
    claimItem,
    setClaimQuantity,
    setSharedClaim,
    splitRemainingEvenly,
    unclaimedCount,
  } = useSession();
  const { receiptItems, people, claims, currency, tip, tax, serviceCharge } = session;
  const [sharedItem, setSharedItem] = useState<ReceiptItem | null>(null);
  const [privateMode, setPrivateMode] = useState(false);
  const [showCover, setShowCover] = useState(false);

  const activePerson = people[activePersonIndex];
  if (!activePerson) return null;

  const claimCounts: Record<string, number> = {};
  for (const claim of claims) {
    for (const pid of claim.personIds) {
      claimCounts[pid] = (claimCounts[pid] ?? 0) + 1;
    }
  }

  // Progress calculation
  const totalItems = receiptItems.length;
  const claimedItems = totalItems - unclaimedCount;
  const progressPct = totalItems > 0 ? Math.round((claimedItems / totalItems) * 100) : 0;

  // Grand total and claimed amount
  const grandTotal = receiptItems.reduce((s, i) => s + i.totalPrice, 0) + tax + serviceCharge;
  const claimedTotal = receiptItems
    .filter(item => claims.find(c => c.itemId === item.id))
    .reduce((s, i) => s + i.totalPrice, 0);

  // Live share for active person
  const myTotal = calculatePersonTotal(
    activePerson.id,
    claims,
    receiptItems,
    tip,
    tax,
    serviceCharge,
    grandTotal,
    people.length
  );

  function handleSelectPerson(index: number) {
    setActivePersonIndex(index);
    if (privateMode) setShowCover(true);
  }

  // Claim all unclaimed for active person
  function claimAllUnclaimed() {
    receiptItems.forEach(item => {
      if (!claims.find(c => c.itemId === item.id)) {
        claimItem(item.id, activePerson.id);
      }
    });
  }

  return (
    <ScreenContainer className="pb-32">
      {/* Header */}
      <div className="px-5 pt-12 pb-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setScreen('people')} className="text-muted">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="font-display text-lg font-bold text-primary">SplitSnap</h1>
          </div>
          <div className="flex items-center gap-2">
            {people.length > 1 && (
              <span className="text-xs font-bold text-muted uppercase tracking-wide">
                {people.length} People
              </span>
            )}
            <button
              onClick={() => setPrivateMode((v) => !v)}
              className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${
                privateMode
                  ? 'bg-primary text-white border-primary'
                  : 'border-border text-muted bg-surface'
              }`}
            >
              {privateMode ? '🔒' : '👁'}
            </button>
          </div>
        </div>
      </div>

      {/* Person chips */}
      <PersonSwitcher
        people={people}
        activeIndex={activePersonIndex}
        onSelect={handleSelectPerson}
        claimCounts={claimCounts}
      />

      {/* Claims status card */}
      <div className="px-5 mb-4">
        <div className="bg-surface border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-muted uppercase tracking-wider">Claims Status</p>
            <span className="text-xs font-bold text-accent">{progressPct}%</span>
          </div>
          <div className="flex items-baseline gap-1.5 mb-3">
            <CurrencyDisplay amount={claimedTotal} currency={currency} className="font-display text-xl font-bold text-primary" />
            <span className="text-muted text-sm">/</span>
            <CurrencyDisplay amount={grandTotal} currency={currency} className="text-sm text-muted" />
          </div>
          {/* Progress bar */}
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
          {/* Action buttons */}
          {unclaimedCount > 0 && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={splitRemainingEvenly}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-primary/5 border border-border rounded-xl text-xs font-semibold text-primary"
              >
                <Users className="w-3.5 h-3.5" />
                Split remaining evenly
              </button>
              <button
                onClick={claimAllUnclaimed}
                className="flex-1 py-2.5 bg-primary/5 border border-border rounded-xl text-xs font-semibold text-primary"
              >
                Claim all unassigned
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-5 space-y-2">
        {/* Ledger header */}
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display text-xs font-bold text-primary uppercase tracking-widest">The Ledger</h3>
        </div>

        {receiptItems.map((item) => {
          const claim = claims.find((c) => c.itemId === item.id);
          return (
            <ItemCard
              key={item.id}
              item={item}
              claim={claim}
              activePerson={activePerson}
              people={people}
              currency={currency}
              myQuantity={claim?.quantityPerPerson?.[activePerson.id]}
              onTap={() => claimItem(item.id, activePerson.id)}
              onLongPress={() => setSharedItem(item)}
              onSetQuantity={(qty) => setClaimQuantity(item.id, activePerson.id, qty)}
              hideClaimants={privateMode}
            />
          );
        })}
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-bg/95 backdrop-blur-md border-t border-border">
        <div className="px-5 py-4 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-bold text-muted uppercase tracking-wide">Your Share</p>
            <CurrencyDisplay amount={myTotal.subtotal} currency={currency} className="font-display text-xl font-bold text-primary" />
          </div>
          <motion.button
            onClick={() => setScreen('tip')}
            disabled={people.length > 1 && unclaimedCount > 0}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-accent text-white font-bold rounded-2xl disabled:opacity-40 shadow-lg shadow-accent/30 text-sm"
            whileTap={{ scale: 0.97 }}
          >
            {people.length === 1
              ? 'See My Total'
              : unclaimedCount === 0
                ? 'Submit Claims'
                : `${unclaimedCount} unclaimed`}
            <span>→</span>
          </motion.button>
        </div>
      </div>

      {/* Shared modal */}
      <SharedModal
        open={sharedItem !== null}
        item={sharedItem}
        people={people}
        currentPersonIds={claims.find((c) => c.itemId === sharedItem?.id)?.personIds ?? []}
        isSolo={people.length === 1}
        onConfirm={(ids, sharedUnitsOrSoloCount) => {
          if (!sharedItem) return;
          if (people.length === 1) {
            setClaimQuantity(sharedItem.id, activePerson.id, 1 / sharedUnitsOrSoloCount);
          } else {
            setSharedClaim(sharedItem.id, ids, sharedUnitsOrSoloCount);
          }
        }}
        onClose={() => setSharedItem(null)}
      />

      {/* Private mode cover screen */}
      <AnimatePresence>
        {showCover && activePerson && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-bg z-50 flex flex-col items-center justify-center gap-6 px-8"
          >
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold"
              style={{ backgroundColor: activePerson.color }}
            >
              {activePerson.avatar}
            </div>
            <div className="text-center">
              <h2 className="font-display text-2xl font-bold text-primary">
                Pass to {activePerson.name}
              </h2>
              <p className="text-muted text-sm mt-2">
                Hand the phone to {activePerson.name}
              </p>
            </div>
            <motion.button
              onClick={() => setShowCover(false)}
              className="w-full max-w-xs py-4 bg-primary text-white font-semibold rounded-2xl"
              whileTap={{ scale: 0.97 }}
            >
              I'm ready — show my items
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </ScreenContainer>
  );
}
