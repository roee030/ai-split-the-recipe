import { useRef } from 'react';
import { motion } from 'framer-motion';
import { Upload, Receipt, Zap } from 'lucide-react';
import { useSession } from '../context/SplitSessionContext';
import { prepareImage } from '../utils/imageResize';
import { scanReceipt } from '../services/geminiVision';
import { parseReceiptToItems } from '../services/receiptParser';

export function HomeScreen() {
  const { setScreen, setReceiptData, scanError, setScanError } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const scanningRef = useRef(false);

  async function handleFile(file: File) {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanError(null);
    setScreen('processing');
    try {
      const { blob, mimeType } = await prepareImage(file);
      const parsed = await scanReceipt(blob, mimeType);
      const items = parseReceiptToItems(parsed);
      setReceiptData(items, {
        restaurantName: parsed.restaurantName,
        tax: parsed.currency === 'ILS' ? 0 : (parsed.tax ?? 0),
        serviceCharge: parsed.serviceCharge ?? 0,
        currency: parsed.currency ?? 'ILS',
      });
      setScreen('review');
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Failed to read receipt. Try again.';
      setScanError(message);
      setReceiptData([], {});
      setScreen('home');
    } finally {
      scanningRef.current = false;
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Top bar */}
      <div className="px-5 pt-12 pb-4 flex items-center justify-between">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2"
        >
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
            <Receipt className="w-4 h-4 text-white" />
          </div>
          <h1 className="font-display text-xl font-bold text-primary">SplitSnap</h1>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex items-center gap-1 px-3 py-1 bg-accent/10 rounded-full"
        >
          <Zap className="w-3 h-3 text-accent" />
          <span className="text-xs font-semibold text-accent">AI Powered</span>
        </motion.div>
      </div>

      {/* Error banner */}
      {scanError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-5 mb-4 p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700"
        >
          <p className="font-semibold mb-0.5">
            {scanError.includes('Too many requests') ? '⏳ Rate limit hit' : '⚠️ Scan failed'}
          </p>
          <p className="text-red-600 text-xs">{scanError}</p>
          <button
            onClick={() => setScanError(null)}
            className="mt-2 text-xs text-red-500 font-medium underline underline-offset-2"
          >
            Dismiss
          </button>
        </motion.div>
      )}

      <div className="flex-1 px-5 space-y-4">
        {/* Hero dark card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-3xl overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #0D0D1A 0%, #1a1040 100%)' }}
        >
          <div className="px-6 pt-7 pb-6">
            <p className="font-display text-2xl font-bold text-white leading-tight mb-6">
              Turn receipts<br />
              into social<br />
              <span className="text-accent">records.</span>
            </p>

            {/* Scan CTA area */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-white/50 text-xs uppercase tracking-wider font-semibold">Start here</p>
                <p className="text-white/80 text-sm">Scan or upload a receipt</p>
              </div>
              <motion.button
                onClick={() => cameraRef.current?.click()}
                className="w-20 h-20 rounded-full bg-accent flex flex-col items-center justify-center gap-1 shadow-lg shadow-accent/40"
                whileTap={{ scale: 0.92 }}
                animate={{ scale: [1, 1.02, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Receipt className="w-7 h-7 text-white" />
                <span className="text-white text-[10px] font-bold tracking-wide">SCAN</span>
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* Upload + Manual */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex gap-3"
        >
          <button
            onClick={() => fileRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-border bg-surface text-primary text-sm font-medium active:scale-95 transition-transform"
          >
            <Upload className="w-4 h-4" />
            Upload Photo
          </button>
          <button
            onClick={() => {
              setReceiptData([], {});
              setScreen('review');
            }}
            className="flex-1 py-3.5 rounded-2xl bg-primary/5 text-primary text-sm font-medium active:scale-95 transition-transform"
          >
            Add manually
          </button>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-2 gap-3"
        >
          <div className="bg-surface border border-border rounded-2xl p-4">
            <p className="text-xs text-muted font-medium mb-1">Active Groups</p>
            <p className="font-display text-2xl font-bold text-primary">—</p>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-4">
            <p className="text-xs text-muted font-medium mb-1">Last 7 Days</p>
            <p className="font-display text-2xl font-bold text-primary">—</p>
          </div>
        </motion.div>

        {/* Recent Activity */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-sm font-bold text-primary uppercase tracking-wider">Recent Activity</h3>
            <span className="text-xs text-muted">View All</span>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-5 text-center">
            <p className="text-2xl mb-2">🧾</p>
            <p className="text-sm font-medium text-primary">No recent splits</p>
            <p className="text-xs text-muted mt-1">Scan your first receipt to get started</p>
          </div>
        </motion.div>
      </div>

      {/* Bottom padding */}
      <div className="pb-8 text-center mt-4">
        <p className="text-muted text-xs">Powered by Gemini Vision AI</p>
      </div>

      {/* Hidden inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleInputChange} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleInputChange} />
    </div>
  );
}
