import type { AndroidConfig } from 'expo/config-plugins';

import config from '../app.config';

const WRITE_EXTERNAL_STORAGE = 'android.permission.WRITE_EXTERNAL_STORAGE';

type AndroidManifest = AndroidConfig.Manifest.AndroidManifest;

/** A <uses-permission> entry, with the attributes this config sets on it. */
type UsesPermission = {
  $: AndroidConfig.Manifest.ManifestUsesPermission['$'] & {
    'android:maxSdkVersion'?: string;
    'tools:replace'?: string;
  };
};

/** `mods` is added by the manifest plugin, so it is not on ExpoConfig itself. */
type ManifestMod = (mod: {
  modResults: AndroidManifest;
}) => Promise<{ modResults: AndroidManifest }>;
type ConfigMods = { android?: { manifest?: ManifestMod } };

/**
 * Runs the config's own android manifest mod over `permissions`, the way
 * prebuild does, and returns the resulting <uses-permission> entries.
 */
async function applyManifestMod(permissions: UsesPermission[]): Promise<UsesPermission[]> {
  const manifest: AndroidManifest = {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      queries: [],
      'uses-permission': permissions,
    },
  };
  const mods = (config as typeof config & { mods?: ConfigMods }).mods;
  const mod = mods?.android?.manifest;
  if (!mod) throw new Error('the android manifest mod is not configured');
  const { modResults: applied } = await mod({ modResults: manifest });
  expect(applied.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
  return applied.manifest['uses-permission'] ?? [];
}

const entry = (name: string, maxSdkVersion?: string): UsesPermission => ({
  $: maxSdkVersion
    ? { 'android:name': name, 'android:maxSdkVersion': maxSdkVersion }
    : { 'android:name': name },
});

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

  it('no longer blocks the legacy shared-storage write permission', () => {
    // File actions on shared storage need it on Android 8-10; the manifest
    // mod below caps it at API 29 so Android 11+ never sees it.
    expect(config.android?.blockedPermissions ?? []).not.toContain(WRITE_EXTERNAL_STORAGE);
  });

  it('targets Android only', () => {
    expect(config.platforms).toEqual(['android']);
  });
});

describe('legacy write permission manifest mod', () => {
  it('pins the permission to Android 10 and marks it as replacing library values', async () => {
    const permissions = await applyManifestMod([entry(WRITE_EXTERNAL_STORAGE, '32')]);
    expect(permissions).toEqual([
      {
        $: {
          'android:name': WRITE_EXTERNAL_STORAGE,
          'android:maxSdkVersion': '29',
          'tools:replace': 'android:maxSdkVersion',
        },
      },
    ]);
  });

  it('leaves exactly one entry when the template declared it more than once', async () => {
    const permissions = await applyManifestMod([
      entry(WRITE_EXTERNAL_STORAGE, '32'),
      entry(WRITE_EXTERNAL_STORAGE),
    ]);
    expect(
      permissions.filter((item) => item.$['android:name'] === WRITE_EXTERNAL_STORAGE),
    ).toHaveLength(1);
  });

  it('adds the entry when the template declared none', async () => {
    const permissions = await applyManifestMod([]);
    expect(permissions.map((item) => item.$['android:name'])).toEqual([WRITE_EXTERNAL_STORAGE]);
  });

  it('keeps every other permission untouched', async () => {
    const read = entry('android.permission.READ_EXTERNAL_STORAGE', '32');
    const internet = entry('android.permission.INTERNET');
    const permissions = await applyManifestMod([read, internet, entry(WRITE_EXTERNAL_STORAGE)]);
    expect(permissions.slice(0, 2)).toEqual([read, internet]);
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
