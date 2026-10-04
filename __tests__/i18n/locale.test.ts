import { resolveLocale } from '@/i18n/locale';

describe('resolveLocale', () => {
  const launch = ['en'] as const;
  const all = ['en', 'ha', 'fr'] as const;

  it('uses an explicit choice only when that locale is enabled', () => {
    expect(resolveLocale('fr', ['en'], all)).toBe('fr');
    expect(resolveLocale('fr', ['en'], launch)).toBe('en');
    expect(resolveLocale('ha', ['ha'], launch)).toBe('en');
  });

  it('follows the first enabled device language for "system"', () => {
    expect(resolveLocale('system', ['ha', 'en'], all)).toBe('ha');
    expect(resolveLocale('system', ['de', 'FR'], all)).toBe('fr');
    expect(resolveLocale('system', [null, 'en'], all)).toBe('en');
  });

  it('ignores disabled device languages', () => {
    expect(resolveLocale('system', ['ha', 'fr'], launch)).toBe('en');
  });

  it('falls back to English', () => {
    expect(resolveLocale('system', ['de', 'yo'], all)).toBe('en');
    expect(resolveLocale('system', [], all)).toBe('en');
  });
});

describe('getEnabledLocales', () => {
  function enabledWith(extra: unknown) {
    let result!: string[];
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { expoConfig: { extra } },
      }));
      result = jest
        .requireActual<typeof import('@/i18n/locale')>('@/i18n/locale')
        .getEnabledLocales();
    });
    jest.dontMock('expo-constants');
    return result;
  }

  it('reads the config flag and always keeps English', () => {
    expect(enabledWith({ enabledLocales: ['en'] })).toEqual(['en']);
    expect(enabledWith({ enabledLocales: ['fr'] })).toEqual(['en', 'fr']);
    expect(enabledWith({ enabledLocales: ['en', 'ha', 'xx'] })).toEqual(['en', 'ha']);
    expect(enabledWith(undefined)).toEqual(['en']);
  });

  it('matches the launch config in app.config.ts', () => {
    const config = jest.requireActual<{ default: { extra?: { enabledLocales?: unknown } } }>(
      '../../app.config',
    ).default;
    expect(config.extra?.enabledLocales).toEqual(['en']);
  });
});
