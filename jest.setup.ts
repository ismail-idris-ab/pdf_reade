// Native modules that have no implementation in Jest.

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-worklets', () =>
  jest.requireActual('react-native-worklets/lib/module/mock'),
);
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));

// FlashList has no layout in Jest. This is the measurement half of its
// documented setup (@shopify/flash-list/jestSetup.js): a fixed 400x900
// viewport, so items actually render. The other half of that file replaces
// FlashList with a `RecyclerView` export that 2.0.2 no longer has (FlashList
// already is the RecyclerView), so it is not used.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@shopify/flash-list/dist/recyclerview/utils/measureLayout',
  );
  const viewport = { x: 0, y: 0, width: 400, height: 900 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => viewport),
    measureFirstChildLayout: jest.fn(() => viewport),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 100, height: 100 })),
  };
});

// In-memory stand-in for expo-sqlite's key-value store.
jest.mock('expo-sqlite/kv-store', () => {
  const items = new Map<string, string>();
  const set = (key: string, value: string) => {
    items.set(key, value);
  };
  const setMany = (pairs: [string, string][]) => {
    for (const [key, value] of pairs) items.set(key, value);
  };
  const storage = {
    getItemSync: (key: string) => items.get(key) ?? null,
    setItemSync: set,
    removeItemSync: (key: string) => items.delete(key),
    getAllKeysSync: () => [...items.keys()],
    clearSync: () => {
      items.clear();
      return true;
    },
    // Async writers, so a test can watch every way of writing.
    setItem: async (key: string, value: string) => set(key, value),
    setItemAsync: async (key: string, value: string) => set(key, value),
    mergeItem: async (key: string, value: string) => set(key, value),
    multiSet: async (pairs: [string, string][]) => setMany(pairs),
    multiMerge: async (pairs: [string, string][]) => setMany(pairs),
  };
  return { __esModule: true, default: storage, Storage: storage };
});

// expo-clipboard's native module has no Jest implementation; tests assert on these.
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve(true)),
  getStringAsync: jest.fn(() => Promise.resolve('')),
  hasStringAsync: jest.fn(() => Promise.resolve(false)),
}));
