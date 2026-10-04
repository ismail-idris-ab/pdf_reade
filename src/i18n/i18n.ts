import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { getEnabledLocales, resolveLocale, type Locale } from './locale';
import { en } from './locales/en';
import { fr } from './locales/fr';
import { ha } from './locales/ha';
import { useLocaleStore } from './store';

export const resources = {
  en: { translation: en },
  ha: { translation: ha },
  fr: { translation: fr },
} as const;

/** The locale for the saved preference, device languages and enabled list. */
export function currentLocale(): Locale {
  return resolveLocale(
    useLocaleStore.getState().preference,
    getLocales().map((locale) => locale.languageCode),
    getEnabledLocales(),
  );
}

const i18next = createInstance();

void i18next.use(initReactI18next).init({
  resources,
  lng: currentLocale(),
  fallbackLng: 'en',
  // Only enabled locales: i18next itself rejects any other code, so a stray
  // changeLanguage('ha') cannot bypass the enabledLocales gate.
  supportedLngs: getEnabledLocales(),
  // React escapes output already.
  interpolation: { escapeValue: false },
  returnNull: false,
  // Resources are bundled, so init completes synchronously.
  initAsync: false,
});

// Follow preference changes from the language switcher.
useLocaleStore.subscribe(() => {
  const next = currentLocale();
  if (i18next.language !== next) void i18next.changeLanguage(next);
});

export default i18next;
