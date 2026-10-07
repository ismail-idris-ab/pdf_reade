import type { ExpoConfig } from 'expo/config';

const ANDROID_PACKAGE = 'com.ismailidris.pdfreader';

// Sentry's config plugin only uploads source maps and debug symbols. It is
// added when an auth token is present (EAS release builds with the secret
// set); without one, local release builds would fail at the upload step.
// Crash capture itself works without the plugin (see src/lib/crash).
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = process.env.SENTRY_ORG;
const SENTRY_PROJECT = process.env.SENTRY_PROJECT;
if (SENTRY_AUTH_TOKEN && (!SENTRY_ORG || !SENTRY_PROJECT)) {
  throw new Error('SENTRY_AUTH_TOKEN is set, so SENTRY_ORG and SENTRY_PROJECT are required');
}
const sentryPlugin: [string, Record<string, string>][] =
  SENTRY_AUTH_TOKEN && SENTRY_ORG && SENTRY_PROJECT
    ? [
        [
          '@sentry/react-native/expo',
          { url: 'https://sentry.io/', organization: SENTRY_ORG, project: SENTRY_PROJECT },
        ],
      ]
    : [];

const config: ExpoConfig = {
  name: 'Pdf Reader',
  slug: 'pdf-reader',
  scheme: 'pdfreader',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  platforms: ['android'],
  android: {
    package: ANDROID_PACKAGE,
    versionCode: 1,
    adaptiveIcon: {
      // Artwork source: design/icon/build.mjs (concept B: red, page, 2026 tag).
      backgroundColor: '#E3262B',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Expo's template adds legacy WRITE_EXTERNAL_STORAGE; the app never writes
    // to shared storage that way (imports and shares go through the cache).
    blockedPermissions: ['android.permission.WRITE_EXTERNAL_STORAGE'],
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          image: './assets/splash-icon.png',
          backgroundColor: '#000000',
        },
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
          compileSdkVersion: 36,
          // Google Play requires API 36 for new apps and updates from 31 Aug 2026.
          targetSdkVersion: 36,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          packagingOptions: {
            // bcprov, bcpkix and bcutil each ship an identical copy of the
            // Bouncy Castle licence.
            pickFirst: ['META-INF/LICENSE.md'],
          },
        },
      },
    ],
    ...sentryPlugin,
  ],
  extra: {
    // Locales users can see. ha/fr stay off until a paid native-speaker
    // review clears docs/TRANSLATIONS_TO_REVIEW.md (CLAUDE.md).
    enabledLocales: ['en'],
  },
  experiments: {
    typedRoutes: true,
  },
};

export default config;
