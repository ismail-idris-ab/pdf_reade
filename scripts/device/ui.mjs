// adb-driven UI helpers for on-device smoke tests. Elements are found by
// text / content-desc (accessibilityLabel) via `uiautomator dump`, never by
// hard-coded coordinates. See scripts/device/README.md.
//
// Guard rail: every tap, key event and text entry first checks that the app
// (APP_ID) has window focus and that the dump belongs to it, and aborts the
// run otherwise, so a test can never type into another app.
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import parse from './parse.cjs';

const { describeQuery, escapeInputText, findCrashLines, findNodes, parseDump } = parse;
const { parseFocusedPackage } = parse;

export { sleep };

export const APP = process.env.APP_ID ?? 'com.ismailidris.pdfreader';
export const SERIAL = process.env.DEVICE ?? 'R5CW60SX9EK';
export const OUT_DIR =
  process.env.OUT_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const VERBOSE = process.env.VERBOSE === '1';
const DUMP_PATH = '/sdcard/window_dump.xml';

/** The foreground app is not ours: the whole run must stop. */
export class GuardError extends Error {
  name = 'GuardError';
}
export class AdbError extends Error {
  name = 'AdbError';
}

// ---------------------------------------------------------------- adb

/**
 * Runs adb with an args array (spawned directly, no host shell, so Git
 * Bash path conversion never touches "/sdcard/..."). Resolves
 * { code, stdout: Buffer, stderr: string }.
 */
export function adbRaw(args, { timeoutMs = 20000 } = {}) {
  const fullArgs = ['-s', SERIAL, ...args.map(String)];
  if (VERBOSE) console.log(`    $ adb ${fullArgs.join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn('adb', fullArgs, {
      env: { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' },
      windowsHide: true,
    });
    const out = [];
    const err = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new AdbError(`adb ${args.join(' ')} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new AdbError(`could not run adb (is it on PATH?): ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

/** Runs adb and returns stdout as text; throws on a non-zero exit unless allowFail. */
export async function adb(args, { timeoutMs = 20000, allowFail = false } = {}) {
  const res = await adbRaw(args, { timeoutMs });
  const stdout = res.stdout.toString('utf8');
  if (res.code !== 0 && !allowFail) {
    throw new AdbError(
      `adb ${args.join(' ')} exited ${res.code}: ${(res.stderr || stdout).trim().slice(0, 500)}`,
    );
  }
  return stdout;
}

/** `adb shell <command>`: the string is interpreted by the DEVICE shell. */
export const shell = (command, opts) => adb(['shell', command], opts);

// ---------------------------------------------------------------- dump

let lastDump = null;
export const getLastDump = () => lastDump;

/** Dumps the UI hierarchy: { xml, nodes, rotation, screen: {w, h}, pkg }. */
export async function dump({ retries = 4 } = {}) {
  let lastError = '';
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const res = await adbRaw(['shell', 'uiautomator', 'dump', DUMP_PATH], { timeoutMs: 30000 });
    const said = `${res.stdout.toString('utf8')} ${res.stderr}`;
    if (!/dumped to/i.test(said)) {
      // Typically "could not get idle state" while something animates.
      lastError = said.trim();
      await sleep(400);
      continue;
    }
    const xml = (
      await adbRaw(['exec-out', 'cat', DUMP_PATH], { timeoutMs: 15000 })
    ).stdout.toString('utf8');
    const parsed = parseDump(xml);
    if (parsed.nodes.length === 0) {
      lastError = 'empty dump';
      await sleep(300);
      continue;
    }
    const root = parsed.nodes[0];
    lastDump = {
      xml,
      ...parsed,
      pkg: root.pkg,
      screen: { w: root.bounds.x2, h: root.bounds.y2 },
    };
    return lastDump;
  }
  throw new AdbError(`uiautomator dump failed after ${retries} tries: ${lastError}`);
}

// ---------------------------------------------------------------- guards

/** Package that has window focus right now (null if none could be read). */
export async function focusedPackage() {
  for (let i = 0; i < 5; i += 1) {
    const out = await shell('dumpsys window | grep -E "mCurrentFocus|mFocusedApp"', {
      allowFail: true,
    });
    const pkg = parseFocusedPackage(out);
    if (pkg !== null) return pkg;
    await sleep(300);
  }
  return null;
}

/**
 * Throws GuardError unless APP has window focus and (when given) the dump
 * is of APP's window. Called before every input event.
 */
export async function assertForeground(dumped) {
  const pkg = await focusedPackage();
  if (pkg !== APP) {
    throw new GuardError(`foreground is ${pkg ?? 'unknown'}, not ${APP}; aborting`);
  }
  if (dumped && dumped.pkg !== APP) {
    throw new GuardError(`UI dump belongs to ${dumped.pkg || 'unknown'}, not ${APP}; aborting`);
  }
}

/** Whether the soft keyboard is showing. */
export async function keyboardShown() {
  const out = await shell('dumpsys input_method | grep -E "mInputShown|InputViewShown"', {
    allowFail: true,
  });
  return /mInputShown=true|isInputViewShown=true|mIsInputViewShown=true/.test(out);
}

/** Hides the keyboard (BACK only while it is showing, so nothing else is dismissed). */
export async function hideKeyboard() {
  if (!(await keyboardShown())) return;
  await assertForeground();
  await adb(['shell', 'input', 'keyevent', '4']);
  await sleep(400);
}

export { describeQuery, escapeInputText, findCrashLines, findNodes };

// ---------------------------------------------------------------- finding

/** First node matching `query` in a fresh dump, or null. */
export async function findNow(query) {
  const d = await dump();
  return findNodes(d.nodes, query)[0] ?? null;
}

/** All nodes matching `query` in a fresh dump. */
export async function findAll(query) {
  const d = await dump();
  return findNodes(d.nodes, query);
}

/** Polls dumps until a node matches `query`; throws after timeoutMs. */
export async function find(query, { timeoutMs = 10000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const node = await findNow(query);
    if (node) return node;
    if (Date.now() > deadline) {
      throw new Error(`not found within ${timeoutMs} ms: ${describeQuery(query)}`);
    }
    await sleep(intervalMs);
  }
}

/** Whether `query` matches now (single dump). */
export async function exists(query) {
  return (await findNow(query)) !== null;
}

/** Polls until nothing matches `query`; throws after timeoutMs. */
export async function waitGone(query, { timeoutMs = 10000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await exists(query))) return;
    if (Date.now() > deadline) {
      throw new Error(`still present after ${timeoutMs} ms: ${describeQuery(query)}`);
    }
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------- input

const isQuery = (target) => target && !('center' in target);

/** Resolves a node or query to a node that is on screen and in the app. */
async function resolveTarget(target, timeoutMs) {
  let node = isQuery(target) ? await find(target, { timeoutMs }) : target;
  let d = getLastDump();
  // A target in the lower half may sit under the keyboard: hide it, re-find.
  if (d && node.center.y > d.screen.h * 0.5 && (await keyboardShown())) {
    await hideKeyboard();
    if (isQuery(target)) node = await find(target, { timeoutMs });
    d = getLastDump();
  }
  if (node.pkg && node.pkg !== APP) {
    throw new GuardError(`target belongs to ${node.pkg}, not ${APP}; aborting`);
  }
  if (
    d &&
    (node.center.x < 0 ||
      node.center.y < 0 ||
      node.center.x > d.screen.w ||
      node.center.y > d.screen.h)
  ) {
    throw new Error(`target is off screen at ${node.center.x},${node.center.y}`);
  }
  return { node, dumped: d };
}

/** Taps the centre of a node (or of the first node matching a query). */
export async function tap(target, { timeoutMs = 10000 } = {}) {
  const { node, dumped } = await resolveTarget(target, timeoutMs);
  await assertForeground(dumped);
  await adb(['shell', 'input', 'tap', node.center.x, node.center.y]);
  await sleep(350);
  return node;
}

/** Long-presses a node (a zero-length swipe held for `ms`). */
export async function longPress(target, ms = 800, { timeoutMs = 10000 } = {}) {
  const { node, dumped } = await resolveTarget(target, timeoutMs);
  await assertForeground(dumped);
  const { x, y } = node.center;
  await adb(['shell', 'input', 'swipe', x, y, x, y, ms]);
  await sleep(350);
  return node;
}

/** The app's focused text field, waiting up to timeoutMs for focus to land. */
export async function focusedField({ timeoutMs = 3000 } = {}) {
  return find({ cls: 'EditText', focused: true, where: (n) => n.pkg === APP }, { timeoutMs });
}

/**
 * Types into the focused field of the app. ASCII only: `adb shell input
 * text` cannot type non-ASCII characters (or a literal "%"); escapeInputText
 * throws for those.
 */
export async function typeText(str) {
  const escaped = escapeInputText(str);
  await focusedField();
  await assertForeground(getLastDump());
  await adb(['shell', 'input', 'text', escaped]);
  await sleep(300);
}

/** Sends key events (numbers or KEYCODE_ names) after the foreground check. */
export async function keyevent(...codes) {
  await assertForeground();
  await adb(['shell', 'input', 'keyevent', ...codes]);
  await sleep(250);
}

export const pressEnter = () => keyevent('66');

/** Clears the focused field: move to end, then delete every character. */
export async function clearField() {
  const field = await focusedField();
  const count = field.text.length + 4;
  await keyevent('123', ...Array.from({ length: count }, () => '67'));
}

/** Hardware back (guarded: it must reach our app). */
export async function back() {
  await keyevent('4');
  await sleep(300);
}

/** Home: leaves the app, so no guard. */
export async function home() {
  await adb(['shell', 'input', 'keyevent', '3']);
}

/** Raw swipe between two points. */
export async function swipe(x1, y1, x2, y2, ms = 300) {
  await assertForeground();
  await adb(['shell', 'input', 'swipe', x1, y1, x2, y2, ms]);
  await sleep(400);
}

/** One scroll gesture: 'down' reveals content further down. */
export async function scroll(direction = 'down', { area } = {}) {
  const d = getLastDump() ?? (await dump());
  const b = area ?? { x1: 0, y1: 0, x2: d.screen.w, y2: d.screen.h };
  const w = b.x2 - b.x1;
  const h = b.y2 - b.y1;
  const cx = Math.round(b.x1 + w / 2);
  const cy = Math.round(b.y1 + h / 2);
  if (direction === 'down')
    await swipe(cx, Math.round(b.y1 + h * 0.75), cx, Math.round(b.y1 + h * 0.35));
  else if (direction === 'up')
    await swipe(cx, Math.round(b.y1 + h * 0.35), cx, Math.round(b.y1 + h * 0.75));
  else if (direction === 'right')
    await swipe(Math.round(b.x1 + w * 0.8), cy, Math.round(b.x1 + w * 0.2), cy);
  else await swipe(Math.round(b.x1 + w * 0.2), cy, Math.round(b.x1 + w * 0.8), cy);
}

/**
 * Scrolls until `query` matches (checked before the first swipe). Tries
 * `direction` up to maxSwipes times, then the opposite way. Stops early
 * when a swipe changes nothing (end of list).
 */
export async function scrollUntil(query, { direction = 'down', maxSwipes = 8, area } = {}) {
  const opposite = { down: 'up', up: 'down', left: 'right', right: 'left' }[direction];
  for (const dir of [direction, opposite]) {
    let previous = null;
    for (let i = 0; i <= maxSwipes; i += 1) {
      const d = await dump();
      const node = findNodes(d.nodes, query)[0];
      if (node) return node;
      if (previous !== null && previous === d.xml) break;
      previous = d.xml;
      await scroll(dir, { area: typeof area === 'function' ? area(d) : area });
    }
  }
  throw new Error(`not found after scrolling: ${describeQuery(query)}`);
}

// ---------------------------------------------------------------- capture

/** Saves a PNG screenshot (exec-out screencap -p). */
export async function screenshot(file) {
  const res = await adbRaw(['exec-out', 'screencap', '-p'], { timeoutMs: 20000 });
  if (res.code !== 0 || res.stdout.length === 0)
    throw new AdbError(`screencap failed: ${res.stderr}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, res.stdout);
  return file;
}

/** Device clock as "MM-DD hh:mm:ss.000", usable with `logcat -T`. */
export async function deviceTime() {
  return (await shell("date '+%m-%d %H:%M:%S.000'")).trim();
}

/** Logcat (threadtime) since a deviceTime() marker. */
export async function logcatSince(marker) {
  return shell(`logcat -d -v threadtime -T '${marker}'`, { timeoutMs: 30000 });
}

/** The app's pid, or null when it is not running. */
export async function appPid() {
  const out = (await shell(`pidof ${APP}`, { allowFail: true })).trim();
  const pid = Number(out.split(/\s+/)[0]);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

/** Crash lines for the app since `marker` (see findCrashLines). */
export async function crashesSince(marker, pids) {
  return findCrashLines(await logcatSince(marker), { pkg: APP, pids });
}

// ---------------------------------------------------------------- launch

export const DEV_URL =
  process.env.DEV_URL ?? 'pdfreader://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081';

/**
 * Starts the app and waits for `marker` (a query). dev: open the
 * dev-client URL (after `adb reverse tcp:8081`) instead of MainActivity.
 * fresh: force-stop first. Returns the app pid.
 */
export async function launch({ marker, dev = false, fresh = false, timeoutMs = 60000 } = {}) {
  if (fresh) await shell(`am force-stop ${APP}`);
  if (dev) {
    await adb(['reverse', 'tcp:8081', 'tcp:8081'], { allowFail: true });
    await shell(`am start -W -a android.intent.action.VIEW -d '${DEV_URL}' ${APP}`, {
      timeoutMs: 30000,
    });
  } else {
    await shell(`am start -W -n ${APP}/.MainActivity`, { timeoutMs: 30000 });
  }
  if (marker) await find(marker, { timeoutMs });
  await assertForeground(getLastDump());
  return appPid();
}
