import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { THEMES, type ThemeName } from './palette';

/** What the user picked in settings; "system" follows the OS light/dark mode. */
export type ThemePreference = 'system' | ThemeName;

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', ...THEMES];

type ThemeState = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

// Synchronous storage so the saved theme is applied on the first frame
// (no flash of the default theme at launch).
const syncStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => {
    // A failed save (disk full, DB locked) must not crash the settings tap;
    // the preference still applies for this session.
    try {
      Storage.setItemSync(name, value);
    } catch {
      // Ignored: nothing useful to show the user for a theme preference.
    }
  },
  removeItem: (name) => {
    Storage.removeItemSync(name);
  },
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    {
      name: 'theme',
      version: 1,
      storage: createJSONStorage(() => syncStorage),
      partialize: (state) => ({ preference: state.preference }),
      // Ignore unknown stored values (e.g. a theme removed in a later version).
      merge: (persisted, current) => {
        const preference = (persisted as Partial<ThemeState> | undefined)?.preference;
        return preference && THEME_PREFERENCES.includes(preference)
          ? { ...current, preference }
          : current;
      },
    },
  ),
);

/** The theme to render for a preference and the OS colour scheme (React Native's ColorSchemeName). */
export function resolveTheme(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): ThemeName {
  if (preference !== 'system') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
}
