import { useLocales } from 'expo-localization';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import i18n, { currentLocale } from './i18n';
import { formatFileSize } from './format';
import type { Locale } from './locale';

export { formatFileSize, formatNumber } from './format';
export { default as i18n } from './i18n';
export {
  DEFAULT_LOCALE,
  getEnabledLocales,
  LOCALE_NAMES,
  LOCALES,
  resolveLocale,
  type Locale,
  type LocalePreference,
} from './locale';
export { useLocaleStore } from './store';
export { useTranslation };

/** Re-resolves the locale when the device language changes while running. */
export function useDeviceLocaleSync(): void {
  const deviceLocales = useLocales();
  useEffect(() => {
    const next = currentLocale();
    if (i18n.language !== next) void i18n.changeLanguage(next);
  }, [deviceLocales]);
}

/** File size in the current language, e.g. "1.5 MB" or "1,5 Mo". */
export function useFormatFileSize(): (bytes: number) => string {
  const { t, i18n: instance } = useTranslation();
  const locale = instance.language as Locale;
  return (bytes) =>
    formatFileSize(bytes, locale, {
      byte: t('units.byte'),
      kilobyte: t('units.kilobyte'),
      megabyte: t('units.megabyte'),
      gigabyte: t('units.gigabyte'),
    });
}
