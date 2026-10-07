import { useLocales } from 'expo-localization';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import i18n, { currentLocale } from './i18n';
import { formatDate, formatFileSize } from './format';
import type { Locale } from './locale';

export { formatDate, formatFileSize, formatNumber } from './format';
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

/**
 * File size in the current language, e.g. "1.5 MB" or "1,5 Mo". The returned
 * function is stable until the language changes (safe in memoised rows).
 */
export function useFormatFileSize(): (bytes: number) => string {
  const { t, i18n: instance } = useTranslation();
  const locale = instance.language as Locale;
  return useCallback(
    (bytes: number) =>
      formatFileSize(bytes, locale, {
        byte: t('units.byte'),
        kilobyte: t('units.kilobyte'),
        megabyte: t('units.megabyte'),
        gigabyte: t('units.gigabyte'),
      }),
    [locale, t],
  );
}

/** Calendar date in the current language; stable until the language changes. */
export function useFormatDate(): (epochMs: number) => string {
  const { i18n: instance } = useTranslation();
  const locale = instance.language as Locale;
  return useCallback((epochMs: number) => formatDate(epochMs, locale), [locale]);
}
