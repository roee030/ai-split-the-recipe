import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Edit3, ChevronRight, CheckCircle2, Sparkles } from 'lucide-react';
import { useSession } from '../context/SplitSessionContext';
import { ScreenContainer } from '../components/common/ScreenContainer';
import { CurrencyDisplay } from '../components/common/CurrencyDisplay';
import { BackButton } from '../components/common/BackButton';
import { createManualItem, checkSubtotalMismatch, parseReceiptToItems } from '../services/receiptParser';
import { geminiReVerify } from '../services/geminiVision';
import { monitoring } from '../monitoring';
import { trackManualCorrection } from '../utils/correctionDictionary';

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
  const { session, setScreen, updateItem, deleteItem, addItem, setServiceCharge, setReceiptItems } = useSession();
  const { receiptItems, currency, restaurantName, tax, serviceCharge, subtotal, scanConfidence, lastTranscript, debugImageUrl, autoFixed } = session;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [serviceAsTip, setServiceAsTip] = useState<boolean | null>(null);
  const [magicFixLoading, setMagicFixLoading] = useState(false);
  const [magicFixFailed, setMagicFixFailed] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const priceInputRef = useRef<HTMLInputElement>(null);
  const editedFieldsRef = useRef<Set<'name' | 'price' | 'quantity'>>(new Set());
  /** Snapshot of the item's OCR name at the moment editing starts, for correction-dictionary saving. */
  const editStartOcrNameRef = useRef<string | null>(null);

  function commitEdit() {
    // If the name was changed and we have a restaurant + the original OCR name, save a correction
    if (editedFieldsRef.current.has('name') && restaurantName && editingId) {
      const item = receiptItems.find(i => i.id === editingId);
      const ocrKey = editStartOcrNameRef.current;
      if (item && ocrKey && ocrKey !== item.name) {
        trackManualCorrection(ocrKey, item.name, restaurantName);
      }
    }

    editedFieldsRef.current.forEach((field) => {
      monitoring.track('item_manually_edited', {
        field,
        receipt_type: 'unknown',
        confidence: scanConfidence ?? 'low',
      });
    });
    editedFieldsRef.current = new Set();
    editStartOcrNameRef.current = null;
    setEditingId(null);
  }

  function handleAddManual() {
    const item = createManualItem();
    addItem(item);
    setEditingId(item.id);
    monitoring.track('item_added_manually', { receipt_type: 'unknown' });
  }
  async function handleMagicFix() {
    if (!lastTranscript || !subtotal) return;
    setMagicFixLoading(true);
    setMagicFixFailed(false);

    try {
      const itemsSum = receiptItems.reduce((s, i) => s + i.totalPrice, 0);
      const corrected = await geminiReVerify(lastTranscript, itemsSum, subtotal);

      if (corrected) {
        const newItems = parseReceiptToItems(corrected);
        const newSum = newItems.reduce((s, i) => s + i.totalPrice, 0);
        const stillMismatched = Math.abs(newSum - subtotal) / subtotal > 0.05;

        if (stillMismatched) {
          setMagicFixFailed(true);
          monitoring.track('magic_fix_triggered', { success: false });
        } else {
          setReceiptItems(newItems);
          monitoring.track('magic_fix_triggered', { success: true });
        }
      } else {
        setMagicFixFailed(true);
        monitoring.track('magic_fix_triggered', { success: false });
      }
    } catch {
      setMagicFixFailed(true);
      monitoring.track('magic_fix_triggered', { success: false });
    } finally {
      setMagicFixLoading(false);
    }
  }

  async function handleCopyBase64() {
    if (!debugImageUrl) return;
    try {
      await navigator.clipboard.writeText(debugImageUrl);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2500);
    } catch {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2500);
    }
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
          className="mx-5 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-2xl"
        >
          <div className="flex gap-2 items-start mb-2">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <p className="text-xs text-amber-700 font-medium leading-snug">
              {magicFixFailed
                ? "Gemini couldn't resolve the difference — please check items manually."
                : subtotalWarning}
            </p>
          </div>
          {lastTranscript && subtotal && !magicFixFailed && !autoFixed && (
            <button
              onClick={handleMagicFix}
              disabled={magicFixLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-xl disabled:opacity-60"
            >
              {magicFixLoading ? <>⏳ Asking Gemini…</> : <>✨ Magic Fix</>}
            </button>
          )}
          {autoFixed && (
            <p className="text-xs text-green-600 font-medium mt-1">
              ✅ Auto-fixed — prices reconciled automatically.
            </p>
          )}
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

        <div data-coach-step="2" className="bg-surface border border-border rounded-2xl overflow-hidden">
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
                      onChange={(e) => { editedFieldsRef.current.add('name'); updateItem(item.id, { name: e.target.value }); }}
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
                          editedFieldsRef.current.add('quantity');
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
                          editedFieldsRef.current.add('price');
                          const p = Number(e.target.value) || 0;
                          updateItem(item.id, { unitPrice: p, totalPrice: p * item.quantity });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit();
                        }}
                      />
                      <button
                        onClick={() => commitEdit()}
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
                      showWarningForZero={item.flagged && item.totalPrice === 0}
                    />
                    <button onClick={() => {
                      // Capture the OCR key before any edits — used to save correction on commit
                      editStartOcrNameRef.current = item.originalOcrName ?? item.name;
                      setEditingId(item.id);
                    }} className="text-muted p-1">
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { deleteItem(item.id); monitoring.track('item_deleted', { receipt_type: 'unknown' }); }} className="text-red-400 p-1">
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

      {/* ── DEV-only debug panel ─────────────────────────────────────────── */}
      {import.meta.env.DEV && (
        <div className="mx-5 mb-36">
          <button
            onClick={() => setShowDebug(v => !v)}
            className="w-full py-2 text-xs font-mono text-muted border border-dashed border-border rounded-xl"
          >
            {showDebug ? '▲ Hide debug panel' : '▼ 🐛 Debug panel'}
          </button>

          <AnimatePresence>
            {showDebug && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 p-4 bg-gray-950 border border-gray-700 rounded-2xl space-y-3 font-mono text-xs text-gray-300">
                  <p className="text-gray-500 uppercase tracking-widest text-[10px]">🐛 Debug Tools — DEV only</p>

                  {/* Processed image preview */}
                  {debugImageUrl ? (
                    <div className="space-y-2">
                      <p className="text-gray-400">
                        Image sent to Gemini ({Math.round(debugImageUrl.length * 0.75 / 1024)} KB encoded)
                      </p>
                      <img
                        src={debugImageUrl}
                        alt="Processed receipt"
                        className="w-full rounded-lg border border-gray-700 object-contain max-h-48"
                      />
                      <button
                        onClick={handleCopyBase64}
                        className={`w-full py-2.5 rounded-xl font-semibold text-xs transition-colors ${
                          copyStatus === 'copied'
                            ? 'bg-green-700 text-white'
                            : copyStatus === 'error'
                            ? 'bg-red-700 text-white'
                            : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                        }`}
                      >
                        {copyStatus === 'copied'
                          ? '✅ Copied to clipboard!'
                          : copyStatus === 'error'
                          ? '❌ Clipboard unavailable'
                          : '📋 Copy Base64 Image'}
                      </button>
                      <p className="text-gray-600 text-[10px]">
                        Paste into browser console: atob(copied.split(',')[1]) to verify bytes,
                        or paste into an online base64-to-image tool.
                      </p>
                    </div>
                  ) : (
                    <p className="text-yellow-600">No debug image captured. Trigger a scan first.</p>
                  )}

                  {/* Raw transcript */}
                  {lastTranscript ? (
                    <div className="space-y-1">
                      <p className="text-gray-400">Pass 1 raw transcript ({lastTranscript.length} chars):</p>
                      <pre className="bg-gray-900 p-2 rounded-lg text-[10px] text-green-400 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                        {lastTranscript}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-yellow-600">No transcript available.</p>
                  )}

                  {/* Final items dump */}
                  <div className="space-y-1">
                    <p className="text-gray-400">Final parsed items ({receiptItems.length}):</p>
                    <pre className="bg-gray-900 p-2 rounded-lg text-[10px] text-cyan-400 overflow-auto max-h-40 whitespace-pre-wrap">
                      {JSON.stringify(
                        receiptItems.map(i => ({ name: i.name, price: i.totalPrice, flagged: i.flagged ?? false })),
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </ScreenContainer>
  );
}
