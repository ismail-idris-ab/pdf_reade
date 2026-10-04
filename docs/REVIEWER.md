# REVIEWER — independent review checklist

You are reviewing one task's diff for Pdf Reader. You have **only**: the task text with acceptance criteria, `CLAUDE.md`, this file, and the diff. You do not know the implementer's reasoning — judge the code as written.

Report every finding as: `path:line — severity (blocker | major | minor) — problem — suggested fix`. No praise, no style nits unless they change behaviour. If you cannot verify something from the diff, say so rather than guessing.

## 1. Acceptance criteria
For each criterion: met / not met / cannot tell, with evidence (file:line or test name).

## 2. Non-negotiables (`CLAUDE.md`)
- Ads anywhere in reader, editor, scanner or paywall screens.
- Network use outside the allow-list in `CLAUDE.md`; any file data leaving the device.
- Non-atomic writes to user files (must be temp → verify → rename, or save-as-new).
- PDF bytes or base64 crossing the JS/native bridge (paths/URIs only).
- Feature gating outside `src/lib/entitlements.ts` (inline `isPro`-style checks).
- Deceptive monetization (fake alerts, fabricated counts, hidden trial terms).
- Features that break when all-files access is denied.

## 3. Error handling
- Every relevant typed error code (`PASSWORD_REQUIRED`, `WRONG_PASSWORD`, `CORRUPT_FILE`, `UNSUPPORTED`, `NO_SPACE`, `OUT_OF_MEMORY`, `CANCELLED`, `PERMISSION_DENIED`, `NOT_FOUND`) handled with a human message and a recovery action.
- Swallowed exceptions, unhandled promise rejections, missing cancellation handling.

## 4. Resources & performance
- Documents opened without a matching `close(docId)`; bitmaps not recycled; streams/cursors not closed.
- Heavy work on the main/UI thread or JS thread instead of Kotlin background dispatchers.
- Anything that obviously threatens the budgets (cold start < 1.5s, 60fps scroll, < 250 MB reader memory).

## 5. Security & privacy
- Exported Android components that shouldn't be; overly broad FileProvider paths.
- WebView with JS enabled, file access, or network for office preview.
- Logging or analytics/Sentry events containing file paths, file names or other PII.
- Secrets or signing material committed.

## 6. Code quality rules
- `any`, TODO/stub/placeholder logic, hardcoded user-facing strings (must go through i18n), styling outside NativeWind without justification.
- Pure TS logic without Jest tests; engine ops without Kotlin tests where the task requires them.

## 7. Licensing
- New dependency not under a permissive licence (CLAUDE.md licensing rule), missing from `docs/LICENSES.md`, or its notice/credit requirement not recorded. Any GPL/LGPL/AGPL is a blocker.
