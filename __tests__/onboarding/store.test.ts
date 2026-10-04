import Storage from 'expo-sqlite/kv-store';

import { useOnboardingStore } from '@/features/onboarding/store';

const kv = Storage as unknown as {
  clearSync: () => boolean;
  getItemSync: (key: string) => string | null;
  setItemSync: (key: string, value: string) => void;
};

beforeEach(() => {
  kv.clearSync();
  useOnboardingStore.setState({ onboardingComplete: false });
});

describe('onboarding store', () => {
  it('starts incomplete', () => {
    expect(useOnboardingStore.getState().onboardingComplete).toBe(false);
  });

  it('persists completion synchronously', () => {
    useOnboardingStore.getState().completeOnboarding();
    expect(useOnboardingStore.getState().onboardingComplete).toBe(true);
    const saved = JSON.parse(kv.getItemSync('onboarding') ?? '{}') as {
      state?: { onboardingComplete?: boolean };
    };
    expect(saved.state?.onboardingComplete).toBe(true);
  });

  it('restores the saved flag', async () => {
    kv.setItemSync(
      'onboarding',
      JSON.stringify({ state: { onboardingComplete: true }, version: 1 }),
    );
    await useOnboardingStore.persist.rehydrate();
    expect(useOnboardingStore.getState().onboardingComplete).toBe(true);
  });

  it('ignores malformed saved values', async () => {
    kv.setItemSync(
      'onboarding',
      JSON.stringify({ state: { onboardingComplete: 'yes' }, version: 1 }),
    );
    await useOnboardingStore.persist.rehydrate();
    expect(useOnboardingStore.getState().onboardingComplete).toBe(false);
  });
});
