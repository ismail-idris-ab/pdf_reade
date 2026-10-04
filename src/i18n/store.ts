import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { isLocale, type LocalePreference } from './locale';

type LocaleState = {
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
};

// Synchronous storage so the saved language applies on the first frame.
const syncStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => {
    // A failed save must not crash the settings tap; the choice still
    // applies for this session.
    try {
      Storage.setItemSync(name, value);
    } catch {
      // Ignored: nothing useful to show the user for a language preference.
    }
  },
  removeItem: (name) => {
    Storage.removeItemSync(name);
  },
};

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    {
      name: 'locale',
      version: 1,
      storage: createJSONStorage(() => syncStorage),
      partialize: (state) => ({ preference: state.preference }),
      merge: (persisted, current) => {
        const preference = (persisted as Partial<LocaleState> | undefined)?.preference;
        return preference === 'system' || isLocale(preference)
          ? { ...current, preference }
          : current;
      },
    },
  ),
);
