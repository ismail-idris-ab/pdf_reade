import type { AndroidIntentFiltersData } from '@expo/config-types';
import type { ExpoConfig } from 'expo/config';
import {
  AndroidConfig,
  CodeGenerator,
  withAndroidManifest,
  withMainActivity,
  type ConfigPlugin,
} from 'expo/config-plugins';

const ANDROID_PACKAGE = 'com.ismailidris.pdfreader';

const WRITE_EXTERNAL_STORAGE = 'android.permission.WRITE_EXTERNAL_STORAGE';

// MIME types "Open with" (VIEW) and share (SEND / SEND_MULTIPLE) accept.
// Legacy application/msword and application/vnd.ms-excel are included too:
// WhatsApp and file managers still label old .doc/.xls files with them, and
// the office-viewing task (mammoth/SheetJS) does not distinguish by MIME type
// at open time, so accepting them costs nothing and avoids a dead end for
// users who still have those files.
const VIEWABLE_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/msword', // legacy .doc
  'application/vnd.ms-excel', // legacy .xls
  'text/csv',
  'text/plain',
];

// SEND / SEND_MULTIPLE: PDFs (share-to-this-app) and images (feeds the
// Image-to-PDF flow per T1.6).
const SHAREABLE_MIME_TYPES = ['application/pdf', 'image/*'];

// Expo's intent-filter renderer adds only the categories listed here - there
// is no implicit DEFAULT - so every filter below states its categories
// explicitly. None of these are web links, so none get BROWSABLE.
const viewIntentFilterData: AndroidIntentFiltersData[] = [
  // content:// and file:// are the two schemes "Open with" and file managers
  // hand over; each is listed once and crossed with every MIME type below by
  // Android's own data-matching (scheme and mimeType are independent sets).
  { scheme: 'content' },
  { scheme: 'file' },
  ...VIEWABLE_MIME_TYPES.map((mimeType) => ({ mimeType })),
];

type UsesPermissionAttributes = AndroidConfig.Manifest.ManifestUsesPermission['$'] & {
  'android:maxSdkVersion': string;
  'tools:replace': string;
};

// File actions on shared storage use legacy WRITE_EXTERNAL_STORAGE on Android
// 8-10 only (all-files access from Android 11). Expo's template declares it
// with maxSdkVersion 32 and tools:replace, which outranks every library
// manifest, so the app manifest entry itself is pinned to maxSdkVersion 29.
const withLegacyWriteStorageMaxSdk: ConfigPlugin = (expoConfig) =>
  withAndroidManifest(expoConfig, (mod) => {
    const androidManifest = AndroidConfig.Manifest.ensureToolsAvailable(mod.modResults);
    const manifest = androidManifest.manifest;
    const others = (manifest['uses-permission'] ?? []).filter(
      (permission) => permission.$['android:name'] !== WRITE_EXTERNAL_STORAGE,
    );
    const writeStorage: UsesPermissionAttributes = {
      'android:name': WRITE_EXTERNAL_STORAGE,
      'android:maxSdkVersion': '29',
      'tools:replace': 'android:maxSdkVersion',
    };
    manifest['uses-permission'] = [...others, { $: writeStorage }];
    mod.modResults = androidManifest;
    return mod;
  });

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
    // WRITE_EXTERNAL_STORAGE is not blocked: file actions on shared storage
    // need it on Android 8-10. The file-index module declares it with
    // maxSdkVersion 29 (Android 11+ uses all-files access instead).
    // "Open with" + share target (T1.6): file-index's getLaunchIntent/
    // onIncomingIntent (apiVersion 6) read these on the native side.
    intentFilters: [
      {
        action: 'VIEW',
        category: ['DEFAULT'],
        data: viewIntentFilterData,
      },
      {
        action: 'SEND',
        category: ['DEFAULT'],
        data: SHAREABLE_MIME_TYPES.map((mimeType) => ({ mimeType })),
      },
      {
        action: 'SEND_MULTIPLE',
        category: ['DEFAULT'],
        data: SHAREABLE_MIME_TYPES.map((mimeType) => ({ mimeType })),
      },
    ],
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

const HAND_OFF_TAG = 'pdf-reader-hand-off-intent';

const HAND_OFF_OVERRIDE = [
  '  // A VIEW/SEND hand-off is taken out of the intent before super runs, so',
  '  // React Native never reports its URI to JS and expo-router cannot route',
  '  // it as a deep link (which lands on "Unmatched Route" instead of opening',
  '  // the file). Anything that is not a hand-off, deep links included, is',
  '  // left untouched. See IncomingIntentCapture in the file-index module.',
  '  override fun onNewIntent(intent: Intent) {',
  '    com.ismailidris.pdfreader.fileindex.IncomingIntentCapture.claim(intent)',
  '    super.onNewIntent(intent)',
  '  }',
].join('\n');

const LAUNCH_HAND_OFF_TAG = 'pdf-reader-launch-hand-off';

const LAUNCH_HAND_OFF_CLAIM = [
  '    // Same for the intent this activity was created with: after the user',
  '    // backs out, the process (and the module) can outlive the activity, so',
  '    // the next "Open with" creates a new activity with no module start to',
  '    // claim it before expo-router reads it.',
  '    com.ismailidris.pdfreader.fileindex.IncomingIntentCapture.claimLaunch(intent)',
].join('\n');

/**
 * Merges a generated block into MainActivity, replacing an outdated copy.
 * An up-to-date copy is left as is (mergeContents reports didMerge: false
 * for it, which is why that flag is not a failure signal); a missing anchor
 * is rethrown with `failure`, which says what would break.
 */
function mergeOrExplain(
  options: Parameters<typeof CodeGenerator.mergeContents>[0],
  failure: string,
): string {
  try {
    return CodeGenerator.mergeContents(options).contents;
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ERR_NO_MATCH') throw new Error(failure);
    throw error;
  }
}

/**
 * Gives MainActivity an onNewIntent, and an onCreate step, that claim a file
 * hand-off before React Native handles the intent. A module cannot do this
 * itself: there is no "before JS" moment for a warm intent, nor for an
 * activity recreated in a live process, and RN reports the URI to JS first,
 * so expo-router routes the hand-off as a deep link.
 */
const withHandOffIntentCapture: ConfigPlugin = (expoConfig) =>
  withMainActivity(expoConfig, (mod) => {
    if (mod.modResults.language !== 'kt') {
      throw new Error(
        `MainActivity is ${mod.modResults.language}; this plugin generates Kotlin. ` +
          'Update it if the Expo template language changes.',
      );
    }
    const withImport = mergeOrExplain(
      {
        src: mod.modResults.contents,
        newSrc: 'import android.content.Intent',
        tag: `${HAND_OFF_TAG}-import`,
        anchor: /^import android\.os\.Bundle$/m,
        offset: 1,
        comment: '//',
      },
      'Could not import Intent in MainActivity: the expected anchor was not found.',
    );
    const withOverride = mergeOrExplain(
      {
        src: withImport,
        newSrc: HAND_OFF_OVERRIDE,
        tag: HAND_OFF_TAG,
        anchor: /^class MainActivity : ReactActivity\(\) \{$/m,
        offset: 1,
        comment: '//',
      },
      'Could not add onNewIntent to MainActivity: the expected anchor was not found. ' +
        'Warm-start file hand-offs would silently route to "Unmatched Route" (T1.6).',
    );
    mod.modResults.contents = mergeOrExplain(
      {
        src: withOverride,
        newSrc: LAUNCH_HAND_OFF_CLAIM,
        tag: LAUNCH_HAND_OFF_TAG,
        anchor: /^\s*super\.onCreate\(null\)$/m,
        offset: 0,
        comment: '//',
      },
      'Could not claim the launch intent in MainActivity.onCreate: the expected anchor ' +
        'was not found. Opening a file after backing out of the app would route to ' +
        '"Unmatched Route" (T1.6).',
    );
    return mod;
  });

export default withHandOffIntentCapture(withLegacyWriteStorageMaxSdk(config));
