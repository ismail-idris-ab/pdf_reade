# Dependency licenses

Only Apache-2.0, MIT or BSD are allowed. AGPL and GPL are rejected. Record every native dependency (and any notable JS dependency) here before it is added, with the source used to verify the license.

| Dependency | Version | License | Verified from | Added in |
|------------|---------|---------|---------------|----------|
| expo | 57.0.26 | MIT | node_modules/expo/package.json | T0.1 |
| expo-build-properties | 57.0.22 | MIT | node_modules/expo-build-properties/package.json | T0.1 |
| expo-constants | 57.0.20 | MIT | node_modules/expo-constants/package.json | T0.1 |
| expo-dev-client | 57.0.19 | MIT | node_modules/expo-dev-client/package.json | T0.1 |
| expo-linking | 57.0.11 | MIT | node_modules/expo-linking/package.json | T0.1 |
| expo-router | 57.0.24 | MIT | node_modules/expo-router/package.json | T0.1 |
| expo-splash-screen | 57.0.9 | MIT | node_modules/expo-splash-screen/package.json | T0.1 |
| expo-status-bar | 57.0.1 | MIT | node_modules/expo-status-bar/package.json | T0.1 |
| expo-system-ui | 57.0.4 | MIT | node_modules/expo-system-ui/package.json | T0.1 |
| nativewind | 4.2.7 | MIT | node_modules/nativewind/package.json | T0.1 |
| react | 19.2.3 | MIT | node_modules/react/package.json | T0.1 |
| react-dom | 19.2.3 | MIT | node_modules/react-dom/package.json | T0.1 |
| react-native | 0.86.3 | MIT | node_modules/react-native/package.json | T0.1 |
| react-native-reanimated | 4.5.1 | MIT | node_modules/react-native-reanimated/package.json | T0.1 |
| react-native-safe-area-context | 5.7.0 | MIT | node_modules/react-native-safe-area-context/package.json | T0.1 |
| react-native-screens | 4.26.2 | MIT | node_modules/react-native-screens/package.json | T0.1 |
| react-native-worklets | 0.10.1 | MIT | node_modules/react-native-worklets/package.json | T0.1 |
| babel-preset-expo (dev) | 57.0.13 | MIT | node_modules/babel-preset-expo/package.json | T0.1 |
| eslint (dev) | 9.39.5 | MIT | node_modules/eslint/package.json | T0.1 |
| eslint-config-expo (dev) | 57.0.2 | MIT | node_modules/eslint-config-expo/package.json | T0.1 |
| eslint-config-prettier (dev) | 10.1.8 | MIT | node_modules/eslint-config-prettier/package.json | T0.1 |
| jest (dev) | 29.7.0 | MIT | node_modules/jest/package.json | T0.1 |
| jest-expo (dev) | 57.0.5 | MIT | node_modules/jest-expo/package.json | T0.1 |
| @types/jest (dev) | 29.5.14 | MIT | node_modules/@types/jest/package.json | T0.1 |
| @types/react (dev) | 19.2.18 | MIT | node_modules/@types/react/package.json | T0.1 |
| prettier (dev) | 3.9.9 | MIT | node_modules/prettier/package.json | T0.1 |
| tailwindcss (dev) | 3.4.19 | MIT | node_modules/tailwindcss/package.json | T0.1 |
| typescript (dev) | 6.0.3 | Apache-2.0 | node_modules/typescript/package.json | T0.1 |

## Transitive dependency notes

A full scan of `node_modules` (1,061 packages, T0.1) found no GPL/AGPL-only packages. One dual-licensed package:

- **node-forge 1.4.0** — `(BSD-3-Clause OR GPL-2.0)`. Used under **BSD-3-Clause**. Pulled in by Expo CLI tooling (dev-time only; not bundled into the app).
