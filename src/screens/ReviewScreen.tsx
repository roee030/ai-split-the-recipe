import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Edit3, ChevronRight, CheckCircle2, Sparkles } from 'lucide-react';
import { useSession } from '../context/SplitSessionContext';
import { ScreenContainer } from '../components/common/ScreenContainer';
import { CurrencyDisplay } from '../components/common/CurrencyDisplay';
import { BackButton } from '../components/common/BackButton';
import { createManualItem, checkSubtotalMismatch } from '../services/receiptParser';

// Simple category icon based on item name keywords
function getItemIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('beef') || n.includes('steak') || n.includes('ribeye') || n.includes('wagyu') || n.includes('burger')) return '🥩';
  if (n.includes('chicken') || n.includes('poultry') || n.includes('duck')) return '🍗';
  if (n.includes('fish') || n.includes('salmon') || n.includes('tuna') || n.includes('sea')) return '🐟';
  if (n.includes('pizza')) return '🍕';
  if (n.includes('pasta') || n.includes('spaghetti') || n.includes('fettuccine')) return '🍝';
  if (n.includes('salad') || n.includes('greens')) return '🥗';
  if (n.includes('soup')) return '🍲';
  if (n.includes('dessert') || n.includes('cake') || n.includes('ice cream') || n.includes('tiramisu') || n.includes('gelato')) return '🍰';
  if (n.includes('wine') || n.includes('vino') || n.includes('bordeaux') || n.includes('margaux') || n.includes('chateau')) return '🍷';
  if (n.includes('beer') || n.includes('ale') || n.includes('lager')) return '🍺';
  if (n.includes('cocktail') || n.includes('mojito') || n.includes('martini')) return '🍸';
  if (n.includes('coffee') || n.includes('espresso') || n.includes('cappuccino') || n.includes('latte')) return '☕';
  if (n.includes('water') || n.includes('juice') || n.includes('soda') || n.includes('drink')) return '🥤';
  if (n.includes('bread') || n.includes('roll') || n.includes('focaccia')) return '🍞';
  if (n.includes('sushi') || n.includes('roll') || n.includes('maki')) return '🍣';
  if (n.includes('gratuity') || n.includes('service') || n.includes('tip') || n.includes('charge')) return '💳';
  if (n.includes('tax') || n.includes('vat')) return '📋';
  return '🍽️';
}

export function ReviewScreen() {
  const { session, setScreen, updateItem, deleteItem, addItem, setServiceCharge } = useSession();
  const { receiptItems, currency, restaurantName, tax, serviceCharge, subtotal, scanConfidence } = session;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [serviceAsTip, setServiceAsTip] = useState<boolean | null>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  function handleAddManual() {
    const item = createManualItem();
    addItem(item);
    setEditingId(item.id);
  }
  const grandTotal = receiptItems.reduce((s, i) => s + i.totalPrice, 0);
  const subtotalWarning = checkSubtotalMismatch(receiptItems, subtotal ?? null);

  return (
    <ScreenContainer>
      {/* Header */}
      <div className="px-5 pt-12 pb-4">
        <BackButton screen="review" className="mb-3" />
        <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-1">Merchant</p>
        <h2 className="font-display text-2xl font-bold text-primary leading-tight">
          {restaurantName ?? 'Your Receipt'}
        </h2>
      </div>

      {/* Grand Total card */}
      <div className="px-5 mb-4">
        <div className="rounded-3xl p-5" style={{ background: 'linear-gradient(135deg, #0D0D1A 0%, #1a1040 100%)' }}>
          <div className="flex items-start justify-between mb-1">
            <p className="text-white/50 text-xs uppercase tracking-wider font-semibold">Grand Total</p>
            <div className="flex items-center gap-1 bg-green-500/20 border border-green-500/30 rounded-full px-2.5 py-1">
              <CheckCircle2 className="w-3 h-3 text-green-400" />
              <span className="text-green-400 text-[10px] font-bold tracking-wide">Precision Scan Active</span>
            </div>
          </div>
          <CurrencyDisplay
            amount={grandTotal + tax + serviceCharge}
            currency={currency}
            className="font-display text-4xl font-bold text-white"
          />
          <p className="text-white/40 text-xs mt-2">{receiptItems.length} item{receiptItems.length !== 1 ? 's' : ''} detected</p>
        </div>
      </div>

      {/* Service charge banner */}
      <AnimatePresence>
        {serviceCharge > 0 && serviceAsTip === null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-5 mb-4"
          >
            <div className="bg-accent/10 border border-accent/25 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <p className="text-sm font-semibold text-primary">Identify Gratuity</p>
                </div>
                <p className="text-xs text-muted">
                  Service charge of <CurrencyDisplay amount={serviceCharge} currency={currency} className="font-bold text-primary" /> detected
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setServiceAsTip(true); setServiceCharge(0); }}
                  className="px-3 py-2 bg-accent text-white text-xs font-semibold rounded-xl"
                >
                  As Tip
                </button>
                <button
                  onClick={() => { setServiceAsTip(false); setServiceCharge(serviceCharge); }}
                  className="px-3 py-2 border border-border text-primary text-xs font-medium rounded-xl"
                >
                  Keep
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Low confidence warning */}
      {scanConfidence === 'low' && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-5 mb-3 p-3 bg-red-50 border border-red-200 rounded-2xl flex gap-2 items-start"
        >
          <span className="text-lg flex-shrink-0">🔍</span>
          <p className="text-xs text-red-700 font-medium leading-snug">
            Low scan confidence — the receipt may be blurry or partially cut off. Please check every item name and price carefully before continuing.
          </p>
        </motion.div>
      )}

      {/* Subtotal mismatch warning */}
      {subtotalWarning && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-5 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex gap-2 items-start"
        >
          <span className="text-lg flex-shrink-0">⚠️</span>
          <p className="text-xs text-amber-700 font-medium leading-snug">{subtotalWarning}</p>
        </motion.div>
      )}

      {/* Items list */}
      <div className="flex-1 overflow-y-auto px-5 pb-32">
        {/* Ledger header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-xs font-bold text-primary uppercase tracking-widest">Itemized Ledger</h3>
          <button onClick={handleAddManual} className="flex items-center gap-1 text-accent text-xs font-semibold">
            <Plus className="w-3.5 h-3.5" />
            Add Item
          </button>
        </div>

        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <AnimatePresence>
            {receiptItems.map((item, idx) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                className="border-b border-border last:border-b-0"
              >
                {editingId === item.id ? (
                  <div className="p-4 space-y-2">
                    <input
                      className="w-full text-sm font-medium text-primary bg-bg border border-border rounded-xl px-3 py-2.5 outline-none focus:border-accent"
                      value={item.name}
                      onChange={(e) => updateItem(item.id, { name: e.target.value })}
                      placeholder="Item name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          priceInputRef.current?.focus();
                        }
                      }}
                    />
                    <div className="flex gap-2">
                      <input
                        type="number"
                        className="w-16 text-sm text-center bg-bg border border-border rounded-xl px-2 py-2 outline-none"
                        value={item.quantity}
                        min={1}
                        onChange={(e) => {
                          const q = Number(e.target.value) || 1;
                          updateItem(item.id, { quantity: q, totalPrice: item.unitPrice * q });
                        }}
                      />
                      <span className="text-muted self-center text-sm">×</span>
                      <input
                        ref={priceInputRef}
                        type="number"
                        className="flex-1 text-sm bg-bg border border-border rounded-xl px-3 py-2 outline-none focus:border-accent"
                        value={item.unitPrice}
                        step="0.01"
                        onChange={(e) => {
                          const p = Number(e.target.value) || 0;
                          updateItem(item.id, { unitPrice: p, totalPrice: p * item.quantity });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setEditingId(null);
                        }}
                      />
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-2 bg-primary text-white text-xs font-semibold rounded-xl"
                      >
                        Done
                      </button>
                    </div>
                    {editingId === item.id && item.flagged && (
                      <p className="text-[10px] text-amber-600 mt-0.5 px-1">
                        ⚠️ Unit price was recalculated from the charged total. Please verify.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <span className="text-muted text-xs font-semibold w-5 text-right flex-shrink-0">{idx + 1}</span>
                    <span className="text-lg flex-shrink-0">{getItemIcon(item.name)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        {item.quantity > 1 && (
                          <span className="text-xs text-muted font-medium">{item.quantity}×</span>
                        )}
                        <span className="text-sm font-medium text-primary truncate">{item.name}</span>
                        {item.flagged && (
                          <span title="Price math doesn't add up — please check manually" className="text-amber-500 text-xs">⚠️</span>
                        )}
                      </div>
                    </div>
                    <CurrencyDisplay
                      amount={item.totalPrice}
                      currency={currency}
                      className="text-sm font-bold text-primary whitespace-nowrap"
                    />
                    <button onClick={() => setEditingId(item.id)} className="text-muted p-1">
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteItem(item.id)} className="text-red-400 p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Tax row */}
          {tax > 0 && (
            <div className="flex items-center gap-3 px-4 py-3.5 border-t border-border">
              <span className="text-muted text-xs font-semibold w-5 text-right flex-shrink-0">—</span>
              <span className="text-lg flex-shrink-0">📋</span>
              <span className="flex-1 text-sm text-muted">Tax</span>
              <CurrencyDisplay amount={tax} currency={currency} className="text-sm text-muted font-medium" />
            </div>
          )}

          {/* Empty state */}
          {receiptItems.length === 0 && (
            <div className="text-center py-10 text-muted text-sm">
              <p className="text-3xl mb-2">🧾</p>
              No items yet. Tap "Add Item" above.
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-bg/95 backdrop-blur-md border-t border-border">
        <div className="flex items-center gap-3">
          <div className="flex-1 px-4 py-3 bg-surface border border-border rounded-2xl">
            <p className="text-xs text-muted">Subtotal</p>
            <CurrencyDisplay amount={grandTotal} currency={currency} className="text-base font-bold text-primary" />
          </div>
          <motion.button
            onClick={() => setScreen('people')}
            className="flex-1 flex items-center justify-center gap-2 py-4 bg-accent text-white font-semibold rounded-2xl shadow-lg shadow-accent/30"
            whileTap={{ scale: 0.97 }}
          >
            Confirm
            <ChevronRight className="w-4 h-4" />
          </motion.button>
        </div>
      </div>
    </ScreenContainer>
  );
}
