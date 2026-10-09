# On-device UI smoke tests (adb)

Small Node harness that drives the app on a real phone over adb. It finds
elements by text / accessibility label (`content-desc`) from
`adb shell uiautomator dump`, not by screen coordinates.

| File                  | What                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `ui.mjs`              | adb wrapper, dump/find, tap/type/scroll, screenshot, logcat, launch |
| `run.mjs`             | step runner: PASS/FAIL + timing, crash check, failure capture       |
| `parse.cjs`           | pure parsing helpers (XML, matching, escaping, logcat), unit tested |
| `t14-file-actions.mjs`| T1.4 scenario: file actions + My Files                              |
| `out/`                | failure screenshots (`.png`) and UI dumps (`.xml`), git-ignored      |

## Run

From the repo root, with the phone connected and unlocked, the app
installed, the library already holding files, and the phone's language set
to English:

```sh
node scripts/device/t14-file-actions.mjs
```

The scenario changes real files and cleans up after itself. If it stops
partway, it prints a "Manual cleanup needed" list. It ends with a checklist
for the parts that go through system UI (Print, Import), which you do by hand.

## Environment variables

| Var       | Default                                    | Meaning                                              |
| --------- | ------------------------------------------ | ---------------------------------------------------- |
| `DEVICE`  | `R5CW60SX9EK`                              | adb serial (`adb -s`)                                |
| `APP_ID`  | `com.ismailidris.pdfreader`                | package that must be in the foreground               |
| `DEV`     | unset                                      | `1`: dev build. Runs `adb reverse tcp:8081` and opens the dev-client URL |
| `DEV_URL` | `pdfreader://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081` | dev-client deep link |
| `FRESH`   | unset                                      | `1`: `am force-stop` before launching                |
| `FIXTURE` | `doc_20_100.pdf`                           | library PDF in shared storage to work on             |
| `RENAMED` | `smoke_t14_renamed.pdf`                    | temporary name (ASCII; its words should be unique)   |
| `FOLDER`  | `Smoke A`                                  | temporary My Files folder                            |
| `OUT_DIR` | `scripts/device/out`                       | where failure captures go                            |
| `VERBOSE` | unset                                      | `1`: print every adb command                         |

The scenario looks up files with the library search, which is FTS prefix
matching on words. The default fixture `doc_20_100.pdf` is the only file
matching "doc 20 100". A fixture like `doc_1_1.pdf` also matches
`doc_1_10.pdf` and others, and the 50-result cap could push it out of the
results.

## Guard rails

- Every tap, long-press, swipe, key event and text entry first checks
  `dumpsys window` (`mCurrentFocus`, with `mFocusedApp` as a fallback) and the
  dump's `package`. If the foreground is not `APP_ID`, the run aborts
  (`ABORT`). Text is typed only when the app has a focused `EditText`.
- A tap target in the lower half of the screen while the keyboard is up
  hides the keyboard first, so the tap cannot land on the keyboard. BACK is
  sent only while the keyboard is showing.
- After every step, logcat since the run started is checked for
  `FATAL EXCEPTION`, `Fatal signal`, `E ReactNativeJS`, `ANR in` and
  process death for the app, and the pid is checked for an app restart.
- On failure the run saves a screenshot and the UI dump to `out/`, then stops.
  Later steps depend on the earlier ones, so they do not run.

## Writing a scenario

```js
import { createRun } from './run.mjs';
import * as ui from './ui.mjs';

const run = await createRun('my scenario');
try {
  await run.step('launch', () => ui.launch({ marker: { text: 'Pdf Reader' } }));
  await run.step('open sort', async () => {
    await ui.tap({ desc: 'Sort' });
    await ui.find({ text: 'Sort by' });
    await ui.back();
  });
} catch {
  // already logged by step()
}
run.summary();
```

Queries (all given keys must match): `text`, `desc`, `label` (text or desc),
`resourceId` are exact matches. `textContains`, `descContains` and
`labelContains` match substrings. `regex` (text or desc), `textRegex` and
`descRegex` take regular expressions. `cls` matches a substring of the class.
`clickable`, `enabled` and `focused` take booleans, and `where(node)` takes a
predicate. The API includes `find`, `findAll`, `findNow`, `exists`,
`waitGone`, `tap`, `longPress`, `typeText`, `clearField`, `pressEnter`,
`keyevent`, `back`, `home`, `swipe`, `scroll`, `scrollUntil`,
`hideKeyboard`, `screenshot`, `logcatSince`, `crashesSince` and `launch`.

## Limitations

- `adb shell input text` types printable ASCII only. It cannot type non-ASCII
  (é, ü, Hausa hooked letters, emoji) or a literal `%`, and `typeText` throws
  for those. Use ASCII names in scenarios.
- Labels are the English strings from `src/i18n/locales/en.ts`, so the phone
  must be in English. If a label changes there, update the scenario's `L`
  table too.
- `uiautomator dump` takes about 1 to 2 s and can fail with "could not get
  idle state" while something animates. It is retried. A step that polls
  many times is slow, so expect several minutes for the T1.4 run.
- The dump lists only what is on screen. Use `scrollUntil` for rows further
  down a list.
- Toasts are not asserted. They are transient, and the scenario checks the
  resulting state instead.
- System UI (the print preview, the SAF picker, the share sheet) is outside
  the package guard on purpose, so those steps are manual.
- The harness never runs `adb` on import. Only running a scenario talks to
  the phone.
