import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../context/SplitSessionContext';
import { initPostHog } from '../../monitoring';

const CONSENT_KEY = 'splitsnap_consent';

export function ConsentBanner() {
  const { t } = useTranslation();
  const { setScreen } = useSession();
  const [visible, setVisible] = useState(
    () => !localStorage.getItem(CONSENT_KEY)
  );

  function accept() {
    localStorage.setItem(CONSENT_KEY, '1');
    // Start analytics NOW — the user just gave informed consent.
    initPostHog();
    setVisible(false);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed bottom-0 inset-x-0 z-50 bg-surface dark:bg-[#2A2A2A] border-t border-border dark:border-[#3A3A3A] p-4 shadow-2xl"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
        >
          <p className="text-sm text-primary dark:text-[#F0F0F0] mb-3 leading-relaxed">
            {t('consent.message')}{' '}
            <button
              onClick={() => setScreen('privacy')}
              className="underline text-accent"
            >
              {t('consent.learnMore')}
            </button>
          </p>
          <button
            onClick={accept}
            className="w-full py-3 bg-accent text-white font-bold rounded-2xl text-sm"
          >
            {t('consent.accept')}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
