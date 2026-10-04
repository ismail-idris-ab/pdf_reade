import { palettes, THEMES, toRgbChannels, type ColorToken } from '@/theme/palette';

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channels = toRgbChannels(hex)
    .split(' ')
    .map((c) => Number(c) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Text/background pairs used by the primitives, with the WCAG AA minimum
// (4.5 for normal text, 3 for large text and non-text UI like borders/icons).
const PAIRS: [ColorToken, ColorToken, number][] = [
  ['foreground', 'background', 4.5],
  ['foreground', 'surface', 4.5],
  ['muted', 'background', 4.5],
  ['muted', 'surface', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['danger-foreground', 'danger', 4.5],
  ['primary', 'background', 4.5],
  ['danger', 'background', 4.5],
  ['success', 'background', 3],
  // Non-text UI: progress fill against its track.
  ['primary', 'border', 3],
];

describe('palettes', () => {
  it.each(THEMES)('%s meets WCAG AA contrast for every text pair', (theme) => {
    const palette = palettes[theme];
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(palette[fg], palette[bg]);
      if (ratio < min) {
        throw new Error(`${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}, needs ${min}`);
      }
    }
  });

  it('defines the same tokens in every theme', () => {
    const keys = Object.keys(palettes.light).sort();
    for (const theme of THEMES) {
      expect(Object.keys(palettes[theme]).sort()).toEqual(keys);
    }
  });

  it('converts hex to space-separated channels', () => {
    expect(toRgbChannels('#1D4ED8')).toBe('29 78 216');
    expect(toRgbChannels('#000000')).toBe('0 0 0');
  });
});
