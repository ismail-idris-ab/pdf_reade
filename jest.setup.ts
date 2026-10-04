// Native modules that have no implementation in Jest.

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-worklets', () =>
  jest.requireActual('react-native-worklets/lib/module/mock'),
);
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));

// In-memory stand-in for expo-sqlite's key-value store.
jest.mock('expo-sqlite/kv-store', () => {
  const items = new Map<string, string>();
  const storage = {
    getItemSync: (key: string) => items.get(key) ?? null,
    setItemSync: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItemSync: (key: string) => items.delete(key),
    clearSync: () => {
      items.clear();
      return true;
    },
  };
  return { __esModule: true, default: storage, Storage: storage };
});
