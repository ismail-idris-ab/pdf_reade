// Step runner for device scenarios: PASS/FAIL per step with timing, a crash
// check after every step, and a screenshot + UI dump on failure.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  APP,
  OUT_DIR,
  SERIAL,
  appPid,
  crashesSince,
  deviceTime,
  dump,
  getLastDump,
  GuardError,
  screenshot,
} from './ui.mjs';

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export async function createRun(name) {
  const results = [];
  const started = Date.now();
  const marker = await deviceTime();
  const pids = new Set();
  const runId = `${stamp()}-${slug(name)}`;
  console.log(`\n== ${name}  (device ${SERIAL}, app ${APP}, logcat since ${marker})\n`);

  async function rememberPid() {
    const pid = await appPid();
    if (pid !== null) pids.add(pid);
    return pid;
  }

  async function captureFailure(title) {
    const base = path.join(OUT_DIR, `${runId}-${slug(title)}`);
    mkdirSync(OUT_DIR, { recursive: true });
    try {
      await screenshot(`${base}.png`);
      console.log(`       screenshot: ${base}.png`);
    } catch (error) {
      console.log(`       (screenshot failed: ${error.message})`);
    }
    try {
      const d = await dump({ retries: 2 }).catch(() => getLastDump());
      if (d) {
        writeFileSync(`${base}.xml`, d.xml);
        console.log(`       ui dump:    ${base}.xml`);
      }
    } catch (error) {
      console.log(`       (dump failed: ${error.message})`);
    }
  }

  /** Crash lines since the run started; also flags a changed app pid. */
  async function crashCheck() {
    const before = [...pids];
    const pid = await rememberPid();
    const lines = await crashesSince(marker, [...pids]);
    const problems = lines.map((l) => `${l.kind}: ${l.raw}`);
    if (pid === null) problems.push('app process is not running');
    else if (before.length > 0 && !before.includes(pid)) {
      problems.push(`app restarted (pid ${before.join(',')} -> ${pid})`);
    }
    return problems;
  }

  /** Runs one step; a failure (or crash) is logged and rethrown, stopping the run. */
  async function step(title, fn, { checkCrash = true } = {}) {
    const t0 = Date.now();
    try {
      const value = await fn();
      if (checkCrash) {
        const problems = await crashCheck();
        if (problems.length > 0)
          throw new Error(`crash detected:\n         ${problems.join('\n         ')}`);
      }
      const ms = Date.now() - t0;
      results.push({ title, ok: true, ms });
      console.log(`PASS  ${title}  (${ms} ms)`);
      return value;
    } catch (error) {
      const ms = Date.now() - t0;
      results.push({ title, ok: false, ms, error });
      const tag = error instanceof GuardError ? 'ABORT' : 'FAIL ';
      console.log(`${tag} ${title}  (${ms} ms)\n       ${error.message}`);
      await captureFailure(title);
      error.stepLogged = true;
      throw error;
    }
  }

  function summary() {
    const failed = results.filter((r) => !r.ok);
    const total = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `\n== ${failed.length === 0 ? 'ALL PASSED' : 'FAILED'}: ` +
        `${results.length - failed.length}/${results.length} steps passed in ${total} s`,
    );
    if (failed.length > 0) process.exitCode = 1;
    return failed.length === 0;
  }

  return { step, summary, crashCheck, rememberPid, marker, results };
}
