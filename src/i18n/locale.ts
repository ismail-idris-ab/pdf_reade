import Constants from 'expo-constants';

export const LOCALES = ['en', 'ha', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Language names in their own language, shown in the switcher (not translated). */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ha: 'Hausa',
  fr: 'Français',
};

/** What the user picked; "system" follows the device language. */
export type LocalePreference = 'system' | Locale;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Locales the app may show, from `extra.enabledLocales` in app.config.ts.
 * English is always included. ha/fr stay off until reviewed.
 */
export function getEnabledLocales(): Locale[] {
  const configured = (Constants.expoConfig?.extra as { enabledLocales?: unknown } | undefined)
    ?.enabledLocales;
  const enabled = Array.isArray(configured) ? configured.filter(isLocale) : [];
  return enabled.includes(DEFAULT_LOCALE) ? enabled : [DEFAULT_LOCALE, ...enabled];
}

/**
 * The locale to render. An explicit choice wins if it is enabled; otherwise
 * the first enabled device language (by language code); otherwise English.
 * Disabled locales are ignored both as choices and as device languages.
 */
export function resolveLocale(
  preference: LocalePreference,
  deviceLanguageCodes: readonly (string | null)[],
  enabled: readonly Locale[],
): Locale {
  if (preference !== 'system' && enabled.includes(preference)) return preference;
  for (const code of deviceLanguageCodes) {
    const language = code?.toLowerCase();
    if (isLocale(language) && enabled.includes(language)) return language;
  }
  return DEFAULT_LOCALE;
}
