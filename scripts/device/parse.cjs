// Pure helpers for the adb UI harness (scripts/device/ui.mjs): parsing
// `uiautomator dump` XML, matching nodes, escaping `input text`, and spotting
// crashes in logcat. No device access here, so Jest can test it directly.
//
// CommonJS on purpose: Jest (jest-expo) loads .cjs without a transform, and
// Node ESM can import it without the "typeless package" warning a .js ESM
// file would print in this repo.
'use strict';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes XML entities (&amp; &#10; &#x1F600; ...). Unknown entities are kept as-is. */
function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

/** "[x1,y1][x2,y2]" -> { x1, y1, x2, y2 }, or null when malformed. */
function parseBounds(value) {
  const m = /^\s*\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]\s*$/.exec(value || '');
  if (!m) return null;
  return { x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]) };
}

/** Integer centre of a bounds box. */
function centerOf(bounds) {
  return {
    x: Math.round((bounds.x1 + bounds.x2) / 2),
    y: Math.round((bounds.y1 + bounds.y2) / 2),
  };
}

/** Reads the attributes of one tag starting right after its name; stops at `>` or `/>`. */
function readAttributes(xml, start) {
  const attrs = {};
  const attrRe = /\s*([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;
  let i = start;
  for (;;) {
    attrRe.lastIndex = i;
    const m = attrRe.exec(xml);
    if (!m) break;
    attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
    i = attrRe.lastIndex;
  }
  // Skip to the end of the tag (tolerates junk between attributes).
  while (i < xml.length && xml[i] !== '>') i += 1;
  const selfClosing = xml[i - 1] === '/';
  return { attrs, end: i + 1, selfClosing };
}

const bool = (value) => value === 'true';

/**
 * Parses `uiautomator dump` output into a flat list of nodes in document
 * order. Each node: { index, depth, parent, text, desc, resourceId, cls, pkg,
 * clickable, longClickable, enabled, focused, focusable, scrollable,
 * selected, checked, bounds, center }. Tolerant: text before `<?xml`,
 * missing attributes and unknown tags are fine; nodes without parsable
 * bounds get zero bounds.
 */
function parseDump(xml) {
  const text = String(xml || '');
  const nodes = [];
  const stack = [];
  let rotation = 0;
  const tagRe = /<(\/?)(node|hierarchy)\b/g;
  let m;
  while ((m = tagRe.exec(text)) !== null) {
    const closing = m[1] === '/';
    const name = m[2];
    if (closing) {
      if (name === 'node') stack.pop();
      continue;
    }
    const { attrs, end, selfClosing } = readAttributes(text, tagRe.lastIndex);
    tagRe.lastIndex = end;
    if (name === 'hierarchy') {
      rotation = Number(attrs.rotation || 0) || 0;
      continue;
    }
    const bounds = parseBounds(attrs.bounds) || { x1: 0, y1: 0, x2: 0, y2: 0 };
    const node = {
      index: nodes.length,
      depth: stack.length,
      parent: stack.length > 0 ? stack[stack.length - 1] : -1,
      text: attrs.text || '',
      desc: attrs['content-desc'] || '',
      resourceId: attrs['resource-id'] || '',
      cls: attrs.class || '',
      pkg: attrs.package || '',
      clickable: bool(attrs.clickable),
      longClickable: bool(attrs['long-clickable']),
      enabled: attrs.enabled === undefined ? true : bool(attrs.enabled),
      focused: bool(attrs.focused),
      focusable: bool(attrs.focusable),
      scrollable: bool(attrs.scrollable),
      selected: bool(attrs.selected),
      checked: bool(attrs.checked),
      bounds,
      center: centerOf(bounds),
    };
    nodes.push(node);
    if (!selfClosing) stack.push(node.index);
  }
  return { nodes, rotation };
}

const toRegExp = (value) => (value instanceof RegExp ? value : new RegExp(value));

/**
 * Whether a node matches a query. Every given key must match:
 *   text / desc / label (text or desc) / resourceId : exact
 *   textContains / descContains / labelContains      : substring
 *   regex (text or desc) / textRegex / descRegex      : RegExp or pattern string
 *   cls : substring of the class name ("EditText")
 *   clickable / enabled / focused : booleans
 *   where : (node) => boolean
 */
function matches(node, query) {
  const q = query || {};
  if (q.text !== undefined && node.text !== q.text) return false;
  if (q.desc !== undefined && node.desc !== q.desc) return false;
  if (q.label !== undefined && node.text !== q.label && node.desc !== q.label) return false;
  if (q.resourceId !== undefined && node.resourceId !== q.resourceId) return false;
  if (q.textContains !== undefined && !node.text.includes(q.textContains)) return false;
  if (q.descContains !== undefined && !node.desc.includes(q.descContains)) return false;
  if (
    q.labelContains !== undefined &&
    !node.text.includes(q.labelContains) &&
    !node.desc.includes(q.labelContains)
  )
    return false;
  if (q.regex !== undefined) {
    const re = toRegExp(q.regex);
    if (!re.test(node.text) && !re.test(node.desc)) return false;
  }
  if (q.textRegex !== undefined && !toRegExp(q.textRegex).test(node.text)) return false;
  if (q.descRegex !== undefined && !toRegExp(q.descRegex).test(node.desc)) return false;
  if (q.cls !== undefined && !node.cls.includes(q.cls)) return false;
  if (q.clickable !== undefined && node.clickable !== q.clickable) return false;
  if (q.enabled !== undefined && node.enabled !== q.enabled) return false;
  if (q.focused !== undefined && node.focused !== q.focused) return false;
  if (typeof q.where === 'function' && !q.where(node)) return false;
  return true;
}

/** All nodes matching `query`, in document order. */
function findNodes(nodes, query) {
  return nodes.filter((node) => matches(node, query));
}

/** Short human description of a query for logs and errors. */
function describeQuery(query) {
  const parts = [];
  for (const [key, value] of Object.entries(query || {})) {
    if (typeof value === 'function') parts.push(`${key}=<fn>`);
    else if (value instanceof RegExp) parts.push(`${key}=${value}`);
    else parts.push(`${key}=${JSON.stringify(value)}`);
  }
  return `{${parts.join(', ')}}`;
}

/** Escapes a string for `adb shell input text` (the device shell sees it). */
function escapeInputText(value) {
  const str = String(value);
  if (/[^\x20-\x7e]/.test(str)) {
    throw new Error(
      `input text can only type printable ASCII; got ${JSON.stringify(str)}. ` +
        'Type non-ASCII names some other way (clipboard / IME), or pick an ASCII name.',
    );
  }
  if (str.includes('%')) {
    // `input text` turns "%s" into a space and has no escape for a literal "%".
    throw new Error(`input text cannot type "%" reliably; got ${JSON.stringify(str)}`);
  }
  return str.replace(/[\\'"`$&|;<>()*?~#!{}[\]^]/g, (ch) => `\\${ch}`).replace(/ /g, '%s');
}

const LOG_LINE =
  /^(\d\d-\d\d)\s+(\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?)\s*:\s?(.*)$/;

/** Parses one `logcat -v threadtime` line, or null. */
function parseLogLine(line) {
  const m = LOG_LINE.exec(line);
  if (!m) return null;
  return {
    date: m[1],
    time: m[2],
    pid: Number(m[3]),
    tid: Number(m[4]),
    level: m[5],
    tag: m[6],
    message: m[7],
    raw: line,
  };
}

/**
 * Crash / error lines for the app in `logcat -v threadtime` text:
 * FATAL EXCEPTION, Fatal signal (native crash), E ReactNativeJS, ANR, and
 * the app's process dying. `pids` are the app's known process ids.
 */
function findCrashLines(logText, { pkg, pids = [] }) {
  const pidSet = new Set(pids.map(Number));
  const found = [];
  const lines = String(logText || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const entry = parseLogLine(lines[i]);
    if (!entry) continue;
    const ours = pidSet.has(entry.pid);
    const msg = entry.message;
    let kind = null;
    if (msg.includes('FATAL EXCEPTION')) {
      const next = lines.slice(i + 1, i + 4).join('\n');
      if (ours || next.includes(`Process: ${pkg}`)) kind = 'FATAL EXCEPTION';
    } else if (entry.tag === 'AndroidRuntime' && msg.includes(`Process: ${pkg},`)) {
      kind = 'FATAL EXCEPTION';
    } else if (msg.includes('Fatal signal') && (ours || msg.includes(pkg))) {
      kind = 'Fatal signal';
    } else if (
      entry.level === 'E' &&
      entry.tag === 'ReactNativeJS' &&
      (ours || pidSet.size === 0)
    ) {
      kind = 'E ReactNativeJS';
    } else if (msg.includes(`ANR in ${pkg}`)) {
      kind = 'ANR';
    } else if (msg.includes(`Process ${pkg} (pid`) && msg.includes('has died')) {
      kind = 'process died';
    }
    if (kind !== null && !found.some((f) => f.raw === entry.raw)) found.push({ kind, ...entry });
  }
  return found;
}

/** Extracts the package that has window focus from `dumpsys window` lines. */
function parseFocusedPackage(dumpsysText) {
  const text = String(dumpsysText || '');
  for (const key of ['mCurrentFocus', 'mFocusedApp', 'mFocusedWindow']) {
    const line = text
      .split(/\r?\n/)
      .find((l) => l.includes(`${key}=`) && !l.includes(`${key}=null`));
    if (!line) continue;
    const m = /\bu\d+\s+([A-Za-z][\w.]*)(?:\/|\}|\s)/.exec(line);
    if (m) return m[1];
  }
  return null;
}

module.exports = {
  decodeEntities,
  parseBounds,
  centerOf,
  parseDump,
  matches,
  findNodes,
  describeQuery,
  escapeInputText,
  parseLogLine,
  findCrashLines,
  parseFocusedPackage,
};
