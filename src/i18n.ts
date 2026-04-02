import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en/translation.json';
import he from './locales/he/translation.json';
import ar from './locales/ar/translation.json';
import es from './locales/es/translation.json';
import fr from './locales/fr/translation.json';
import pt from './locales/pt/translation.json';
import ru from './locales/ru/translation.json';

export const RTL_LANGUAGES = ['he', 'ar'];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      he: { translation: he },
      ar: { translation: ar },
      es: { translation: es },
      fr: { translation: fr },
      pt: { translation: pt },
      ru: { translation: ru },
    },
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'splitsnap_lang',
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
