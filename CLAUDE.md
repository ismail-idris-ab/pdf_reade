# Takarda — PDF Reader, Scanner & Editor (Android)

> "Takarda" is a working codename (Hausa: paper/document). Store title is keyword-driven, see TASKS.md T7.1.
> Android `applicationId`: **`com.ismailidris.pdfreader`** (permanent after first Play upload; neutral so the brand can change).

**How to work in this repo:** the full per-task loop, gates, report format and uncertainty rules live in `docs/WORKFLOW.md`. The reviewer subagent checklist lives in `docs/REVIEWER.md`. Read both at the start of every session.

## Product

Fast, private, ad-honest PDF reader + scanner + editor built for real-world Android phones (2–3 GB RAM, limited data, portal uploads, WhatsApp-delivered documents).

### Market & model
- **Launch market: Nigeria first, then Africa (anglophone + francophone).** Design for low-end devices, expensive data, and portal uploads with strict file-size limits.
- **Revenue: ads + rewarded first**, cheap Naira-priced Play Billing tiers second. Optimize for DAU and ad-session quality, not paywall conversion.
- UI languages: English, Hausa, French are **built** from day one — all strings through i18n, no hardcoded copy. **Only English is enabled at launch.** `ha` and `fr` stay hidden behind a config flag until a paid native-speaker review clears `docs/TRANSLATIONS_TO_REVIEW.md`.
- Keep the app data-light: small AAB. **Network allow-list** — the app talks only to:
  - Google Mobile Ads (AdMob + mediation adapters) and UMP consent
  - Google Play Billing via RevenueCat
  - Sentry (crash reporting, PII-scrubbed)
  - Firebase Remote Config (ad placements/frequency flags)
  - Firebase Analytics (funnel events; no file names/paths; opt-out in Settings)
  - Play Install Referrer (web → app attribution)

  Any other endpoint requires an approved change to this list.

### Non-negotiables
1. **Reading is never gated and never interrupted by ads.** No ads inside reader, editor, scanner or paywall screens.
2. **All document processing happens on-device.** No file leaves the device except an explicit user share, or opt-in AI features (Phase 8) that send extracted text only.
3. **No deceptive monetization.** No fake system alerts, no fake "update required", no fabricated social proof, no hidden trial terms.
4. **Never corrupt a user's file.** Every write is atomic (temp file → verify → rename / save-as-new).
5. **Works without all-files access.** Auto-scan requires MANAGE_EXTERNAL_STORAGE; manual picking (SAF), "Open with" and share-target must work fully without it.
6. **Performance budget:** cold start < 1.5s on a low-end device, 60fps page scroll, reader memory < 250 MB on a 300-page PDF. "Low-end device" means a physical phone with **≤ 3 GB RAM**. Budgets measured only on an emulator or a ≥ 4 GB phone are reported as "unverified on low-end hardware".

## Stack
- Expo SDK (latest stable) with **dev client + EAS Build**. Expo Go is not supported (native modules).
- TypeScript `strict: true`. expo-router. NativeWind v4 (Tailwind utilities only, no StyleSheet unless NativeWind can't express it).
- State: Zustand. Persistence: expo-sqlite + drizzle-orm (migrations checked in).
- Lists: @shopify/flash-list. Gestures/animation: react-native-gesture-handler + react-native-reanimated. Drawing overlays: @shopify/react-native-skia.
- Local Expo modules (Kotlin) in `/modules`:
  - `pdf-engine` — PDFium binding (render, text, search, outline, password) + PdfBox-Android (all write operations).
  - `file-index` — storage scanning, all-files-access status/request, content:// resolution, FileProvider sharing.
  - `secure-vault` — Android Keystore AES-256-GCM streaming encryption.
- Scanner: Google ML Kit Document Scanner (GMS). OCR (Phase 8): ML Kit Text Recognition v2 (on-device).
- Office viewing: mammoth (DOCX → HTML in WebView), SheetJS (XLSX/CSV → table). PPTX deferred.
- Monetization: RevenueCat (`react-native-purchases`) on Google Play Billing; `react-native-google-mobile-ads` with UMP consent.
- Crash reporting: Sentry.

### Licensing rule (hard)
Only Apache-2.0 / MIT / BSD dependencies. **No AGPL** (MuPDF, iText 7) and no GPL. Verify the license of every native dependency before adding it and record it in `docs/LICENSES.md`.

## Architecture
```
app/                      expo-router routes
src/
  features/
    library/  reader/  tools/  scanner/  editor/  vault/  paywall/  settings/  onboarding/
  db/                     drizzle schema, migrations, repositories
  lib/
    engine/               typed TS wrappers over modules/pdf-engine
    files/                typed TS wrappers over modules/file-index
    entitlements.ts       single source of truth for feature gating + free quotas
    ads/  purchases/  analytics/  errors/
  components/             shared UI primitives
modules/
  pdf-engine/  file-index/  secure-vault/
docs/
  TASKS.md  WORKFLOW.md  REVIEWER.md  LICENSES.md  DATA_SAFETY.md  TRANSLATIONS_TO_REVIEW.md
```

### Engine rules
- Heavy work runs in Kotlin on `Dispatchers.IO` / `Dispatchers.Default`. JS receives a promise plus progress events. All long ops accept a cancellation token.
- **Never pass PDF bytes or base64 across the bridge.** Pass file paths / URIs only.
- content:// inputs are copied to app cache before processing; keep the original URI for save-back when writable.
- Page coordinates exchanged with JS are **normalized (0–1) in page space**, unrotated, origin top-left. Conversion to PDF user space happens only in Kotlin.
- Open documents are tracked by `docId` with explicit `close(docId)`; the reader closes on unmount. Leaks are bugs.

### Errors
Typed error codes shared between Kotlin and TS: `PASSWORD_REQUIRED`, `WRONG_PASSWORD`, `CORRUPT_FILE`, `UNSUPPORTED`, `NO_SPACE`, `OUT_OF_MEMORY`, `CANCELLED`, `PERMISSION_DENIED`, `NOT_FOUND`. Every screen that touches a file handles all of them with a human message and a recovery action.

### Gating
All paid/limited features go through `gate(feature)` / `useEntitlement()` from `src/lib/entitlements.ts`. No inline `isPro` checks scattered in screens.

## Conventions
- Functional components, hooks, Tailwind classes. No `any`. No TODO stubs or placeholder logic.
- Pure TS logic gets Jest tests (entitlements, quotas, coordinate transforms, target-size planner).
- Engine ops get Kotlin unit/instrumented tests with fixture PDFs in `modules/pdf-engine/android/src/test/resources/fixtures/` (include: encrypted, corrupt, 500+ pages, scanned image-only, rotated pages, mixed page sizes, forms).
- Before marking a task done: `npx tsc --noEmit`, `npm run lint`, `npm test`, and for anything touching rendering, a run on a physical low-end device.

## Workflow
See `docs/WORKFLOW.md` (binding). Summary: one task at a time from `docs/TASKS.md`, in order; restate acceptance criteria first; verify mechanically; independent reviewer subagent; stop for review at the gates defined there. If an approach is infeasible, stop and propose alternatives instead of silently substituting.
