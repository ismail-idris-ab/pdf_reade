# TASKS — Pdf Reader (Android, Expo)

Scope: **MVP = every task tagged `[launch]`** across Phases 0–7 plus W1–W4. Tasks tagged `[post-launch]` are skipped on the first pass and picked up after launch in the order listed. The original estimate of 35–38 working days is optimistic; plan against the `[launch]` set only. Phase W runs in a separate repo and can be done in parallel sessions from Phase 3 onward (it reuses the target-size logic). Phase 8 is post-launch.
Market: Nigeria first, then Africa. Revenue: ads + rewarded first. Launch language: English only (Hausa/French built but hidden until reviewed).
Each task is sized for one Claude Code session. Do them in order. Process: `docs/WORKFLOW.md`.

---

## Phase 0 — Foundation

- [x] **T0.1 Project init** `[launch]`
  Expo (latest SDK) + dev client, TS strict, expo-router, NativeWind v4, ESLint/Prettier, `@/` path alias. `eas.json` with `development`, `preview` (APK), `production` (AAB) profiles. Android package id `com.ismailidris.pdfreader`, `minSdkVersion 26`, target SDK = current Play requirement. Local modules scaffolded: `pdf-engine`, `file-index`, `secure-vault` (empty APIs that compile).
  **Done when:** dev build installs and launches on a physical device; `tsc`, lint pass.

- [x] **T0.1b Native engine spike (PDFium + PdfBox-Android)** `[launch]`
  Timeboxed to one session; runs right after T0.1 because a failure here can change the stack. Integrate prebuilt PDFium binaries (e.g. `bblanchon/pdfium-binaries`) with a thin own JNI layer inside `modules/pdf-engine`, and PdfBox-Android, then prove the pipeline end to end. Do not build on unmaintained `pdfium-android` forks unless the checks below show they pass.
  **Done when:** (1) PDFium renders page 1 of a fixture PDF to a bitmap inside the Expo module on the Android 16 phone and the emulator; (2) PdfBox-Android merges two PDFs and the output opens in PDFium; (3) every bundled `.so` passes a 16 KB page-size alignment check; (4) release AAB size growth from the native libraries is measured and reported; (5) all licenses are verified and recorded in `docs/LICENSES.md`. If any check fails: stop, show the evidence, propose alternatives.

- [x] **T0.2 Database** `[launch]`
  drizzle + expo-sqlite. Tables: `files` (id, path, uri, name, ext, mime, size, mtime, pageCount, lastOpenedAt, isFavorite, source), `bookmarks` (fileId, page, label, createdAt), `reading_state` (fileId, page, zoom, mode), `trash` (id, originalPath, trashedPath, deletedAt), `usage` (feature, day, count), `annotation_drafts` (fileId, json, updatedAt). FTS5 virtual table on file names. Typed repositories. Migrations checked in.
  **Done when:** repositories have Jest tests (in-memory or mocked) for CRUD + migration from empty.

- [x] **T0.3 Design system** `[launch]`
  Theme tokens (light / dark / sepia), persisted color scheme, primitives: Button, IconButton, ListItem, BottomSheet, Dialog, Toast, EmptyState, ProgressSheet (with cancel). Accessible touch targets ≥ 48dp.

- [ ] **T0.4 Errors + crash reporting** `[launch]`
  Shared error codes (see CLAUDE.md), `toUserMessage(code)`, global error boundary, Sentry init with PII scrubbing (strip file paths/names from breadcrumbs).

- [ ] **T0.5 CI** `[launch]`
  GitHub Actions: install, `tsc --noEmit`, lint, Jest on every push.

- [ ] **T0.6 i18n** `[launch]`
  i18next + expo-localization. Locales: `en`, `ha` (Hausa), `fr`. Typed translation keys (missing key = type error). In-app language switcher overriding device locale. `ha` and `fr` are hidden from the switcher and ignored as device locales unless the `enabledLocales` config flag includes them (launch config: `["en"]`). Every new `ha`/`fr` string is logged in `docs/TRANSLATIONS_TO_REVIEW.md`. Number/size formatting per locale (KB/MB).

## Phase 1 — File access & library

- [ ] **T1.1 `file-index` native module** `[launch]`
  `hasAllFilesAccess()`, `openAllFilesAccessSettings()`, `scan({ exts, knownMtimes })` streaming batches via events (skip `Android/data`, `Android/obb`, hidden dirs, >5 levels of symlinks), `stat(path)`, `copyContentUriToCache(uri)`, `share(paths, mime)` via FileProvider with narrowly scoped paths.
  **Done when:** full scan of a device with ~2,000 files completes without blocking UI; incremental rescan only emits changed files.

- [ ] **T1.2 Onboarding + permission flow** `[launch]`
  Value-first screen → "Allow access to find all documents" or "Pick files manually". Re-check permission on resume. Library works fully in manual mode (SAF picker, persisted URI permissions).

- [ ] **T1.3 Library screens** `[launch]`
  Tabs: All / PDF / Word / Excel / Other; sections Recent, Favorites. Source chips: All, Downloads, **WhatsApp** (`Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents`), Scans, My Files. List/grid toggle, sort (name, date, size), name search via FTS. First-page thumbnails rendered by engine, disk-cached with LRU cap (100 MB).
  **Done when:** 2,000-item library scrolls at 60fps on low-end device; thumbnails never block scroll.

- [ ] **T1.4 File actions + folders** `[launch]`
  Rename, move, duplicate, details, favorite, share, print, delete. Until T1.5 (recycle bin, post-launch) ships, delete is permanent and always behind a confirmation dialog naming the file. App-managed "My Files" folder with nested folders + import.

- [ ] **T1.5 Recycle bin** `[post-launch]`
  Trash into app-private dir with metadata, restore to original path (conflict → rename), 30-day auto-purge on launch, empty trash.

- [ ] **T1.6 Intents: "Open with" + share target** `[launch]`
  Config plugin adding intent filters: `VIEW` for `application/pdf` and DOCX/XLSX/CSV/TXT MIME types; `SEND` / `SEND_MULTIPLE` for PDFs and images (images → Image-to-PDF flow). Handle cold and warm starts.
  **Done when:** opening a PDF from WhatsApp and a file manager lands directly in the reader; sharing 5 images from Gallery opens Image-to-PDF prefilled.

## Phase 2 — Reader (the core; don't rush it)

Device rule: every Phase 2 task stays `BLOCKED (device)` until it passes on the low-end reference phone (≤ 3 GB RAM). Buy it before starting this phase.

- [ ] **T2.1 `pdf-engine` read API (PDFium)** `[launch]`
  `open(path, password?) → { docId, pageCount, pageSizes[], isEncrypted }`, `close(docId)`, `getOutline(docId)`, `getPageText(docId, page)`, `search(docId, query)` streaming `{ page, rects[] }` (normalized), `getTextRects(docId, page)`. Password errors map to typed codes.

- [ ] **T2.2 Native page view** `[launch]`
  Expo native view `PdfPageView` props: `docId`, `page`, `renderScale`, `nightMode`, `sepia`. Renders bitmap off the UI thread, recycles bitmaps, cancels render when recycled by the list. Placeholder while rendering.

- [ ] **T2.3 Reader screen** `[launch]`
  FlashList of `PdfPageView` + per-page overlay slot (Skia canvas in normalized coords). Modes: continuous vertical, horizontal paged. Page indicator, jump-to-page, thumbnail strip, keep-screen-on, fullscreen tap-toggle. Restore last page/zoom/mode from `reading_state`.

- [ ] **T2.4 Zoom** `[launch]`
  Pinch + double-tap zoom (1×–5×) with reanimated. On gesture settle, visible pages re-render at `renderScale` = zoom × density (capped by memory budget); low-res bitmap stays visible until hi-res is ready.
  **Done when:** zooming a text page to 4× is crisp within ~300ms; no OOM on 500-page file.

- [ ] **T2.5 Password PDFs** `[launch]`
  Password prompt, wrong-password retry, never persist passwords (unless stored inside the vault in Phase 6).

- [ ] **T2.6 Search, outline, bookmarks** `[launch]`
  In-document search with highlight overlay + next/prev, outline (TOC) sheet, page bookmarks list.

- [ ] **T2.7 Reading comfort** `[post-launch]`
  Night mode (color-matrix inversion in native, preserving image hue where possible), sepia/eye-comfort, brightness overlay.

- [ ] **T2.8 Text selection & copy** `[launch]`
  Long-press → word selection using `getTextRects`, draggable handles, copy/share actions. The "highlight" action arrives with the annotation editor (T4.1–T4.3, post-launch).

- [ ] **T2.9 Reflow mode** `[post-launch]`
  Per-page extracted text rendered as scrollable text with adjustable font size and line height. Graceful message for scanned (image-only) pages.

- [ ] **T2.10 Office + text viewing** `[post-launch]`
  DOCX via mammoth → sanitized HTML in WebView (JS disabled, no network), XLSX/CSV via SheetJS → virtualized table with sheet tabs, TXT with encoding detection. PPTX → "Open with another app" for now.

## Phase 3 — Tools

- [ ] **T3.1 `pdf-engine` write API (PdfBox-Android)** `[launch]`
  `merge(paths[])`, `split(path, ranges)`, `extractPages`, `deletePages`, `rotatePages`, `reorderPages`, `insertBlankPage`, `imagesToPdf(images[], { pageSize: A4|Letter|Fit, margin, orientation })`, `encrypt(path, userPw, ownerPw?)` (AES-256), `decrypt`, `pdfToImages(path, { dpi, format })`. All: progress events, cancellation, atomic output.
  **Done when:** Kotlin tests pass against every fixture; output opens in PDFium and a desktop reader.

- [ ] **T3.2 Compress + "Compress to target size" (differentiator)** `[launch]`
  Presets (Low / Medium / Strong) that downsample and re-encode embedded images. Target mode: user enters e.g. "200 KB" → binary search over (image DPI, JPEG quality) with a max of ~6 passes; returns best result + whether target was met. If not reachable (text/vector-heavy), explain why and offer grayscale or rasterize-pages fallback with a clear quality warning.
  **Done when:** a 5 MB scanned PDF reliably lands under 200 KB and 500 KB targets with readable output.

- [ ] **T3.3 Page organizer** `[launch]`
  Thumbnail grid, drag to reorder, multi-select rotate/delete/extract, insert blank, save as new or overwrite (with confirm).

- [ ] **T3.4 Tools hub + result flow** `[launch]`
  Hub: Scan, Image→PDF, Merge, Split, Compress, Compress to size, Organize, Lock/Unlock, PDF→Images, Print. Shared result screen: open / share / save to folder / "Send on WhatsApp". Each completion increments `usage` for quota gating.

- [ ] **T3.5 Scanner + "Submit-ready PDF" preset (differentiator)** `[launch]`
  ML Kit Document Scanner (auto-edge, crop, filters). After capture: options → PDF or images; preset "Submit-ready": A4, grayscale, target size (100 KB / 200 KB / 500 KB / 1 MB / custom), filename prompt.

- [ ] **T3.6 Photo resize/compress to KB (differentiator, high-volume in Nigeria)** `[launch]`
  Input image(s) → crop presets (passport 1:1, 3:4, custom px), optional white background cleanup, output JPEG under a target size (e.g. 20 KB / 50 KB / 100 KB / 200 KB / custom) via binary search over dimensions + quality. Shares the target-size planner with T3.2 (planner logic in pure TS where possible, Jest-tested).
  **Done when:** a 4 MB camera photo reliably lands under 50 KB at portal-acceptable dimensions.

## Phase 4 — Annotate & sign

- [ ] **T4.1 Annotation model** `[post-launch]`
  TS types for highlight, underline, strikeout, ink, free text, rectangle, image, signature — normalized coords, color, opacity, width. Undo/redo stack. Auto-save drafts to `annotation_drafts`.

- [ ] **T4.2 Annotation tools UI** `[post-launch]`
  Toolbar + Skia overlay: text-anchored highlight/underline/strike (via text rects; freeform rect fallback on scanned pages), pen with path smoothing, eraser, text box, shapes, color/width pickers.

- [ ] **T4.3 Save annotations (PdfBox)** `[post-launch]`
  Write as **standard PDF annotation objects** (Highlight, Underline, StrikeOut, Ink, FreeText, Square) so they're editable in Adobe/others. Option "Flatten into page". Loading existing annotations back into the editor.

- [ ] **T4.4 Signatures** `[launch]`
  Draw / type (3 script fonts) / import image with background removal (threshold). Saved signatures stored encrypted. Place, resize, rotate, stamp. UI labels it "Signature" — do not call it a certified/digital signature.
  Launch scope: because T4.1–T4.3 are post-launch, this task ships its own minimal path — a placement overlay (normalized coords) and a PdfBox write that stamps the signature as an image onto the page, saved as a new file (atomic). The full annotation model later absorbs this without changing saved-signature storage.

- [ ] **T4.5 Add text & images to pages** `[post-launch]`
  Place text (font, size, color) and images anywhere; written via PdfBox.

## Phase 5 — Monetization (ads + rewarded first)

- [ ] **T5.1 Ads stack with mediation** `[launch]`
  `react-native-google-mobile-ads` + AdMob mediation (add networks with strong African fill — e.g. Meta Audience Network, Unity, Liftoff/Vungle, AppLovin; verify each adapter supports current SDK). UMP consent flow before init. Ad unit IDs per placement via remote config (Firebase Remote Config) so placements/frequencies can change without a release. Test IDs in dev builds, enforced by build profile.
  **Done when:** every placement fills in test mode; ads never initialize before consent resolution.

- [ ] **T5.2 Placements + frequency rules** `[launch]`
  - Library: adaptive banner (bottom), native ad every ~12 items.
  - Tool result screen: native ad card (high viewability, zero annoyance).
  - Interstitial: only after a completed tool output; min 3 min apart, max 3/session, none in first session, none if a rewarded ad was watched in the last 5 min.
  - App-open ad: **off at launch** (retention risk); remote-config flag to A/B later.
  - **Zero ads in reader, editor, scanner camera, and paywall.**
  All rules in one `adPolicy.ts`, Jest-tested.

- [ ] **T5.3 Rewarded unlocks (primary monetization lever)** `[launch]`
  Any Pro action shows a sheet: "Watch a short ad to unlock this once" / "Go Pro". Rewarded → single-use token for that action. Also: rewarded "Ad-free for 24h" and rewarded "+5 tool uses today". Handle no-fill gracefully (grant one free use on repeated no-fill so users aren't blocked by the ad network).
  **Done when:** rewarded completion reliably grants exactly one use; closing early grants nothing; no-fill never dead-ends the user.

- [ ] **T5.4 Purchases (RevenueCat, Play Billing, Naira pricing)** `[launch]`
  Secondary tier. Products: `remove_ads` (one-time), `pro_weekly`, `pro_monthly`, `pro_lifetime`. Set local NGN prices in Play Console at impulse levels; don't mirror US pricing. Entitlements: `no_ads`, `pro`. Restore, offline entitlement cache. No external payment links for digital unlocks (Play policy).

- [ ] **T5.5 Entitlements + quotas** `[launch]`
  `src/lib/entitlements.ts`: feature → required entitlement | free daily quota | rewarded-unlockable. Free: reading, search, bookmarks, basic highlight/pen, 3 scans/day, 3 merges/day, 3 compress-preset/day. Rewarded-unlockable or Pro: compress-to-size, photo-to-KB beyond 2/day, signatures, add text/images, lock/unlock, organizer save. Pro-only: vault. Jest-tested.

- [ ] **T5.6 Lightweight paywall** `[launch]`
  Shown only when user taps "Go Pro" or after the 3rd rewarded unlock in a day. Local prices from Play, trial terms stated plainly if any, visible close button, no fabricated user counts.

- [ ] **T5.7 In-app review** `[post-launch]`
  Play In-App Review after 3rd successful tool completion or 5th reading session; max once per 60 days. Never right after an ad.

## Phase 6 — Security & hardening

- [ ] **T6.1 App lock** `[post-launch]`
  Optional biometric/PIN lock (expo-local-authentication), lock after configurable background timeout.

- [ ] **T6.2 Secure vault (Pro)** `[post-launch]`
  Move files into app-private encrypted storage: AES-256-GCM streaming (chunked, per-file IV), key in Android Keystore requiring user auth. Vault screens use FLAG_SECURE. Export back out decrypts to a user-chosen location.

- [ ] **T6.3 Hardening** `[launch]`
  R8 minify + shrink, `usesCleartextTraffic=false`, backup rules excluding vault/signatures/drafts, only intended components exported, release logs stripped, WebViews with JS disabled and no file access for office preview. Fuzz pass: open every fixture + a corpus of 50 malformed PDFs with zero crashes.

- [ ] **T6.4 Privacy docs** `[launch]`
  `docs/DATA_SAFETY.md` mapping each SDK (AdMob, RevenueCat, Sentry, Firebase Analytics, Firebase Remote Config) to Play Data Safety answers — declare accurately; do not claim "no data collected" while running ads. Privacy policy page (static site). Analytics runs on by default with disclosure in onboarding + privacy policy and an opt-out in Settings; UMP handles ad consent where Google requires it.
  **Needs human verification:** whether the Nigeria Data Protection Act 2023 (and francophone-market laws) require explicit opt-in consent for analytics; adjust the default if so.

## Phase 7 — Launch & ASO

- [ ] **T7.1 Store listing** `[launch]`
  Title (≤30 chars) leads with the primary keyword, e.g. "PDF Reader: PDF Viewer Offline" (pick from `docs/ASO_KEYWORDS.md`). Short description (≤80) with top keywords. Long description: natural keyword use (pdf reader, pdf viewer, pdf reader offline, document reader, pdf editor, scanner, compress pdf, merge pdf, sign pdf, image to pdf), feature bullets, privacy + "no ads while reading" promise. 8 screenshots with benefit captions (Compress to exact size, Submit-ready scans, WhatsApp docs, Offline & private). Feature graphic. Default listing in English written for Nigerian search behaviour ("compress pdf", "reduce pdf size", "pdf to 100kb", "passport photo resize"). Country-targeted custom store listings for Nigeria, Ghana, Kenya. **Launch is English-only:** the French listing (francophone Africa) and any Hausa listing/screenshots are added only after the corresponding section of `docs/TRANSLATIONS_TO_REVIEW.md` is cleared by a paid native-speaker reviewer and `ha`/`fr` are enabled in config. Find and budget those reviewers as part of this task.

- [ ] **T7.2 Permission declaration** `[launch]`
  All-files-access declaration: core use = document management/reader, with a short demo video showing scan → library. App must remain functional if denied.

- [ ] **T7.3 Release pipeline** `[launch]`
  Internal → closed testing (budget for Play's closed-testing requirement if it applies to your account) → staged production rollout (10% → 50% → 100%) watching crash-free rate and ANRs.

- [ ] **T7.4 Analytics funnel** `[launch]`
  Events: install_open, permission_granted/denied, first_file_opened, tool_completed{tool}, paywall_shown{trigger}, trial_started, purchase{product}, rewarded_unlock{tool}. No file names or paths in events.

- [ ] **T7.5 Open-source notices screen** `[launch]`
  Settings → "Open-source licences": every entry in `docs/LICENSES.md`, the full licence texts shipped in the PDFium archive's `licenses/` folder, and the FreeType and IJG credit lines (required by FTL and IJG). Generated at build time from a checked-in list so it can't drift from the dependencies.
  **Done when:** every native and bundled component in `docs/LICENSES.md` appears with its full licence text; screen works offline.

## Phase W — Web SEO companion (separate repo, parallel from Phase 3)

Stack: Next.js (App Router) with **static export** (`output: 'export'`), TypeScript, Tailwind, hosted on **Cloudflare Pages** (free tier permits commercial use; Vercel Hobby is non-commercial only). No middleware: locales are static route folders. All processing **in the browser** (pdf-lib, pdf.js, canvas image re-encode). No uploads, no backend — say so on every page. That's both the privacy pitch and the zero-cost hosting model.
Prerequisite: buy the site domain before W1 (needed for canonical/hreflang, sitemap, and `assetlinks.json` in W4).

- [ ] **W1 Scaffold + SEO base** `[launch]`
  Next.js app, i18n routes (`/`, `/ha`, `/fr`), `metadata` API per page, sitemap.xml, robots.txt, canonical + hreflang tags, JSON-LD (`SoftwareApplication` for the app, `HowTo` + `FAQPage` on tool pages). Lighthouse ≥ 95 on mobile (fast on 3G is a ranking and UX requirement here).

- [ ] **W2 Browser tools** `[launch]`
  Compress PDF (presets), Compress PDF to target size, Photo to KB (passport presets), Image to PDF, Merge PDF. Heavy work in Web Workers; hard file-size cap with a clear "use the app for big files" CTA. Shared target-size planner logic ported from the app.

- [ ] **W3 Programmatic landing pages** `[launch]`
  Data-driven pages from a typed content file: size targets ("compress PDF to 100KB", "…200KB", "resize photo to 20KB") and use cases ("reduce PDF size for online application upload", "scan documents with phone"). Each page: the tool embedded above the fold, a short unique how-to, FAQs, app CTA. **Before publishing any page naming a specific portal (exam boards, NYSC, scholarship/visa sites), verify that portal's current file requirements from its official source and cite it; don't invent limits.** Avoid thin duplicate pages — each needs unique copy.

- [ ] **W4 App funnel** `[launch]`
  Smart "Get the app" banner (Android only), Play Store links with UTM → install referrer tracked in the app. Android App Links (`assetlinks.json`) so `/tools/compress-to-size` opens the matching app screen when installed.

- [ ] **W5 Measure + monetize lightly** `[post-launch]`
  Privacy-friendly analytics (Plausible/Umami or Cloudflare Web Analytics), Google Search Console + Bing Webmaster verified. Optional: a single AdSense unit below the tool (never between upload and result). Primary goal is installs, not web ad revenue.

- [ ] **W6 Content cadence** `[post-launch]`
  One new landing page or guide per week driven by Search Console queries you're already appearing for. Cross-post short demos to your content channels linking to the matching page.

## Phase 8 — Post-launch growth (after retention data)

- [ ] **T8.2 OCR → searchable PDF (Pro)** — ML Kit Text Recognition, invisible text layer written via PdfBox.
- [ ] **T8.3 Form filling** — AcroForm field detection + fill + flatten.
- [ ] **T8.4 AI (Pro, opt-in)** — Summarize / ask-the-document / translate (incl. Hausa, French, Arabic). Text extracted on-device, sent via your own server proxy with per-user quotas; explicit consent screen.
- [ ] **T8.5 DOCX/HTML → PDF** — render HTML and print to PDF via Android print adapter; label fidelity honestly.
- [ ] **T8.6 "Edit existing text"** — whiteout + overlay replacement (what most competitors actually do), clearly scoped.
- [ ] **T8.7 iOS build** — once Android unit economics are proven.

---

## KPIs to watch weekly
D1 retention ≥ 40%, D7 ≥ 20% · crash-free users ≥ 99.5%, ANR < 0.47% · "Always open with" adoption · tool completions/user · paywall view → trial · trial → paid · rewarded unlocks/DAU · **ARPDAU, eCPM by format, ad fill rate** · web: organic clicks, tool completions, install CTR from web · rating ≥ 4.5.
