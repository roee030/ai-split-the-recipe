import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from '../../firebase';

interface SignInModalProps {
  open: boolean;
  reason: 'first_scan' | 'limit_approaching' | 'required';
  onDismiss: () => void;
  onSuccess: () => void;
}

export function SignInModal({ open, reason, onDismiss, onSuccess }: SignInModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, open);
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const headline =
    reason === 'first_scan'
      ? 'Save your scan & track history'
      : reason === 'limit_approaching'
      ? 'This is your last free scan — sign in to keep going'
      : 'Sign in to continue';

  async function handleGoogle() {
    setIsLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      onSuccess();
    } catch {
      setError('Google sign-in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleEmail() {
    if (!email || !password) { setError('Enter email and password'); return; }
    setIsLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      onSuccess();
    } catch {
      try {
        await createUserWithEmailAndPassword(auth, email, password);
        onSuccess();
      } catch {
        setError('Invalid credentials. Check your email and password.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/40 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={reason !== 'required' ? onDismiss : undefined}
          />
          <motion.div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Sign in"
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl p-6 pb-10 shadow-xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-gray-900 text-center mb-2">{headline}</h2>
            <p className="text-sm text-gray-500 text-center mb-6">
              Sign in to save your receipts and unlock history.
            </p>

            {!emailMode ? (
              <div className="space-y-3">
                <button
                  onClick={handleGoogle}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-3 py-3.5 border border-gray-200 rounded-2xl font-semibold text-sm text-gray-900 bg-white disabled:opacity-50"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>
                <button
                  onClick={() => setEmailMode(true)}
                  className="w-full py-3.5 border border-gray-200 rounded-2xl font-semibold text-sm text-gray-900 bg-white"
                >
                  Continue with Email
                </button>
                {reason !== 'required' && (
                  <button
                    onClick={onDismiss}
                    className="w-full py-3 text-sm text-gray-400 font-medium"
                  >
                    Skip for now
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm bg-white text-gray-900 outline-none focus:border-orange-400"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm bg-white text-gray-900 outline-none focus:border-orange-400"
                />
                {error && <p className="text-xs text-red-500 text-center">{error}</p>}
                <button
                  onClick={handleEmail}
                  disabled={isLoading}
                  className="w-full py-3.5 bg-orange-500 text-white font-bold rounded-2xl text-sm disabled:opacity-50"
                >
                  {isLoading ? 'Signing in…' : 'Continue'}
                </button>
                <button
                  onClick={() => setEmailMode(false)}
                  className="w-full py-3 text-sm text-gray-400 font-medium"
                >
                  Back
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
