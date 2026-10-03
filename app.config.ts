import type { ExpoConfig } from 'expo/config';

const ANDROID_PACKAGE = 'com.ismailidris.pdfreader';

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
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
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
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
