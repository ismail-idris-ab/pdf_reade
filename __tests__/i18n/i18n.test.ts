// This top-level import creates the kv-store mock from jest.setup.ts in the
// main registry; isolateModules below reuses that same instance, which lets
// tests seed a saved preference before loading i18n.
import Storage from 'expo-sqlite/kv-store';

type MockStorage = { clearSync: () => boolean };

// Loads a fresh i18n + store pair with the given enabled and device locales.
function load(enabledLocales: string[], deviceLanguages: string[] = ['en']) {
  let modules!: {
    i18n: typeof import('@/i18n/i18n');
    store: typeof import('@/i18n/store');
    messages: typeof import('@/lib/errors/messages');
  };
  const locales = deviceLanguages.map((languageCode) => ({ languageCode }));
  jest.isolateModules(() => {
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: { enabledLocales } } },
    }));
    jest.doMock('expo-localization', () => ({
      getLocales: () => locales,
      useLocales: () => locales,
    }));
    modules = {
      i18n: jest.requireActual('@/i18n/i18n'),
      store: jest.requireActual('@/i18n/store'),
      messages: jest.requireActual('@/lib/errors/messages'),
    };
  });
  return modules;
}

describe('i18n', () => {
  beforeEach(() => {
    (Storage as unknown as MockStorage).clearSync();
  });
  afterEach(() => {
    jest.dontMock('expo-constants');
    jest.dontMock('expo-localization');
  });

  it('starts in English and translates error messages', () => {
    const { i18n, messages } = load(['en']);
    expect(i18n.default.language).toBe('en');
    expect(messages.toUserMessage('NO_SPACE')).toEqual({
      title: 'Your phone is out of storage',
      message: 'Free up some space, then try again.',
      recovery: 'freeSpace',
    });
    expect(messages.toRecoveryLabel('retry')).toBe('Try again');
  });

  it('switches language when the preference changes and the locale is enabled', () => {
    const { i18n, store, messages } = load(['en', 'fr']);
    store.useLocaleStore.getState().setPreference('fr');
    expect(i18n.default.language).toBe('fr');
    expect(messages.toUserMessage('NOT_FOUND').title).toBe('Fichier introuvable');
  });

  it('ignores a preference for a locale that is not enabled', () => {
    const { i18n, store } = load(['en']);
    store.useLocaleStore.getState().setPreference('ha');
    expect(i18n.default.language).toBe('en');
  });

  it('ignores disabled device languages', () => {
    expect(load(['en'], ['ha', 'fr']).i18n.default.language).toBe('en');
    expect(load(['en', 'ha'], ['ha', 'fr']).i18n.default.language).toBe('ha');
  });

  it('restores a saved preference on start, unless that locale was disabled since', () => {
    Storage.setItemSync('locale', JSON.stringify({ state: { preference: 'fr' }, version: 1 }));
    expect(load(['en', 'fr']).i18n.default.language).toBe('fr');
    expect(load(['en']).i18n.default.language).toBe('en');
  });

  it('rejects direct changeLanguage calls to disabled locales', async () => {
    const { i18n } = load(['en']);
    await i18n.default.changeLanguage('ha');
    expect(i18n.default.t('common.cancel')).toBe('Cancel');
  });
});
