import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Receipt, Zap, Camera, X, RotateCcw, ChevronRight, Settings } from 'lucide-react';
import { useSession } from '../context/SplitSessionContext';
import { useAuth } from '../context/AuthContext';
import { prepareImage } from '../utils/imageResize';
import { scanReceipt } from '../services/geminiVision';
import { parseReceiptToItems } from '../services/receiptParser';
import { SignInModal } from '../components/auth/SignInModal';
import { PaywallModal } from '../components/paywall/PaywallModal';
import { getLocalScansUsed, incrementLocalScansUsed } from '../hooks/useSplitSession';
import { monitoring } from '../monitoring';
import { useScanHistory } from '../hooks/useScanHistory';
import { formatScanDate } from '../utils/formatDate';

const CAMERA_TIPS = [
  { icon: '💡', text: 'Good lighting — avoid shadows & glare' },
  { icon: '📃', text: 'Full receipt in frame, top to bottom' },
  { icon: '📐', text: 'Keep it flat and steady' },
  { icon: '🔍', text: 'Prices and item names must be readable' },
];

type Stage = 'home' | 'guide' | 'preview';

export function HomeScreen() {
  const { setScreen, setReceiptData, scanError, setScanError } = useSession();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const scanningRef = useRef(false);
  const sourceRef = useRef<'camera' | 'upload'>('camera');
  const lastErrorCodeRef = useRef<string | null>(null);

  const [stage, setStage] = useState<Stage>('home');
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [scanCooldown, setScanCooldown] = useState(0);

  const { history, loading: historyLoading } = useScanHistory();

  useEffect(() => {
    if (scanCooldown <= 0) return;
    const timer = setTimeout(() => setScanCooldown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [scanCooldown]);

  // Revoke object URL on unmount
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  async function doScan(file: File) {
    if (scanningRef.current) return;
    scanningRef.current = true;
    if (lastErrorCodeRef.current) {
      monitoring.track('scan_retried', { previous_error_code: lastErrorCodeRef.current });
      lastErrorCodeRef.current = null;
    }
    monitoring.track('scan_started', { source: sourceRef.current });
    setScanCooldown(10);
    incrementLocalScansUsed();
    setScanError(null);
    setScreen('processing');
    try {
      const { blob, mimeType } = await prepareImage(file);
      const { receipt, tokens } = await scanReceipt(blob, mimeType);
      const items = parseReceiptToItems(receipt);
      setReceiptData(items, {
        restaurantName: receipt.restaurantName,
        tax: receipt.currency === 'ILS' ? 0 : (receipt.tax ?? 0),
        serviceCharge: receipt.serviceCharge ?? 0,
        currency: receipt.currency ?? 'ILS',
        subtotal: receipt.subtotal ?? null,
        scanConfidence: receipt.confidence ?? null,
      });
      setScreen('review');
      monitoring.track('scan_completed', {
        receipt_type: receipt.receipt_type ?? 'other',
        item_count: items.length,
        confidence: receipt.confidence ?? 'low',
        pass1_input_tokens: tokens.pass1.inputTokens,
        pass1_output_tokens: tokens.pass1.outputTokens,
        pass2_input_tokens: tokens.pass2.inputTokens,
        pass2_output_tokens: tokens.pass2.outputTokens,
        total_input_tokens: tokens.totalInputTokens,
        total_output_tokens: tokens.totalOutputTokens,
        estimated_cost_usd: tokens.estimatedCostUSD,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      const errorCode = raw || 'UNKNOWN';
      lastErrorCodeRef.current = errorCode;
      monitoring.track('scan_failed', {
        error_code: errorCode,
        failed_pass: raw.includes('BLURRY') || raw.includes('CROPPED') || raw.includes('LOW_LIGHT') || raw.includes('OCCLUDED') || raw.includes('NOT_A_RECEIPT') ? 1 : 2,
        total_input_tokens: 0,
        total_output_tokens: 0,
        estimated_cost_usd: 0,
      });
      let message: string | null = null;
      if (raw.includes('BLURRY')) {
        message = "The photo came out a bit blurry. Try holding the phone steadier and shoot again.";
      } else if (raw.includes('CROPPED')) {
        message = "Part of the receipt looks cut off. Make sure all edges are in frame.";
      } else if (raw.includes('LOW_LIGHT')) {
        message = "It's too dark here. Try turning on a light or using flash.";
      } else if (raw.includes('OCCLUDED')) {
        message = "Something is covering the text. Try shooting again with the receipt fully exposed.";
      } else if (raw.includes('NOT_A_RECEIPT')) {
        message = "We couldn't identify a receipt here. Make sure you're photographing a clear bill or receipt.";
      } else if (raw.includes('NO_ITEMS_FOUND')) {
        message = "We couldn't find any items. Try a better-lit photo.";
      } else if (raw.includes('SCAN_LIMIT_REACHED')) {
        setReceiptData([], {});
        setScreen('home');
        setShowPaywall(true);
        return;
      } else if (raw.includes('TOO_MANY_REQUESTS') || raw.includes('429')) {
        message = 'Please wait a moment before scanning again.';
      } else {
        message = "Something went wrong. Please try again.";
      }
      setScanError(message);
      setReceiptData([], {});
      setScreen('home');
    } finally {
      scanningRef.current = false;
    }
  }

  async function handleFile(file: File) {
    // Soft gate: show sign-in on first scan if not signed in
    if (!user && getLocalScansUsed() === 0) {
      setPendingFile(file);
      setShowSignIn(true);
      return;
    }
    // Strong nudge: last free scan
    if (!user && getLocalScansUsed() === 4) {
      setPendingFile(file);
      setShowSignIn(true);
      return;
    }
    await doScan(file);
  }

  function showPreview(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(file);
    setCapturedFile(file);
    setPreviewUrl(url);
    setStage('preview');
  }

  function handleCameraChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    sourceRef.current = 'camera';
    showPreview(file);
  }

  function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    sourceRef.current = 'upload';
    showPreview(file);
  }

  function handleConfirmScan() {
    if (!capturedFile) return;
    setStage('home');
    handleFile(capturedFile);
    setCapturedFile(null);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
  }

  function handleRetake() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setCapturedFile(null);
    setStage('guide');
    // Small delay so the guide renders before triggering camera
    setTimeout(() => cameraRef.current?.click(), 100);
  }

  function handleDismissPreview() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setCapturedFile(null);
    setStage('home');
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
          className="flex items-center gap-2"
        >
          <div className="flex items-center gap-1 px-3 py-1 bg-accent/10 rounded-full">
            <Zap className="w-3 h-3 text-accent" />
            <span className="text-xs font-semibold text-accent">AI Powered</span>
          </div>
          <button
            onClick={() => setScreen('settings')}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5 text-muted" />
          </button>
        </motion.div>
      </div>

      {/* Error banner */}
      <div role="alert" aria-live="polite">
      <AnimatePresence>
        {scanError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-5 mb-4 p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700"
          >
            <p className="font-semibold mb-0.5">
              {scanError.includes('wait a moment') ? '⏳ Rate limit hit'
                : scanError.includes("identify a receipt") ? '🤔 Not a receipt'
                : scanError.includes("find any items") ? '🔍 Nothing detected'
                : scanError.includes('blurry') || scanError.includes('dark') || scanError.includes('cut off') || scanError.includes('covering') ? '📷 Photo issue'
                : '⚠️ Scan failed'}
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
      </AnimatePresence>
      </div>

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

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-white/50 text-xs uppercase tracking-wider font-semibold">Start here</p>
                <p className="text-white/80 text-sm">Scan or upload a receipt</p>
              </div>
              <motion.button
                data-coach-step="1"
                onClick={() => scanCooldown <= 0 && setStage('guide')}
                disabled={scanCooldown > 0}
                aria-label={scanCooldown > 0 ? `Wait ${scanCooldown}s` : 'Scan receipt'}
                className="w-20 h-20 rounded-full bg-accent flex flex-col items-center justify-center gap-1 shadow-lg shadow-accent/40 disabled:opacity-60"
                whileTap={{ scale: 0.92 }}
                animate={scanCooldown <= 0 ? { scale: [1, 1.02, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Camera className="w-7 h-7 text-white" />
                <span className="text-white text-[10px] font-bold tracking-wide">
                  {scanCooldown > 0 ? `${scanCooldown}s` : 'SCAN'}
                </span>
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
            onClick={() => { setReceiptData([], {}); setScreen('review'); }}
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
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
            Recent Activity
          </h3>

          {historyLoading && (
            <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
          )}

          {!historyLoading && history.length === 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center">
              <p className="text-2xl mb-2">📭</p>
              <p className="text-sm text-gray-400">No recent splits yet</p>
              <p className="text-xs text-gray-300 mt-1">Your scan history will appear here</p>
            </div>
          )}

          {!historyLoading && history.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-100 overflow-hidden">
              {history.map((scan) => (
                <div key={scan.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-2xl">🧾</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {scan.restaurantName ?? 'Receipt'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {scan.itemCount} items · {formatScanDate(scan.createdAt)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-gray-900 flex-shrink-0">
                    {scan.currency === 'ILS' ? '₪' : scan.currency === 'USD' ? '$' : scan.currency}{scan.total.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      <div className="pb-8 text-center mt-4">
        <p className="text-muted text-xs">Powered by Gemini Vision AI</p>
      </div>

      {/* Hidden inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCameraChange} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUploadChange} />

      {/* Camera Guide Overlay */}
      <AnimatePresence>
        {stage === 'guide' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col justify-end"
            style={{ background: 'rgba(13,13,26,0.85)' }}
            onClick={() => setStage('home')}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="bg-surface rounded-t-3xl p-6 pb-10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-border rounded-full mx-auto mb-6" />
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-xl font-bold text-primary">Photo Tips</h2>
                <button onClick={() => setStage('home')} aria-label="Close" className="text-muted p-1 min-h-[44px] min-w-[44px] flex items-center justify-center">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-muted text-sm mb-5">For best results, make sure your photo:</p>

              <div className="space-y-3 mb-7">
                {CAMERA_TIPS.map((tip) => (
                  <div key={tip.text} className="flex items-center gap-3 p-3 bg-bg rounded-xl">
                    <span className="text-xl w-8 text-center flex-shrink-0">{tip.icon}</span>
                    <span className="text-sm font-medium text-primary">{tip.text}</span>
                  </div>
                ))}
              </div>

              <motion.button
                onClick={() => {
                  setStage('home'); // dismiss guide, camera will open
                  setTimeout(() => cameraRef.current?.click(), 50);
                }}
                className="w-full py-4 rounded-2xl bg-accent text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-accent/30"
                whileTap={{ scale: 0.97 }}
              >
                <Camera className="w-5 h-5" />
                Open Camera
                <ChevronRight className="w-4 h-4" />
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Paywall Modal */}
      <PaywallModal
        open={showPaywall}
        onDismiss={() => setShowPaywall(false)}
        onUnlocked={() => {
          setShowPaywall(false);
          if (capturedFile) doScan(capturedFile);
        }}
      />

      {/* Sign-in Modal */}
      <SignInModal
        open={showSignIn}
        reason={getLocalScansUsed() === 0 ? 'first_scan' : 'limit_approaching'}
        onDismiss={() => {
          setShowSignIn(false);
          if (pendingFile) { doScan(pendingFile); }
          setPendingFile(null);
        }}
        onSuccess={() => {
          setShowSignIn(false);
          if (pendingFile) { doScan(pendingFile); }
          setPendingFile(null);
        }}
      />

      {/* Photo Preview Overlay */}
      <AnimatePresence>
        {stage === 'preview' && previewUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-primary flex flex-col"
          >
            {/* Preview header */}
            <div className="px-5 pt-12 pb-4 flex items-center justify-between">
              <button onClick={handleDismissPreview} className="flex items-center gap-1.5 text-white/60 text-sm font-medium">
                <X className="w-4 h-4" />
                Cancel
              </button>
              <h2 className="font-display text-base font-bold text-white">Review Photo</h2>
              <div className="w-16" />
            </div>

            {/* Image preview */}
            <div className="flex-1 flex items-center justify-center px-5 py-4 min-h-0">
              <div className="relative w-full max-h-full rounded-2xl overflow-hidden border-2 border-white/20">
                <img
                  src={previewUrl}
                  alt="Receipt preview"
                  className="w-full h-full object-contain"
                  style={{ maxHeight: 'calc(100vh - 320px)' }}
                />
                {/* Corner frame guides */}
                {['top-0 left-0 border-l-2 border-t-2', 'top-0 right-0 border-r-2 border-t-2',
                  'bottom-0 left-0 border-l-2 border-b-2', 'bottom-0 right-0 border-r-2 border-b-2'].map((cls, i) => (
                  <div key={i} className={`absolute w-5 h-5 border-accent ${cls}`} />
                ))}
              </div>
            </div>

            {/* Checklist */}
            <div className="px-5 py-3">
              <p className="text-white/50 text-xs uppercase tracking-wider font-semibold mb-3 text-center">
                Check before scanning
              </p>
              <div className="grid grid-cols-2 gap-2 mb-5">
                {[
                  { icon: '💡', label: 'Well lit' },
                  { icon: '📃', label: 'Full receipt visible' },
                  { icon: '🔍', label: 'Text is readable' },
                  { icon: '📐', label: 'Not blurry' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
                    <span className="text-base">{item.icon}</span>
                    <span className="text-white/80 text-xs font-medium">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div className="px-5 pb-10 flex gap-3">
              <button
                onClick={handleRetake}
                className="flex items-center justify-center gap-2 px-5 py-4 rounded-2xl border border-white/20 text-white font-semibold text-sm active:scale-95 transition-transform"
              >
                <RotateCcw className="w-4 h-4" />
                Retake
              </button>
              <motion.button
                onClick={handleConfirmScan}
                className="flex-1 py-4 rounded-2xl bg-accent text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-accent/40"
                whileTap={{ scale: 0.97 }}
              >
                Scan Receipt
                <ChevronRight className="w-5 h-5" />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
