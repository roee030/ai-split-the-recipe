import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, onSnapshot, collection, addDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { getLocalScansUsed } from '../../hooks/useSplitSession';
import { monitoring } from '../../monitoring';

// Replace with your actual Stripe Price ID from the Stripe dashboard
const STRIPE_PRICE_ID = 'price_REPLACE_WITH_YOUR_PRICE_ID';

interface PaywallModalProps {
  open: boolean;
  onDismiss: () => void;
  onUnlocked: () => void;
}

export function PaywallModal({ open, onDismiss, onUnlocked }: PaywallModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, open);
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    monitoring.track('paywall_shown', { scans_used: getLocalScansUsed() });
  }, [open]);

  // Listen for isPremium becoming true in Firestore
  useEffect(() => {
    if (!open || !user) return;
    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.data()?.isPremium === true) {
        monitoring.track('paywall_converted', {});
        onUnlocked();
      }
    });
    return unsubscribe;
  }, [open, user, onUnlocked]);

  async function handleCheckout() {
    if (!user) return;
    setLoading(true);
    try {
      const checkoutRef = collection(db, 'users', user.uid, 'checkout_sessions');
      const docRef = await addDoc(checkoutRef, {
        price: STRIPE_PRICE_ID,
        success_url: window.location.href,
        cancel_url: window.location.href,
      });

      // Wait for Stripe extension to write the checkout URL (up to 15s)
      const unsubscribe = onSnapshot(docRef, (snap) => {
        const data = snap.data();
        const url = data?.url as string | undefined;
        const error = data?.error as string | undefined;
        if (url) {
          unsubscribe?.();
          window.location.href = url;
        }
        if (error) {
          unsubscribe?.();
          setLoading(false);
          alert('Payment setup failed. Please try again.');
        }
      });

      setTimeout(() => {
        unsubscribe?.();
        setLoading(false);
      }, 15000);
    } catch {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/50 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Upgrade to unlimited"
            className="fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-3xl p-6 pb-10 shadow-xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-6" />
            <div className="text-center mb-6">
              <span className="text-5xl">🧾</span>
              <h2 className="text-xl font-bold text-gray-900 mt-3 mb-2">
                You've used your 5 free scans
              </h2>
              <p className="text-sm text-gray-500">
                Unlock unlimited scanning + full history for less than a coffee a month.
              </p>
            </div>

            <div className="space-y-2 mb-6">
              {['Unlimited receipt scans', 'Full scan history', 'Re-open any past split'].map((f) => (
                <div key={f} className="flex items-center gap-2 text-sm text-gray-900">
                  <span className="text-orange-500 font-bold">✓</span>
                  {f}
                </div>
              ))}
            </div>

            <button
              onClick={handleCheckout}
              disabled={loading}
              className="w-full py-4 bg-orange-500 text-white font-bold rounded-2xl text-sm shadow-lg disabled:opacity-60 mb-3"
            >
              {loading ? 'Setting up checkout…' : 'Unlock — $0.99/month'}
            </button>
            <button
              onClick={onDismiss}
              className="w-full py-3 text-sm text-gray-400 font-medium"
            >
              Not now
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
