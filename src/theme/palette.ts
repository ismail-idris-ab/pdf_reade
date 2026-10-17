// Colour tokens for every theme. This file is the single source of truth:
// ThemeProvider turns each palette into CSS variables for NativeWind classes
// (bg-background, text-foreground, ...) and JS code reads it directly for
// props that cannot take a className (StatusBar, ActivityIndicator, icons).

export const THEMES = ['light', 'dark', 'sepia'] as const;
export type ThemeName = (typeof THEMES)[number];

export type ColorToken =
  | 'background'
  | 'surface'
  | 'foreground'
  | 'muted'
  | 'border'
  | 'primary'
  | 'primary-foreground'
  | 'danger'
  | 'danger-foreground'
  | 'success'
  | 'overlay';

export type Palette = Record<ColorToken, string>;

export const palettes: Record<ThemeName, Palette> = {
  light: {
    background: '#FFFFFF',
    surface: '#F3F4F6',
    foreground: '#111827',
    muted: '#4B5563',
    border: '#D1D5DB',
    primary: '#1D4ED8',
    'primary-foreground': '#FFFFFF',
    danger: '#B91C1C',
    'danger-foreground': '#FFFFFF',
    success: '#15803D',
    overlay: '#000000',
  },
  dark: {
    background: '#0B0F14',
    surface: '#161B22',
    foreground: '#F3F4F6',
    muted: '#9CA3AF',
    border: '#30363D',
    primary: '#60A5FA',
    'primary-foreground': '#0B1220',
    danger: '#F87171',
    'danger-foreground': '#1F0A0A',
    success: '#4ADE80',
    overlay: '#000000',
  },
  sepia: {
    background: '#F4ECD8',
    surface: '#EADFC4',
    foreground: '#3B2F1E',
    muted: '#5F4F36',
    border: '#CDBB91',
    primary: '#7A3F06',
    'primary-foreground': '#FFFFFF',
    danger: '#9B1C1C',
    'danger-foreground': '#FFFFFF',
    success: '#3F6212',
    overlay: '#000000',
  },
};

/**
 * Search highlights drawn over the rendered page (T2.6). The page itself is
 * the paper of each theme (white; inverted to black in dark, the reader's
 * night mode; sepia paper), so these are chosen against that paper, not the
 * UI background. Fills are translucent so the text underneath stays
 * readable; the current match also gets an outline, so it differs by more
 * than colour.
 */
export type SearchHighlightColors = {
  match: string;
  matchOpacity: number;
  current: string;
  currentOpacity: number;
  currentStroke: string;
};

export const searchHighlights: Record<ThemeName, SearchHighlightColors> = {
  light: {
    match: '#FACC15',
    matchOpacity: 0.4,
    current: '#F97316',
    currentOpacity: 0.5,
    currentStroke: '#C2410C',
  },
  dark: {
    match: '#FACC15',
    matchOpacity: 0.35,
    current: '#FB923C',
    currentOpacity: 0.5,
    currentStroke: '#FDBA74',
  },
  sepia: {
    match: '#EAB308',
    matchOpacity: 0.4,
    current: '#EA580C',
    currentOpacity: 0.45,
    currentStroke: '#9A3412',
  },
};

/** Status bar content style that stays readable on each theme's background. */
export const statusBarStyle: Record<ThemeName, 'light' | 'dark'> = {
  light: 'dark',
  dark: 'light',
  sepia: 'dark',
};

/** "#RRGGBB" → "R G B", the channel format the Tailwind colours expect. */
export function toRgbChannels(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}
