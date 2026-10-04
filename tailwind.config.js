// Colour tokens resolve to CSS variables set per theme by ThemeProvider
// (src/theme/ThemeProvider.tsx) from src/theme/palette.ts.
const tokens = [
  'background',
  'surface',
  'foreground',
  'muted',
  'border',
  'primary',
  'primary-foreground',
  'danger',
  'danger-foreground',
  'success',
  'overlay',
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: Object.fromEntries(
        tokens.map((token) => [token, `rgb(var(--color-${token}) / <alpha-value>)`]),
      ),
    },
  },
  plugins: [],
};
