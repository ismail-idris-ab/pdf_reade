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
