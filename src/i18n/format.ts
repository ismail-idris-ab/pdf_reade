import type { Locale } from './locale';
import type { Catalog } from './locales/en';

// Decimal (1000-based) units, matching how Android's Files app and most
// upload portals state limits ("max 200 KB").
const STEP = 1000;

type Units = Catalog['units'];

/** One decimal below 10 (1.5 MB), whole numbers above (180 KB). */
function round(value: number): { value: number; digits: number } {
  const digits = value < 10 ? 1 : 0;
  const factor = 10 ** digits;
  return { value: Math.round(value * factor) / factor, digits };
}

/** "1.5 MB" / "1,5 Mo": locale digits and separators, translated unit labels. */
export function formatFileSize(bytes: number, locale: Locale, units: Units): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0;
  if (safe < STEP) return `${formatNumber(safe, locale, 0)} ${units.byte}`;

  const labels = [units.kilobyte, units.megabyte, units.gigabyte];
  let value = safe / STEP;
  let index = 0;
  // Promote when rounding would show 1000 of a unit ("999.95 KB" → "1 MB").
  while (index < labels.length - 1 && round(value).value >= STEP) {
    value /= STEP;
    index += 1;
  }
  const rounded = round(value);
  return `${formatNumber(rounded.value, locale, rounded.digits)} ${labels[index]}`;
}

// Creating an Intl.NumberFormat is costly on Hermes/Android (ICU via JNI);
// long file lists format hundreds of sizes.
const formatters = new Map<string, Intl.NumberFormat>();

export function formatNumber(value: number, locale: Locale, maximumFractionDigits = 0): string {
  const key = `${locale}:${maximumFractionDigits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits });
    formatters.set(key, formatter);
  }
  return formatter.format(value);
}
