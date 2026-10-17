import {
  palettes,
  searchHighlights,
  textSelectionColors,
  THEMES,
  toRgbChannels,
  type ColorToken,
  type ThemeName,
} from '@/theme/palette';

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

// The rendered page in each theme: its paper and ink (dark is the reader's
// night mode, the page inverted; sepia matches PageRenderMath.kt).
const PAPER: Record<ThemeName, { paper: string; ink: string }> = {
  light: { paper: '#FFFFFF', ink: '#000000' },
  dark: { paper: '#000000', ink: '#FFFFFF' },
  sepia: { paper: '#F4ECD8', ink: '#3B2F25' },
};

/** A translucent fill over the paper, as one opaque colour. */
function blend(fill: string, opacity: number, paper: string): string {
  const f = toRgbChannels(fill).split(' ').map(Number);
  const p = toRgbChannels(paper).split(' ').map(Number);
  const mixed = f.map((c, i) => Math.round(c * opacity + (p[i] ?? 0) * (1 - opacity)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

describe('search highlights', () => {
  it.each(THEMES)('%s keeps the text under a highlight readable', (theme) => {
    const { paper, ink } = PAPER[theme];
    const colors = searchHighlights[theme];
    expect(contrast(ink, blend(colors.match, colors.matchOpacity, paper))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(ink, blend(colors.current, colors.currentOpacity, paper)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s outlines the current match visibly against the page', (theme) => {
    const { paper } = PAPER[theme];
    expect(contrast(searchHighlights[theme].currentStroke, paper)).toBeGreaterThanOrEqual(3);
  });
});

describe('text selection', () => {
  it.each(THEMES)('%s keeps the selected text readable', (theme) => {
    const { paper, ink } = PAPER[theme];
    const colors = textSelectionColors[theme];
    expect(contrast(ink, blend(colors.fill, colors.fillOpacity, paper))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each(THEMES)('%s draws handles visible against the page', (theme) => {
    expect(contrast(textSelectionColors[theme].handle, PAPER[theme].paper)).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('dark works on white paper too (the dark theme does not invert pages)', () => {
    const colors = textSelectionColors.dark;
    expect(
      contrast('#000000', blend(colors.fill, colors.fillOpacity, '#FFFFFF')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.handle, '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });
});
