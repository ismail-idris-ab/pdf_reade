const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// With a Sentry auth token (EAS release builds), use Sentry's config so
// bundles get debug IDs matching the uploaded source maps. See app.config.ts.
const config = process.env.SENTRY_AUTH_TOKEN
  ? require('@sentry/react-native/metro').getSentryExpoConfig(__dirname)
  : getDefaultConfig(__dirname);
// Drizzle migrations are bundled as .sql files (inlined by babel-plugin-inline-import).
config.resolver.sourceExts.push('sql');

module.exports = withNativeWind(config, { input: './global.css' });
