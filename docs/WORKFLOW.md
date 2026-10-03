# WORKFLOW — how Claude Code works in this repo

Binding. Read with `CLAUDE.md` at the start of every session. `CLAUDE.md` rules override convenience; this file defines process.

## Roles & environment

- Claude Code is the lead engineer. The owner (solo full-stack dev + PM, fluent in TS/React/React Native) reviews at the gates below. Skip beginner explanations.
- Dev machine: Windows 10 Pro. Give PowerShell-compatible commands. Repo lives at a short path (`C:\dev\takarda`) to avoid Windows path-length failures in native builds; `LongPathsEnabled` should be on.
- Builds: **local** `npx expo run:android` / Gradle for the dev loop; **EAS Build** for `preview` (APK) and `production` (AAB). Say which one each step needs.
- Test devices:
  - Primary dev phone: Android 16, 8 GB RAM — functional checks only.
  - Secondary phone: Android 13, 4 GB RAM — functional + interim performance checks.
  - **Low-end reference phone (≤ 3 GB RAM): to be purchased before Phase 2.** Until then, performance results are "unverified on low-end hardware".
  - Android emulator configured with 2 GB RAM for early memory checks.
- Git: remote `https://github.com/ismail-idris-ab/pdf_reade.git`. One branch per phase (`phase-0-foundation`, `phase-1-files`, `phase-2-reader`, …) cut from `main`; merge to `main` by PR when the phase closes and CI is green. Conventional commits (`feat(reader): …`).

## Task classes

A task is **risky** if it touches any of:
- `modules/` (Kotlin / native code / native dependencies)
- AndroidManifest, intent filters, config plugins, permissions
- ads, purchases, `entitlements.ts`, quotas
- file writes, moves or deletes on user files
- security (app lock, vault, hardening, FileProvider)

Everything else is **standard** (pure TS, UI, docs, tests).

## Per-task loop

1. **Load.** Re-read `CLAUDE.md` and the task. Restate its acceptance criteria in your own words. List files you expect to create/modify. If any criterion is ambiguous or conflicts with `CLAUDE.md`, stop and ask before writing code.

2. **Plan.** Short plan: approach, key types/interfaces, native/JS boundary, error codes involved, test plan.
   - Native work (Kotlin, PDFium, PdfBox-Android, ML Kit): state exact library versions.
   - New dependency: verify the license is permissive (see CLAUDE.md licensing rule), record it and any notice/credit requirement in `docs/LICENSES.md`. Reject GPL/LGPL/AGPL.
   - **Gate A (risky tasks only):** stop after the plan and wait for approval. Standard tasks continue straight to step 3.

3. **Verify APIs before using them.** Don't rely on memory for library APIs, Expo module APIs, Android SDK behaviour or Play policy. Read installed sources/types (`node_modules`, Gradle caches) or official docs. If something can't be verified, say so in the plan and take the most conservative approach.

4. **Implement.**
   - Complete, typed, production-quality code: no TODOs, no stubs, no `any`.
   - Handle every relevant error code from `CLAUDE.md`.
   - Heavy PDF work in Kotlin on background dispatchers, with progress events and cancellation.
   - All writes atomic.
   - All user-facing strings through i18n (en/ha/fr). Write best-effort Hausa and French and add each new key to `docs/TRANSLATIONS_TO_REVIEW.md`. Never present machine translation as final.

5. **Verify mechanically.** Run and fix until green; report the actual output summary. Never claim a pass without running it.
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npm test`
   - `./gradlew :<module>:test` (correct Gradle task) for any Kotlin change
   - a dev build (local) if native code changed

6. **Independent review.** Spawn a reviewer subagent (general-purpose) with **no access to your reasoning**. Give it only: the task text + acceptance criteria, `CLAUDE.md`, `docs/REVIEWER.md`, and the diff. Fix everything it flags, or explain in the report why a flag is wrong. Skip only for docs-only tasks.

7. **Device check.** If the task touches rendering, scanning, file access or ads: give a manual test checklist (max 8 steps) naming which device(s) to use.
   - Reader (Phase 2) and compression/target-size (T3.2, T3.5, T3.6) tasks **cannot be marked DONE** until they pass on the low-end reference phone (≤ 3 GB RAM). Until it arrives they stay `BLOCKED (device)`, and work may continue on the next task.

8. **Close — Gate B (every task).** Tick the task in `docs/TASKS.md`, commit on the phase branch, output the task report, then stop. The owner's reply carries both the device-check result (if any) and the go-ahead for the next task.

## Uncertainty & missing information

- Never invent unverifiable facts (Play Console policy details, permission declaration rules, ad adapter compatibility, Naira price points, portal file-size limits, data-protection law requirements). List them under "Needs human verification" and use a clearly named config value instead of a hardcoded guess.
- If an approach in `TASKS.md` proves infeasible (API missing, budget unreachable): stop, show the evidence, propose 1–2 alternatives with trade-offs, let the owner decide.
- Bug found in a completed task: fix in a separate commit and mention it in the report.

## Constraints

- One task per cycle. No bundled unrelated refactors.
- Performance budgets in `CLAUDE.md` are acceptance criteria.
- Never modify `CLAUDE.md`, this file, or task acceptance criteria without the owner's approval — propose changes instead. Ticking checkboxes is allowed.
- Code goes in files, not chat. Chat may be terse; **task reports, docs and commit messages are written in normal prose.**

## Task report format

```
## T<id> — <title>: DONE | BLOCKED | BLOCKED (device)
**Acceptance criteria:** each one ✅/❌ with one line of evidence
**Files changed:** list
**Verification:** commands run + result
**Reviewer findings:** list + resolution
**Device test checklist:** (if applicable, with device named)
**Needs human verification:** list, or "none"
**Deviations from plan:** list, or "none"
**Next task:** T<id> — waiting for go-ahead
```
