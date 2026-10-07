import { formatDate, formatFileSize } from '@/i18n/format';
import { en } from '@/i18n/locales/en';
import { fr } from '@/i18n/locales/fr';

// Intl may use a narrow no-break space in French; compare on plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, ' ');

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [950, '950 B'],
    [180_000, '180 KB'],
    [1_536_000, '1.5 MB'],
    [12_400_000, '12 MB'],
    [2_400_000_000, '2.4 GB'],
    // Rounding would otherwise show "1,000 KB" / "10.0 MB".
    [999_950, '1 MB'],
    [9_960_000, '10 MB'],
    [999_400, '999 KB'],
    [5_000_000_000_000, '5,000 GB'],
  ])('formats %d bytes in English as %s', (bytes, expected) => {
    expect(formatFileSize(bytes, 'en', en.units)).toBe(expected);
  });

  it('uses French separators and unit labels', () => {
    expect(plain(formatFileSize(1_536_000, 'fr', fr.units))).toBe('1,5 Mo');
    expect(plain(formatFileSize(180_000, 'fr', fr.units))).toBe('180 Ko');
    expect(plain(formatFileSize(950, 'fr', fr.units))).toBe('950 o');
  });

  it('treats invalid sizes as zero', () => {
    expect(formatFileSize(Number.NaN, 'en', en.units)).toBe('0 B');
    expect(formatFileSize(-5, 'en', en.units)).toBe('0 B');
  });
});

describe('formatDate', () => {
  // Midday UTC, so the calendar date is the same in every test time zone.
  const OCT_4_2026 = Date.UTC(2026, 9, 4, 12);

  it('uses the locale’s medium date style', () => {
    expect(formatDate(OCT_4_2026, 'en')).toBe('Oct 4, 2026');
    expect(plain(formatDate(OCT_4_2026, 'fr'))).toBe('4 oct. 2026');
  });

  it('does not throw on invalid input', () => {
    expect(() => formatDate(Number.NaN, 'en')).not.toThrow();
  });
});
