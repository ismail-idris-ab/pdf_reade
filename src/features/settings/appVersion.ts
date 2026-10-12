import Constants from 'expo-constants';

/**
 * Version name from an app config; null when none is set. Only the name is
 * read: the build number (versionCode) is managed remotely by EAS
 * (eas.json `appVersionSource: "remote"`), so the value in the embedded app
 * config would not match the installed build.
 */
export function readAppVersion(config: { version?: string } | null | undefined): string | null {
  return config?.version || null;
}

/** This build's version name, from the app config embedded at build time. */
export function getAppVersion(): string | null {
  return readAppVersion(Constants.expoConfig);
}
