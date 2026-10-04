import { StatusBar } from 'expo-status-bar';
import { vars } from 'nativewind';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme, View } from 'react-native';

import {
  palettes,
  statusBarStyle,
  THEMES,
  toRgbChannels,
  type Palette,
  type ThemeName,
} from './palette';
import { resolveTheme, useThemeStore, type ThemePreference } from './store';

type ThemeContextValue = {
  /** The theme being rendered. */
  theme: ThemeName;
  /** Colours for props that cannot take a className. */
  palette: Palette;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// CSS variables per theme, consumed by the Tailwind colour tokens.
const themeVars = Object.fromEntries(
  THEMES.map((theme) => [
    theme,
    vars(
      Object.fromEntries(
        Object.entries(palettes[theme]).map(([token, hex]) => [
          `--color-${token}`,
          toRgbChannels(hex),
        ]),
      ),
    ),
  ]),
) as Record<ThemeName, ReturnType<typeof vars>>;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  const theme = resolveTheme(preference, systemScheme);

  const value = useMemo(
    () => ({ theme, palette: palettes[theme], preference, setPreference }),
    [theme, preference, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={themeVars[theme]} className="flex-1 bg-background">
        {children}
      </View>
      <StatusBar style={statusBarStyle[theme]} />
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}
