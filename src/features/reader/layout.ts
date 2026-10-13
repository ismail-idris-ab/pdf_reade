import type { ReadingMode } from '@/db/schema';
import type { PageInfo } from '@/lib/engine';
import type { ThemeName } from '@/theme';

/** Space above each page in continuous (vertical) mode, dp. */
export const PAGE_GAP = 8;

/** Margin around a page in paged (horizontal) mode, dp. */
export const PAGED_MARGIN = 8;

export type Viewport = { width: number; height: number };

/** Where one page sits inside its list cell, dp. */
export type PageFrame = {
  /** Cell size along both axes (what FlashList measures). */
  cellWidth: number;
  cellHeight: number;
  /** The page itself, at its displayed aspect ratio. */
  pageWidth: number;
  pageHeight: number;
  /** Offset of the page inside the cell. */
  left: number;
  top: number;
};

/**
 * Frame of one page for a reading mode.
 * - vertical: the page spans the viewport width (height from its displayed
 *   aspect ratio), with PAGE_GAP above it.
 * - horizontal: one page per screen; the cell is the whole viewport (so
 *   paging snaps exactly) and the page is fitted inside it, centred.
 * `insets` keeps a paged page clear of the system bars.
 */
export function pageFrame(
  info: PageInfo,
  mode: ReadingMode,
  viewport: Viewport,
  insets: { top: number; bottom: number } = { top: 0, bottom: 0 },
): PageFrame {
  const aspect = info.width > 0 && info.height > 0 ? info.height / info.width : Math.SQRT2;
  if (mode === 'vertical') {
    const pageWidth = viewport.width;
    const pageHeight = pageWidth * aspect;
    return {
      cellWidth: viewport.width,
      cellHeight: pageHeight + PAGE_GAP,
      pageWidth,
      pageHeight,
      left: 0,
      top: PAGE_GAP,
    };
  }
  const boxWidth = Math.max(0, viewport.width - PAGED_MARGIN * 2);
  const boxHeight = Math.max(0, viewport.height - insets.top - insets.bottom - PAGED_MARGIN * 2);
  const pageWidth = Math.min(boxWidth, boxHeight / aspect);
  const pageHeight = pageWidth * aspect;
  return {
    cellWidth: viewport.width,
    cellHeight: viewport.height,
    pageWidth,
    pageHeight,
    left: (viewport.width - pageWidth) / 2,
    top: insets.top + PAGED_MARGIN + (boxHeight - pageHeight) / 2,
  };
}

/** One laid-out list item along the scroll axis. */
export type ItemSpan = { index: number; start: number; length: number };

/**
 * The page that covers most of the viewport [viewStart, viewStart + viewLength)
 * along the scroll axis; ties go to the earlier page. `items` are the list's
 * own layouts of (at least) the visible items, in any order. Returns null
 * when no item overlaps the viewport.
 */
export function mostVisiblePage(
  items: readonly ItemSpan[],
  viewStart: number,
  viewLength: number,
): number | null {
  const viewEnd = viewStart + viewLength;
  let best: number | null = null;
  let bestVisible = 0;
  for (const item of items) {
    const visible = Math.min(viewEnd, item.start + item.length) - Math.max(viewStart, item.start);
    if (visible <= 0) continue;
    if (best === null || visible > bestVisible || (visible === bestVisible && item.index < best)) {
      best = item.index;
      bestVisible = visible;
    }
  }
  return best;
}

/** A 0-based page clamped into [0, pageCount − 1] (0 for an empty document). */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page) || pageCount <= 0) return 0;
  return Math.min(Math.max(0, Math.trunc(page)), pageCount - 1);
}

/**
 * Parses the jump-to-page field: a whole page number from 1 to `pageCount`,
 * surrounding spaces allowed. Returns the 0-based page, or null when invalid.
 */
export function parseJumpTarget(text: string, pageCount: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  if (number < 1 || number > pageCount) return null;
  return number - 1;
}

/**
 * How page paper is drawn for the app theme: the sepia theme reads on warm
 * paper; light and dark both read on normal white pages. Dark does not
 * invert pages: plain inversion turns photos into negatives, so night
 * inversion is an explicit reading option of its own (T2.7), never implied
 * by the app theme.
 */
export function paperModeFor(theme: ThemeName): { nightMode: boolean; sepia: boolean } {
  return { nightMode: false, sepia: theme === 'sepia' };
}

/** Only PDFs open in the reader; Office and text viewing is T2.10. */
export function isReaderSupported(file: { ext: string }): boolean {
  return file.ext.toLowerCase() === 'pdf';
}

/** What `pageAtScroll` reads from the list (a subset of FlashListRef). */
export type VisibleLayoutSource = {
  computeVisibleIndices: () => { startIndex: number; endIndex: number };
  getLayout: (index: number) => { x: number; y: number; width: number; height: number } | undefined;
  getFirstItemOffset: () => number;
};

/**
 * The most visible page for a scroll position, from the list's own item
 * layouts (which stay consistent even where FlashList only estimated sizes,
 * e.g. right after a jump). Item layouts start after the list header, while
 * scroll offsets include it. Null when no page overlaps the viewport.
 */
export function pageAtScroll(
  list: VisibleLayoutSource,
  offset: number,
  viewLength: number,
  horizontal: boolean,
): number | null {
  const { startIndex, endIndex } = list.computeVisibleIndices();
  const spans: ItemSpan[] = [];
  for (let index = Math.max(0, startIndex - 1); index <= endIndex + 1; index += 1) {
    const layout = list.getLayout(index);
    if (!layout) continue;
    spans.push({
      index,
      start: horizontal ? layout.x : layout.y,
      length: horizontal ? layout.width : layout.height,
    });
  }
  return mostVisiblePage(spans, offset - list.getFirstItemOffset(), viewLength);
}
