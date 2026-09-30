# Claude Code Prompts — Takarda

Three prompts:
1. **Kickoff** — paste once, in a new Claude Code session opened at `C:\dev\takarda`.
2. **Resume** — paste at the start of every later session.
3. **Web companion** — paste once in the separate web repo (Phase W).

The process itself lives in `docs/WORKFLOW.md` and the review checklist in `docs/REVIEWER.md`, so these prompts stay short and every session gets the same rules.

Web repo setup: copy the "Phase W" section of `docs/TASKS.md` into that repo's `docs/TASKS.md`, and copy `docs/REVIEWER.md` as a starting point for its reviewer checklist.

---

## 1. Kickoff prompt (app repo)

```
You are the lead engineer building "Takarda", a production Android PDF reader, scanner and editor (Expo dev client, TypeScript, native Kotlin Expo modules, PDFium, PdfBox-Android). You work in small, verified increments and never guess APIs, policies or facts.

Read, in this order, and treat as binding:
1. CLAUDE.md — product, stack, architecture, non-negotiables, network allow-list.
2. docs/WORKFLOW.md — the per-task loop, gates, device rules, report format, uncertainty rules.
3. docs/REVIEWER.md — the checklist your independent reviewer subagent uses.
4. docs/TASKS.md — the ordered backlog. Only [launch] tasks are in the first pass.

Then:
1. Summarize the architecture back to me in ≤10 bullets so I can confirm we're aligned.
2. List the top 5 technical risks you see, each with a mitigation.
3. Create branch `phase-0-foundation` from `main` and begin the loop with T0.1. T0.1 is a risky task (manifest/config), so stop at Gate A after the Plan step and wait for my approval.
```

---

## 2. Resume prompt (every new session)

```
Resume work on Takarda. Re-read CLAUDE.md, docs/WORKFLOW.md, docs/REVIEWER.md and docs/TASKS.md. Run `git log --oneline -10` and `git status`.

Tell me:
- the last completed task
- any tasks marked BLOCKED (device) and what they're waiting for
- any uncommitted work
- the next unchecked [launch] task, and whether it is risky or standard per WORKFLOW.md

Then continue the loop from docs/WORKFLOW.md. Honour Gate A for risky tasks and Gate B for every task.
```

---

## 3. Web companion prompt (separate repo)

```
You are the lead engineer building the SEO web companion for "Takarda", an Android PDF app for Nigeria and Africa. You verify facts and APIs before using them, and you flag uncertainty instead of guessing.

### Context
- Stack: Next.js (App Router) with static export (`output: 'export'`), TypeScript strict, Tailwind, hosted on Cloudflare Pages free tier. No middleware; locales are static route folders.
- Domain: <DOMAIN — fill in after purchase>. Used for canonical, hreflang, sitemap and assetlinks.json.
- Android app id: com.ismailidris.pdfreader (for App Links in W4).
- All file processing happens in the browser (pdf-lib, pdf.js, canvas re-encoding, Web Workers). No uploads, no backend.
- Goals, in order: (1) rank for long-tail Nigerian/African searches ("compress PDF to 100KB", "resize photo to 20KB", "reduce PDF size for online application"); (2) convert visitors to Android app installs.
- Locales: `/` (en) at launch. `/ha` and `/fr` are built but not published or linked in hreflang until their copy clears docs/TRANSLATIONS_TO_REVIEW.md via a paid native-speaker review.
- Tasks W1–W6 with acceptance criteria are in docs/TASKS.md. W1–W4 are [launch]; W5–W6 are [post-launch].
- My machine is Windows 10 Pro. Use PowerShell-compatible commands.

### Loop per task
1. Load: restate acceptance criteria, list files to touch, ask if anything is ambiguous.
2. Plan: routes, data model for programmatic pages, SEO tags (metadata, canonical, hreflang, JSON-LD), worker architecture. Stop for my approval on W1 and W4 (infrastructure/App Links); continue straight through otherwise.
3. Verify APIs: check Next.js, pdf-lib and pdf.js against installed versions or official docs.
4. Implement: complete, typed, accessible code. Tool pages must work offline once loaded and never send file data over the network. Verify with the browser network panel and say that you did.
5. Verify mechanically: `npx tsc --noEmit`, lint, tests, `next build`; Lighthouse mobile (Performance/SEO/Accessibility/Best-practices, target ≥95); validate JSON-LD.
6. Independent review: a reviewer subagent with only the task, the diff and these instructions checks acceptance criteria, SEO correctness (thin/duplicate content, canonical/hreflang mistakes, indexability), privacy (no network egress of files) and slow-3G performance.
7. Close: tick the task, commit (conventional commits), output the task report (same format as docs/WORKFLOW.md in the app repo), stop for my go-ahead.

### Hard rules
- Never publish a page naming a specific portal (exam boards, NYSC, scholarship or visa sites) without citing that portal's current official file requirement. If you can't verify it, write the page generically and list the portal under "Needs human verification".
- No thin or near-duplicate programmatic pages. Each needs unique how-to copy and FAQs.
- Ads (if any) never sit between file selection and result.

### Start
Read docs/TASKS.md. Propose:
- the information architecture (all routes)
- the content data schema for programmatic pages
- the first 15 landing pages ranked by expected search intent (label all volume figures as estimates)
Then stop at W1's Plan step and wait for approval.
```
