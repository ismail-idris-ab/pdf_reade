import config from '../app.config';

type BuildPropertiesPlugin = [
  'expo-build-properties',
  { android: { minSdkVersion: number; targetSdkVersion: number; compileSdkVersion: number } },
];

function findBuildProperties(): BuildPropertiesPlugin[1] {
  const entry = config.plugins?.find(
    (plugin): plugin is BuildPropertiesPlugin =>
      Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );
  if (!entry) {
    throw new Error('expo-build-properties plugin is not configured');
  }
  return entry[1];
}

describe('app config', () => {
  it('uses the permanent Android application id', () => {
    expect(config.android?.package).toBe('com.ismailidris.pdfreader');
  });

  it('shows "Pdf Reader" as the launcher name', () => {
    expect(config.name).toBe('Pdf Reader');
  });

  it('blocks the legacy shared-storage write permission', () => {
    expect(config.android?.blockedPermissions).toContain(
      'android.permission.WRITE_EXTERNAL_STORAGE',
    );
  });

  it('targets Android only', () => {
    expect(config.platforms).toEqual(['android']);
  });

  it('pins the SDK levels required by the spec and Play policy', () => {
    const { android } = findBuildProperties();
    expect(android.minSdkVersion).toBe(26);
    expect(android.targetSdkVersion).toBeGreaterThanOrEqual(36);
    expect(android.compileSdkVersion).toBeGreaterThanOrEqual(android.targetSdkVersion);
  });
});

describe('Sentry config plugin', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  function pluginNames(): string[] {
    let loaded!: typeof config;
    jest.isolateModules(() => {
      loaded = jest.requireActual<{ default: typeof config }>('../app.config').default;
    });
    return (loaded.plugins ?? []).map((plugin) =>
      String(Array.isArray(plugin) ? plugin[0] : plugin),
    );
  }

  it('is left out without an auth token, so local release builds do not try to upload', () => {
    delete process.env.SENTRY_AUTH_TOKEN;
    expect(pluginNames()).not.toContain('@sentry/react-native/expo');
  });

  it('is added when the token, org and project are set', () => {
    Object.assign(process.env, {
      SENTRY_AUTH_TOKEN: 'test-token',
      SENTRY_ORG: 'org',
      SENTRY_PROJECT: 'project',
    });
    expect(pluginNames()).toContain('@sentry/react-native/expo');
  });

  it('fails clearly when the token is set without org and project', () => {
    process.env.SENTRY_AUTH_TOKEN = 'test-token';
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
    expect(() => pluginNames()).toThrow('SENTRY_ORG and SENTRY_PROJECT are required');
  });
});
