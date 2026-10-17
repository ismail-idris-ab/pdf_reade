import type { NormalizedRect, PageTextRects } from '@/lib/engine';

import type { ItemSpan, PageFrame } from './layout';
import {
  normalizedRectToView,
  type ViewPoint,
  type ViewRect,
  type ViewSize,
} from './overlayGeometry';

/**
 * Text selection on one page (T2.8): pure geometry and text logic. Indices
 * are UTF-16 positions in the page text (as getTextRects returns it); a
 * selection always starts and ends on whole code points, so a surrogate pair
 * is never split.
 */

/** A page's text with one box per UTF-16 unit (getTextRects). */
export type PageText = PageTextRects;

/** How far a long press may land from a character on its line and still pick it, dp. */
export const HIT_TOLERANCE_DP = 16;

/** Scroll movement below this is noise (a settling list), dp. */
export const SCROLL_TOLERANCE_DP = 2;

/** The scroll position of the reader when a selection was made. */
export type ScrollOffsets = { main: number; cross: number };

/** Which end of a selection a handle drags. */
export type SelectionHandle = 'anchor' | 'focus';

/**
 * The selection on screen. `anchor` and `focus` are the first UTF-16 index
 * of the characters at either end (inclusive); the focus may come before the
 * anchor once the handles have crossed.
 */
export type TextSelection = {
  page: number;
  pageText: PageText;
  anchor: number;
  focus: number;
  /** The page as displayed when the selection was made, dp. */
  view: ViewSize;
  /** The page's top-left corner in the reader's page area, dp. */
  origin: ViewPoint;
  offsets: ScrollOffsets;
};

/** A half-open range [start, end) of UTF-16 indices. */
export type CharRange = { start: number; end: number };

/** A point of the page area that falls on a page. */
export type PageHit = {
  page: number;
  /** The point on the displayed page, dp from its top-left corner. */
  point: ViewPoint;
  /** The displayed page's size, dp. */
  view: ViewSize;
};

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The start of the code point that contains UTF-16 index `index`. */
export function codePointStart(text: string, index: number): number {
  if (
    index > 0 &&
    index < text.length &&
    isLowSurrogate(text.charCodeAt(index)) &&
    isHighSurrogate(text.charCodeAt(index - 1))
  ) {
    return index - 1;
  }
  return index;
}

/** The end (exclusive) of the code point that starts at `index`. */
export function codePointEnd(text: string, index: number): number {
  if (
    index + 1 < text.length &&
    isHighSurrogate(text.charCodeAt(index)) &&
    isLowSurrogate(text.charCodeAt(index + 1))
  ) {
    return index + 2;
  }
  return Math.min(text.length, index + 1);
}

const WORD_CHAR = /^[\p{L}\p{N}\p{M}]$/u;
/** Apostrophes that may sit inside a word: ASCII, right single quote, modifier letter. */
const APOSTROPHES = new Set(["'", '’', 'ʼ']);

const isWordChar = (char: string) => WORD_CHAR.test(char);

/** The code point at `index` (a start index) as a string. */
const charAt = (text: string, index: number) => text.slice(index, codePointEnd(text, index));

/**
 * The word around the character at `index`: letters (accented and Hausa
 * hooked letters included), digits and combining marks, with apostrophes
 * kept when a word character is on both sides. A character that is not part
 * of a word (punctuation) is selected on its own.
 */
export function wordRangeAt(text: string, index: number): CharRange {
  const at = codePointStart(text, index);
  const own: CharRange = { start: at, end: codePointEnd(text, at) };
  if (at >= text.length || !isWordChar(charAt(text, at))) return own;

  let start = at;
  while (start > 0) {
    const previous = codePointStart(text, start - 1);
    const char = charAt(text, previous);
    if (isWordChar(char)) {
      start = previous;
      continue;
    }
    if (APOSTROPHES.has(char) && previous > 0) {
      const beforeApostrophe = codePointStart(text, previous - 1);
      if (isWordChar(charAt(text, beforeApostrophe))) {
        start = beforeApostrophe;
        continue;
      }
    }
    break;
  }

  let end = own.end;
  while (end < text.length) {
    const char = charAt(text, end);
    if (isWordChar(char)) {
      end = codePointEnd(text, end);
      continue;
    }
    if (APOSTROPHES.has(char)) {
      const afterApostrophe = codePointEnd(text, end);
      if (afterApostrophe < text.length && isWordChar(charAt(text, afterApostrophe))) {
        end = codePointEnd(text, afterApostrophe);
        continue;
      }
    }
    break;
  }
  return { start, end };
}

/** Box of the UTF-16 unit at `index`, or null for a character without one. */
export function charBox(page: PageText, index: number): NormalizedRect | null {
  const offset = index * 4;
  const width = page.boxes[offset + 2] ?? 0;
  const height = page.boxes[offset + 3] ?? 0;
  if (width <= 0 && height <= 0) return null;
  return { x: page.boxes[offset] ?? 0, y: page.boxes[offset + 1] ?? 0, width, height };
}

/** Whitespace by code unit, without a regex (this runs per character in hot loops). */
function isSpaceCode(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** A visible character with a box: what selection can land on. */
function isTarget(page: PageText, index: number): boolean {
  return !isSpaceCode(page.text.charCodeAt(index)) && charBox(page, index) !== null;
}

/** Whether the page has any selectable text (false for image-only pages). */
export function hasSelectableText(page: PageText): boolean {
  for (let index = 0; index < page.text.length; index = codePointEnd(page.text, index)) {
    if (isTarget(page, index)) return true;
  }
  return false;
}

/** The first and last selectable characters of the page (select all), or null. */
export function wholePageRange(page: PageText): { anchor: number; focus: number } | null {
  let first = -1;
  let last = -1;
  for (let index = 0; index < page.text.length; index = codePointEnd(page.text, index)) {
    if (!isTarget(page, index)) continue;
    if (first < 0) first = index;
    last = index;
  }
  return first < 0 ? null : { anchor: first, focus: last };
}

/**
 * Every character's box as displayed (the page's /Rotate applied), dp at
 * the view size, flat [x, y, width, height]; NaN x for characters that are
 * not selection targets (no box, or whitespace). Line and hit logic runs in
 * this space, so text that reads level on screen is level here whatever the
 * page's rotation. Cached per page text for the last two view sizes (the
 * page as shown, and the fixed size the text logic uses): a dragged handle
 * reuses it on every move.
 */
type DisplayedBoxes = { width: number; height: number; boxes: Float64Array };
const displayedCache = new WeakMap<PageText, DisplayedBoxes[]>();

function displayedBoxes(page: PageText, view: ViewSize): Float64Array {
  const entries = displayedCache.get(page) ?? [];
  const cached = entries.find(
    (entry) => entry.width === view.width && entry.height === view.height,
  );
  if (cached) return cached.boxes;
  const boxes = new Float64Array(page.text.length * 4).fill(Number.NaN);
  for (let index = 0; index < page.text.length; index += 1) {
    if (!isTarget(page, index)) continue;
    const box = charBox(page, index);
    if (!box) continue;
    const shown = normalizedRectToView(box, page.rotation, view);
    boxes[index * 4] = shown.x;
    boxes[index * 4 + 1] = shown.y;
    boxes[index * 4 + 2] = shown.width;
    boxes[index * 4 + 3] = shown.height;
  }
  displayedCache.set(page, [
    ...entries.slice(-1),
    { width: view.width, height: view.height, boxes },
  ]);
  return boxes;
}

/** Character `index`'s displayed box, or null when it is not a target. */
function displayedBox(boxes: Float64Array, index: number): ViewRect | null {
  const x = boxes[index * 4] ?? Number.NaN;
  if (Number.isNaN(x)) return null;
  return {
    x,
    y: boxes[index * 4 + 1] ?? 0,
    width: boxes[index * 4 + 2] ?? 0,
    height: boxes[index * 4 + 3] ?? 0,
  };
}

/** Distance outside a span (0 inside it). */
const outside = (value: number, start: number, length: number) =>
  value < start ? start - value : value > start + length ? value - (start + length) : 0;

/**
 * The character a long press at `point` (dp on the displayed page) lands
 * on: the one under it, else the nearest on the same line (level with the
 * press on screen) within `toleranceDp`. Spaces are never picked. Null on a
 * blank area.
 */
export function hitTestChar(
  page: PageText,
  point: ViewPoint,
  view: ViewSize,
  toleranceDp = HIT_TOLERANCE_DP,
): number | null {
  const boxes = displayedBoxes(page, view);
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let index = 0; index < page.text.length; index += 1) {
    const x = boxes[index * 4] ?? Number.NaN;
    if (Number.isNaN(x)) continue;
    const dx = outside(point.x, x, boxes[index * 4 + 2] ?? 0);
    const dy = outside(point.y, boxes[index * 4 + 1] ?? 0, boxes[index * 4 + 3] ?? 0);
    if (dx === 0 && dy === 0) return codePointStart(page.text, index);
    // Same line: the press is level with the character on screen (a little
    // slack for a finger between two lines' boxes).
    if (dy > toleranceDp / 2 || dx > toleranceDp) continue;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best === null ? null : codePointStart(page.text, best);
}

/**
 * The character nearest to `point` (dp on the displayed page) anywhere on
 * the page (a dragged handle): vertical distance on screen counts double, so
 * the line under the finger wins over a closer character on the next line.
 * Null when the page has no text.
 */
export function nearestChar(page: PageText, point: ViewPoint, view: ViewSize): number | null {
  const boxes = displayedBoxes(page, view);
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let index = 0; index < page.text.length; index += 1) {
    const x = boxes[index * 4] ?? Number.NaN;
    if (Number.isNaN(x)) continue;
    const dx = outside(point.x, x, boxes[index * 4 + 2] ?? 0);
    const dy = outside(point.y, boxes[index * 4 + 1] ?? 0, boxes[index * 4 + 3] ?? 0) * 2;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best === null ? null : codePointStart(page.text, best);
}

/** The selection's characters, in reading order: [start, end). */
export function selectionRange(selection: Pick<TextSelection, 'pageText' | 'anchor' | 'focus'>) {
  const first = Math.min(selection.anchor, selection.focus);
  const last = Math.max(selection.anchor, selection.focus);
  return { start: first, end: codePointEnd(selection.pageText.text, last) };
}

/** A new selection for a word under a long press, or null on a blank area. */
export function selectWordAt(
  page: PageText,
  point: ViewPoint,
  view: ViewSize,
): { anchor: number; focus: number } | null {
  const index = hitTestChar(page, point, view);
  if (index === null) return null;
  const word = wordRangeAt(page.text, index);
  return { anchor: word.start, focus: codePointStart(page.text, word.end - 1) };
}

/**
 * Moves one handle of the selection to the character nearest `point` (dp
 * on the displayed page). The handles may cross: the selection then runs the
 * other way, still in reading order. The same object when nothing changed.
 */
export function dragHandle(
  selection: TextSelection,
  handle: SelectionHandle,
  point: ViewPoint,
): TextSelection {
  const index = nearestChar(selection.pageText, point, selection.view);
  if (index === null || index === selection[handle]) return selection;
  return { ...selection, [handle]: index };
}

/**
 * Whether displayed box `box` is on another line than `previous`: less than
 * half the smaller height in common vertically, on screen. Direction-agnostic,
 * so text running right-to-left (or a page turned 180°) stays one line.
 */
function startsNewLine(previous: ViewRect, box: ViewRect): boolean {
  const overlap =
    Math.min(previous.y + previous.height, box.y + box.height) - Math.max(previous.y, box.y);
  return overlap < Math.min(previous.height, box.height) / 2;
}

const isLineBreak = (code: number) => code === 0x0a || code === 0x0d;

const union = (a: ViewRect, b: ViewRect): ViewRect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

/**
 * One rect per line of `range` on the displayed page (dp at `view`): the
 * union of the consecutive character boxes on that line. Characters without
 * a box (generated spaces) are skipped; a line break in the text or a change
 * of line on screen starts a new rect.
 */
export function lineRects(page: PageText, range: CharRange, view: ViewSize): ViewRect[] {
  const boxes = displayedBoxes(page, view);
  const lines: ViewRect[] = [];
  let current: ViewRect | null = null;
  let previous: ViewRect | null = null;
  let broke = false;
  for (let index = range.start; index < range.end; index = codePointEnd(page.text, index)) {
    if (isLineBreak(page.text.charCodeAt(index))) {
      broke = true;
      continue;
    }
    const box = displayedBox(boxes, index);
    if (!box) continue;
    if (current === null || previous === null || broke || startsNewLine(previous, box)) {
      if (current) lines.push(current);
      current = box;
    } else {
      current = union(current, box);
    }
    previous = box;
    broke = false;
  }
  if (current) lines.push(current);
  return lines;
}

/** Text logic only compares positions on screen, so any fixed view size works. */
const TEXT_VIEW: ViewSize = { width: 1000, height: 1000 };

/**
 * The selected text as it should be copied: the page's characters in
 * reading order, with a line break wherever the selection moves to another
 * line (the engine's \r\n or a change of line on screen), runs of spaces
 * collapsed to one, and no spaces around line breaks.
 */
export function selectedText(page: PageText, range: CharRange): string {
  const boxes = displayedBoxes(page, TEXT_VIEW);
  let out = '';
  let previous: ViewRect | null = null;
  let spaceSince = false;
  for (let index = range.start; index < range.end; index = codePointEnd(page.text, index)) {
    const code = page.text.charCodeAt(index);
    if (isLineBreak(code)) {
      // "\r\n" is one break.
      if (!(code === 0x0a && index > 0 && page.text[index - 1] === '\r')) out += '\n';
      spaceSince = true;
      continue;
    }
    if (isSpaceCode(code)) {
      out += ' ';
      spaceSince = true;
      continue;
    }
    const box = displayedBox(boxes, index);
    if (box && previous && !spaceSince && startsNewLine(previous, box)) out += '\n';
    if (box) previous = box;
    out += charAt(page.text, index);
    spaceSince = false;
  }
  return out
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Number of characters (code points) in a string, for the announcement. */
export function characterCount(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index = codePointEnd(text, index)) count += 1;
  return count;
}

/** The selection's line rects on the displayed page, dp. */
export function selectionViewRects(selection: TextSelection): ViewRect[] {
  return lineRects(selection.pageText, selectionRange(selection), selection.view);
}

/** The smallest rect holding all of `rects`; null when empty. */
export function boundsOf(rects: readonly ViewRect[]): ViewRect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Where a handle sits: the bottom corner of its character, and that character's centre. */
export type HandleGeometry = {
  /** The tip of the handle on the displayed page, dp. */
  tip: ViewPoint;
  /** The centre of the handle's character on the displayed page, dp. */
  centre: ViewPoint;
  /** Whether this handle is the start (true) or the end of the selection now. */
  isStart: boolean;
};

/**
 * The geometry of one handle, on screen: at the bottom-left of the first
 * character when it is the start, at the bottom-right of the last one when
 * it is the end.
 */
export function handleGeometry(
  selection: TextSelection,
  handle: SelectionHandle,
): HandleGeometry | null {
  const index = selection[handle];
  const other = handle === 'anchor' ? selection.focus : selection.anchor;
  const isStart = index < other || (index === other && handle === 'anchor');
  const box = displayedBox(displayedBoxes(selection.pageText, selection.view), index);
  if (!box) return null;
  return {
    tip: { x: isStart ? box.x : box.x + box.width, y: box.y + box.height },
    centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    isStart,
  };
}

/**
 * The point under (`main`, `cross`) of the list's content (item space along
 * the scroll axis, content space across it) as a point on a page, or null
 * when it falls between pages or in a page's margin.
 */
export function pageHitAt(
  spans: readonly ItemSpan[],
  frameOf: (page: number) => PageFrame | undefined,
  main: number,
  cross: number,
  horizontal: boolean,
): PageHit | null {
  const span = spans.find((item) => main >= item.start && main < item.start + item.length);
  if (!span) return null;
  const frame = frameOf(span.index);
  if (!frame) return null;
  const within = main - span.start;
  const x = (horizontal ? within : cross) - frame.left;
  const y = (horizontal ? cross : within) - frame.top;
  if (x < 0 || y < 0 || x > frame.pageWidth || y > frame.pageHeight) return null;
  return {
    page: span.index,
    point: { x, y },
    view: { width: frame.pageWidth, height: frame.pageHeight },
  };
}

/** A long press on a page: where it landed and where the page was on screen. */
export type SelectionRequest = PageHit & {
  /** The page's top-left corner in the page area, dp. */
  origin: ViewPoint;
  offsets: ScrollOffsets;
};

/** Whether the reader has scrolled away from where a selection was made. */
export function hasScrolledAway(from: ScrollOffsets, to: ScrollOffsets): boolean {
  return (
    Math.abs(from.main - to.main) > SCROLL_TOLERANCE_DP ||
    Math.abs(from.cross - to.cross) > SCROLL_TOLERANCE_DP
  );
}

export type ActionBarPlacement = {
  /** The selection's bounds in the page area, dp. */
  selection: ViewRect;
  /** The bar's own size, dp. */
  bar: ViewSize;
  /** The page area, dp. */
  area: ViewSize;
  /** The parts of the page area the chrome covers at the top and bottom, dp. */
  top: number;
  bottom: number;
  /** Room the handles take below the selection, dp. */
  handleSpace: number;
};

/** Gap between the action bar and the selection or the screen edge, dp. */
export const ACTION_BAR_GAP = 8;

/**
 * Where the action bar goes: centred above the selection, or below it (under
 * the handles) when there is no room above, kept inside the free part of the
 * page area either way.
 */
export function actionBarPosition({
  selection,
  bar,
  area,
  top,
  bottom,
  handleSpace,
}: ActionBarPlacement): ViewPoint {
  const minY = top + ACTION_BAR_GAP;
  const maxY = area.height - bottom - ACTION_BAR_GAP - bar.height;
  let y = selection.y - ACTION_BAR_GAP - bar.height;
  if (y < minY) y = selection.y + selection.height + handleSpace + ACTION_BAR_GAP;
  y = Math.max(minY, Math.min(y, maxY));
  const maxX = area.width - ACTION_BAR_GAP - bar.width;
  const x = Math.max(
    ACTION_BAR_GAP,
    Math.min(selection.x + selection.width / 2 - bar.width / 2, maxX),
  );
  return { x, y };
}

/** SVG path of the selection's line rects, dp on the displayed page. */
export function selectionPath(rects: readonly ViewRect[]): string {
  const round = (value: number) => Math.round(value * 10) / 10;
  return rects
    .map(
      (box) =>
        `M${round(box.x)} ${round(box.y)}h${round(box.width)}v${round(box.height)}h${round(-box.width)}Z`,
    )
    .join('');
}
