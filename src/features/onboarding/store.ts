import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

type OnboardingState = {
  onboardingComplete: boolean;
  completeOnboarding: () => void;
};

// Synchronous storage so the first frame already knows whether to show
// onboarding (no flash of the wrong screen at launch).
const syncStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => {
    // A failed save must not block the user: onboarding still completes for
    // this session and is simply shown again on the next launch.
    try {
      Storage.setItemSync(name, value);
    } catch {
      // Ignored: re-showing onboarding once is harmless.
    }
  },
  removeItem: (name) => {
    Storage.removeItemSync(name);
  },
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      onboardingComplete: false,
      completeOnboarding: () => set({ onboardingComplete: true }),
    }),
    {
      name: 'onboarding',
      version: 1,
      storage: createJSONStorage(() => syncStorage),
      partialize: (state) => ({ onboardingComplete: state.onboardingComplete }),
      merge: (persisted, current) => {
        const value = (persisted as Partial<OnboardingState> | undefined)?.onboardingComplete;
        return typeof value === 'boolean' ? { ...current, onboardingComplete: value } : current;
      },
    },
  ),
);
