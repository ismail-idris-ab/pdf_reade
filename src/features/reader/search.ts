import type { NormalizedRect, PageRotation } from '@/lib/engine';
import type { AppErrorCode } from '@/lib/errors';

import { normalizedRectToView, type ViewRect, type ViewSize } from './overlayGeometry';

/** The native search stops after this many matches (done, not an error). */
export const SEARCH_MATCH_CAP = 10_000;

/** Typing pause before a search starts, ms. */
export const SEARCH_DEBOUNCE_MS = 300;

export type SearchOptionsState = { matchCase: boolean; wholeWord: boolean };

/** One page's matches: each match is one rect, or several when it wraps lines. */
export type PageMatches = {
  rects: readonly (readonly NormalizedRect[])[];
  rotation: PageRotation;
};

export type SearchResults = {
  /** Matches per page; a page without matches has no entry. */
  byPage: Readonly<Record<number, PageMatches>>;
  /** Pages with matches, ascending. */
  pages: readonly number[];
  /** Matches across all pages. */
  total: number;
};

/** A match in document order: its page and its position on that page. */
export type MatchRef = { page: number; index: number };

export type SearchStatus =
  | { kind: 'idle' }
  /** A query is waiting for the typing pause (or the start) of its search. */
  | { kind: 'pending' }
  | { kind: 'searching'; pagesSearched: number; pageCount: number }
  | { kind: 'done' }
  | { kind: 'error'; code: AppErrorCode };

export const EMPTY_RESULTS: SearchResults = { byPage: {}, pages: [], total: 0 };

/** Index of the first entry of the ascending `pages` that is >= `page`. */
function lowerBound(pages: readonly number[], page: number): number {
  let low = 0;
  let high = pages.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((pages[mid] ?? 0) < page) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The results with one more page of matches. The engine streams pages in
 * order, but an out-of-order or repeated page is still placed correctly
 * (a repeated page replaces its earlier matches). Pages with no matches are
 * ignored. Untouched pages keep their objects, so their cells do not re-render.
 */
export function addPageMatches(
  results: SearchResults,
  page: number,
  matches: readonly (readonly NormalizedRect[])[],
  rotation: PageRotation,
): SearchResults {
  if (matches.length === 0) return results;
  const previous = results.byPage[page];
  const byPage = { ...results.byPage, [page]: { rects: matches, rotation } };
  let pages = results.pages;
  if (!previous) {
    const at = lowerBound(pages, page);
    pages = [...pages.slice(0, at), page, ...pages.slice(at)];
  }
  const total = results.total - (previous?.rects.length ?? 0) + matches.length;
  return { byPage, pages, total };
}

function countOn(results: SearchResults, page: number | undefined): number {
  return page === undefined ? 0 : (results.byPage[page]?.rects.length ?? 0);
}

function firstOn(page: number | undefined): MatchRef | null {
  return page === undefined ? null : { page, index: 0 };
}

function lastOn(results: SearchResults, page: number | undefined): MatchRef | null {
  if (page === undefined) return null;
  return { page, index: countOn(results, page) - 1 };
}

/** Whether `ref` still names a match in `results`. */
export function isValidMatch(results: SearchResults, ref: MatchRef | null): ref is MatchRef {
  return ref !== null && ref.index >= 0 && ref.index < countOn(results, ref.page);
}

/**
 * The match after `current` in document order (page, then order on the
 * page), wrapping from the last match to the first. With nothing selected it
 * is the first match on or after `fromPage` (the page being read), wrapping
 * to the first match. Null when there are no matches. While the search is
 * still running (`complete` false) it never wraps: a later page may still
 * bring the next match, so it is null until one does.
 */
export function nextMatch(
  results: SearchResults,
  current: MatchRef | null,
  fromPage: number,
  complete = true,
): MatchRef | null {
  const { pages } = results;
  if (pages.length === 0) return null;
  const wrap = complete ? pages[0] : undefined;
  if (!isValidMatch(results, current)) {
    return firstOn(pages[lowerBound(pages, fromPage)] ?? wrap);
  }
  if (current.index + 1 < countOn(results, current.page)) {
    return { page: current.page, index: current.index + 1 };
  }
  return firstOn(pages[lowerBound(pages, current.page + 1)] ?? wrap);
}

/**
 * The match before `current` in document order, wrapping from the first
 * match to the last. With nothing selected it is the last match on or
 * before `fromPage`, wrapping to the last match. Null when there are none,
 * and instead of wrapping while the search is still running (the last match
 * is not known yet).
 */
export function previousMatch(
  results: SearchResults,
  current: MatchRef | null,
  fromPage: number,
  complete = true,
): MatchRef | null {
  const { pages } = results;
  if (pages.length === 0) return null;
  const last = complete ? pages[pages.length - 1] : undefined;
  if (!isValidMatch(results, current)) {
    return lastOn(results, pages[lowerBound(pages, fromPage + 1) - 1] ?? last);
  }
  if (current.index > 0) return { page: current.page, index: current.index - 1 };
  return lastOn(results, pages[lowerBound(pages, current.page) - 1] ?? last);
}

/** 1-based position of `ref` among all matches in document order. */
export function matchOrdinal(results: SearchResults, ref: MatchRef): number {
  let before = 0;
  const end = lowerBound(results.pages, ref.page);
  for (let i = 0; i < end; i += 1) before += countOn(results, results.pages[i]);
  return before + ref.index + 1;
}

/** Whether the engine may have stopped at its match cap ("10,000+"). */
export function isCapped(total: number): boolean {
  return total >= SEARCH_MATCH_CAP;
}

/** What the search status line says, before translation. */
export type SearchHeadline =
  | { kind: 'searching' }
  | { kind: 'noResults' }
  | { kind: 'results'; total: number; capped: boolean }
  | { kind: 'position'; ordinal: number; total: number; capped: boolean }
  | { kind: 'error'; code: AppErrorCode };

export type SearchSummary = {
  /** Main line; null when there is nothing to say (no query). */
  headline: SearchHeadline | null;
  /** Pages searched so far, while the search runs. */
  progress: { pagesSearched: number; pageCount: number } | null;
};

/** The status line for a search state. */
export function summarizeSearch(
  status: SearchStatus,
  results: SearchResults,
  current: MatchRef | null,
): SearchSummary {
  const progress =
    status.kind === 'searching'
      ? { pagesSearched: status.pagesSearched, pageCount: status.pageCount }
      : null;
  const capped = isCapped(results.total);
  switch (status.kind) {
    case 'idle':
      return { headline: null, progress: null };
    case 'error':
      return { headline: { kind: 'error', code: status.code }, progress: null };
    case 'pending':
    case 'searching':
    case 'done':
      break;
  }
  if (isValidMatch(results, current)) {
    return {
      headline: {
        kind: 'position',
        ordinal: matchOrdinal(results, current),
        total: results.total,
        capped,
      },
      progress,
    };
  }
  if (results.total > 0) {
    return { headline: { kind: 'results', total: results.total, capped }, progress };
  }
  if (status.kind === 'done') return { headline: { kind: 'noResults' }, progress: null };
  return { headline: { kind: 'searching' }, progress };
}

/** Bounding box of one match (all its rects) on the displayed page, dp. */
export function matchBounds(
  rects: readonly NormalizedRect[],
  rotation: PageRotation,
  view: ViewSize,
): ViewRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    const box = normalizedRectToView(rect, rotation, view);
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  if (!Number.isFinite(left)) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Where, on screen, a match lands when it is not already in view: a third of the way in. */
const REVEAL_FRACTION = 1 / 3;

/**
 * How far past the start of its cell the list should scroll so a match is in
 * view along the list's axis. `matchStart` / `matchLength` are along that
 * axis in cell coordinates; `available` is the visible length of the list
 * below the chrome. 0 (the page's own start) when the match is already in
 * view there; otherwise the match is placed a third of the way down.
 */
export function revealWithinCell(
  matchStart: number,
  matchLength: number,
  available: number,
): number {
  if (available <= 0) return 0;
  if (matchStart >= 0 && matchStart + matchLength <= available) return 0;
  return Math.max(0, matchStart - available * REVEAL_FRACTION);
}

/** Whether a span lies wholly inside a window (all along one axis). */
export function isSpanVisible(
  start: number,
  length: number,
  windowStart: number,
  windowEnd: number,
): boolean {
  return start >= windowStart && start + length <= windowEnd;
}

/** Parts of the viewport covered by the reader chrome, at its start and end, dp. */
export type ViewportInsets = { start: number; end: number };

const NO_INSETS: ViewportInsets = { start: 0, end: 0 };

/**
 * The sideways (cross-axis) scroll offset that brings a match into view on a
 * zoomed page: unchanged when it already is, else centred on it, clamped to
 * the scrollable range. matchStart / matchLength are in content coordinates
 * (the cell spans the whole cross axis). `insets` are the parts of the
 * viewport the chrome covers (paged mode: the top bar and search tools at
 * the start, the page indicator and thumbnails at the end); the match must
 * land between them.
 */
export function revealCrossOffset(
  matchStart: number,
  matchLength: number,
  viewportLength: number,
  contentLength: number,
  currentOffset: number,
  insets: ViewportInsets = NO_INSETS,
): number {
  const maxOffset = Math.max(0, contentLength - viewportLength);
  const visibleStart = currentOffset + insets.start;
  const visibleEnd = currentOffset + viewportLength - insets.end;
  if (isSpanVisible(matchStart, matchLength, visibleStart, visibleEnd)) {
    return Math.min(maxOffset, Math.max(0, currentOffset));
  }
  const visibleLength = Math.max(0, viewportLength - insets.start - insets.end);
  const centred = matchStart + matchLength / 2 - insets.start - visibleLength / 2;
  return Math.min(maxOffset, Math.max(0, centred));
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * One SVG path covering the given matches (each rect a closed box), in dp on
 * the displayed page. A whole page of highlights is one native view.
 */
export function highlightPath(
  matches: readonly (readonly NormalizedRect[])[],
  rotation: PageRotation,
  view: ViewSize,
): string {
  const parts: string[] = [];
  for (const match of matches) {
    for (const rect of match) {
      const box = normalizedRectToView(rect, rotation, view);
      parts.push(
        `M${round1(box.x)} ${round1(box.y)}h${round1(box.width)}v${round1(box.height)}h${round1(-box.width)}Z`,
      );
    }
  }
  return parts.join('');
}
