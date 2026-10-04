import Storage from 'expo-sqlite/kv-store';

import { resolveTheme } from '@/theme/store';

type MockStorage = { clearSync: () => boolean };

describe('resolveTheme', () => {
  it('follows the OS scheme when the preference is system', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', 'unspecified')).toBe('light');
    expect(resolveTheme('system', null)).toBe('light');
  });

  it('uses an explicit preference regardless of the OS scheme', () => {
    expect(resolveTheme('sepia', 'dark')).toBe('sepia');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });
});

describe('theme store persistence', () => {
  beforeEach(() => {
    (Storage as unknown as MockStorage).clearSync();
  });

  function loadStore() {
    let store!: typeof import('@/theme/store');
    jest.isolateModules(() => {
      store = jest.requireActual<typeof import('@/theme/store')>('@/theme/store');
    });
    return store.useThemeStore;
  }

  it('defaults to system and saves changes synchronously', () => {
    const useThemeStore = loadStore();
    expect(useThemeStore.getState().preference).toBe('system');

    useThemeStore.getState().setPreference('sepia');

    expect(JSON.parse(Storage.getItemSync('theme') ?? '{}')).toMatchObject({
      state: { preference: 'sepia' },
    });
  });

  it('restores the saved preference on the first read', () => {
    Storage.setItemSync('theme', JSON.stringify({ state: { preference: 'dark' }, version: 1 }));
    expect(loadStore().getState().preference).toBe('dark');
  });

  it('ignores unknown stored values', () => {
    Storage.setItemSync('theme', JSON.stringify({ state: { preference: 'neon' }, version: 1 }));
    expect(loadStore().getState().preference).toBe('system');
  });
});
