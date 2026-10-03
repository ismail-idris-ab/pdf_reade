# Dependency licenses

Only permissive licences are allowed, with their notice/credit requirements honoured on the in-app open-source notices screen. GPL, LGPL and AGPL are rejected (rule decided 2026-10-03, T0.1b). Record every native dependency (and any notable JS dependency) here before it is added, with the source used to verify the license.

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
| PDFium 156.0.8076.0 (prebuilt) | chromium/8076 | BSD-3-Clause | release archive `licenses/pdfium.txt` | T0.1b |
| bblanchon/pdfium-binaries (packaging) | chromium/8076 | MIT | release archive `LICENSE` | T0.1b |
| PdfBox-Android (`com.tom-roush:pdfbox-android`) | 2.0.27.0 | Apache-2.0 | Maven Central POM `licenses` | T0.1b |
| NDK `libc++_shared.so` (already shipped by React Native; `pdf-engine` links the same copy) | NDK 27.1.12297006 | Apache-2.0 WITH LLVM-exception | present in the T0.1 baseline AAB | T0.1b (note) |
| Bouncy Castle (`bcprov`/`bcpkix`/`bcutil-jdk18on`) | 1.86 | Bouncy Castle Licence (MIT-style) | Maven Central POM `licenses`; MIT equivalence needs human verification | T0.1b |

## Transitive dependency notes

A full scan of `node_modules` (1,061 packages, T0.1) found no GPL/AGPL-only packages. One dual-licensed package:

- **node-forge 1.4.0** — `(BSD-3-Clause OR GPL-2.0)`. Used under **BSD-3-Clause**. Pulled in by Expo CLI tooling (dev-time only; not bundled into the app).

## Components bundled inside PDFium (T0.1b)

The prebuilt `libpdfium.so` statically links the components below. Their licence texts ship in the release archive under `licenses/`, and all of them must appear on the app's open-source notices screen.

| Component | Licence | Notes |
|-----------|---------|-------|
| PDFium | BSD-3-Clause | |
| Abseil, cpu_features | Apache-2.0 | |
| Catapult | BSD-3-Clause | |
| fast_float, simdutf, Little CMS | MIT | |
| Anti-Grain Geometry 2.3 | AGG licence (permissive) | Keep the notice. |
| FreeType | FreeType Licence (FTL) | The archive ships the FTL text only (no GPL option). FTL requires this credit in the documentation: "Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved." |
| ICU | Unicode License v3 (permissive) | |
| libjpeg-turbo | IJG + BSD-3-Clause | IJG requires this line in the documentation: "This software is based in part on the work of the Independent JPEG Group." |
| OpenJPEG | BSD-2-Clause | |
| libpng | PNG Reference Library License v2 (permissive) | |
| zlib | zlib licence (permissive) | |
| libunwind, LLVM libc | Apache-2.0 WITH LLVM-exception | |

**Decision (2026-10-03, owner):** the rule was widened from "Apache-2.0 / MIT / BSD only" to "permissive licences, with their notice requirements honoured", so FTL, IJG, zlib, libpng, Unicode v3, AGG and the Bouncy Castle Licence are allowed. GPL, LGPL and AGPL stay rejected. The FreeType and IJG credit lines above, and every licence text in the PDFium archive's `licenses/` folder, must appear on the in-app open-source notices screen before release.

PdfBox-Android also bundles Apache PDFBox's data files: Adobe AFM metrics for the standard 14 fonts, Adobe CMaps and glyph lists, and Unicode data files. Apache PDFBox documents these as permissively licensed. Re-check them against the PDFBox 2.0.27 `LICENSE.txt` before release (needs human verification).
