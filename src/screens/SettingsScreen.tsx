import { motion } from 'framer-motion';
import { ArrowLeft, Sun, Moon, Monitor, Trash2, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { signOut } from 'firebase/auth';
import { doc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { useSession } from '../context/SplitSessionContext';
import { useAuth } from '../context/AuthContext';
import { useThemeContext } from '../context/ThemeContext';
import { auth, db } from '../firebase';
import i18n, { RTL_LANGUAGES } from '../i18n';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'he', name: 'עברית' },
  { code: 'ar', name: 'العربية' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
];

export function SettingsScreen() {
  const { setScreen } = useSession();
  const { user } = useAuth();
  const { theme, setTheme } = useThemeContext();
  const { t } = useTranslation();

  async function handleDeleteAccount() {
    if (!user) return;
    if (!confirm(t('settings.deleteConfirm'))) return;
    try {
      const scansRef = collection(db, 'users', user.uid, 'scans');
      const scansSnap = await getDocs(scansRef);
      await Promise.all(scansSnap.docs.map(d => deleteDoc(d.ref)));
      await deleteDoc(doc(db, 'users', user.uid));
      await user.delete();
      setScreen('home');
    } catch {
      alert('Failed to delete account. Please try again.');
    }
  }

  return (
    <motion.div
      className="min-h-screen bg-bg dark:bg-[#1A1A1A] px-5 py-6"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
    >
      <button
        onClick={() => setScreen('home')}
        className="flex items-center gap-2 text-muted mb-6 min-h-[44px]"
        aria-label={t('auth.back')}
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <h1 className="text-2xl font-display font-bold text-primary dark:text-[#F0F0F0] mb-8">
        {t('settings.title')}
      </h1>

      {/* Language */}
      <section className="mb-8">
        <h2 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">
          {t('settings.language')}
        </h2>
        <div className="bg-surface dark:bg-[#2A2A2A] border border-border dark:border-[#3A3A3A] rounded-2xl divide-y divide-border dark:divide-[#3A3A3A] overflow-hidden">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className="w-full flex items-center justify-between px-4 py-3.5 min-h-[44px]"
            >
              <span className={`text-sm font-medium text-primary dark:text-[#F0F0F0] ${RTL_LANGUAGES.includes(lang.code) ? 'font-sans' : ''}`}>
                {lang.name}
              </span>
              {i18n.language.startsWith(lang.code) && (
                <span className="w-2 h-2 rounded-full bg-accent" />
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Theme */}
      <section className="mb-8">
        <h2 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">
          {t('settings.theme')}
        </h2>
        <div className="bg-surface dark:bg-[#2A2A2A] border border-border dark:border-[#3A3A3A] rounded-2xl overflow-hidden">
          {([['light', t('settings.themeLight'), Sun], ['system', t('settings.themeSystem'), Monitor], ['dark', t('settings.themeDark'), Moon]] as const).map(([val, label, Icon]) => (
            <button
              key={val}
              onClick={() => setTheme(val)}
              className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[44px] border-b last:border-0 border-border dark:border-[#3A3A3A]"
            >
              <Icon className="w-4 h-4 text-muted" />
              <span className="flex-1 text-sm font-medium text-primary dark:text-[#F0F0F0] text-start">{label}</span>
              {theme === val && <span className="w-2 h-2 rounded-full bg-accent" />}
            </button>
          ))}
        </div>
      </section>

      {/* Legal */}
      <section className="mb-8">
        <h2 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">
          {t('settings.legal')}
        </h2>
        <div className="bg-surface dark:bg-[#2A2A2A] border border-border dark:border-[#3A3A3A] rounded-2xl divide-y divide-border dark:divide-[#3A3A3A] overflow-hidden">
          <button onClick={() => setScreen('privacy')} className="w-full text-start px-4 py-3.5 text-sm text-primary dark:text-[#F0F0F0] min-h-[44px]">
            {t('settings.privacyPolicy')}
          </button>
          <button onClick={() => setScreen('terms')} className="w-full text-start px-4 py-3.5 text-sm text-primary dark:text-[#F0F0F0] min-h-[44px]">
            {t('settings.termsOfService')}
          </button>
          <div className="px-4 py-3.5 text-sm text-muted">
            {t('settings.doNotSell')}
          </div>
        </div>
      </section>

      {/* Account */}
      {user && (
        <section>
          <h2 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Account</h2>
          <div className="bg-surface dark:bg-[#2A2A2A] border border-border dark:border-[#3A3A3A] rounded-2xl divide-y divide-border dark:divide-[#3A3A3A] overflow-hidden">
            <button
              onClick={() => signOut(auth).then(() => setScreen('home'))}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-primary dark:text-[#F0F0F0] min-h-[44px]"
            >
              <LogOut className="w-4 h-4 text-muted" />
              {t('settings.signOut')}
            </button>
            <button
              onClick={handleDeleteAccount}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-red-500 min-h-[44px]"
            >
              <Trash2 className="w-4 h-4" />
              {t('settings.deleteAccount')}
            </button>
          </div>
        </section>
      )}
    </motion.div>
  );
}
