import { MIN_ZOOM, MAX_ZOOM, READING_MODES, type ReadingMode } from '@/db/schema';
import type { ReadingStateRow } from '@/db/types';

import { clampPage } from './layout';
import { clampZoom } from './zoom';

/** How long the page must stay put before it is saved, ms. */
export const SAVE_PAGE_DELAY_MS = 500;

export type RestoredReadingState = {
  page: number;
  mode: ReadingMode;
  /** 1×–5×. */
  zoom: number;
};

/**
 * Where to reopen a document: the stored page (clamped to the document, which
 * may have changed since), mode and zoom; page 0, vertical, 1× when nothing
 * is stored.
 */
export function restoreReadingState(
  row: ReadingStateRow | undefined,
  pageCount: number,
): RestoredReadingState {
  if (!row) return { page: 0, mode: 'vertical', zoom: MIN_ZOOM };
  const mode = (READING_MODES as readonly string[]).includes(row.mode) ? row.mode : 'vertical';
  const zoom = Number.isFinite(row.zoom)
    ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, row.zoom))
    : MIN_ZOOM;
  return { page: clampPage(row.page, pageCount), mode, zoom };
}

export type ReadingStateSaverOptions = {
  fileId: number;
  initial: RestoredReadingState;
  save: (row: ReadingStateRow) => void;
  /**
   * Called when `save` throws; saving is best-effort and never breaks
   * reading. Answer 'stop' to stop saving for good (e.g. the file's library
   * row is gone, so every later write would fail the same way).
   */
  onError: (error: unknown) => 'stop' | 'continue';
  delayMs?: number;
};

export type ReadingStateSaver = {
  /** The visible page changed; saved after it settles for `delayMs`. */
  setPage: (page: number) => void;
  /** The mode changed; saved at once (with the current page). */
  setMode: (mode: ReadingMode) => void;
  /** A zoom was committed (gesture settled); saved at once. */
  setZoom: (zoom: number) => void;
  /** Saves a pending page now (app going to the background, screen closing). */
  flush: () => void;
  /** Flushes and stops: later calls are ignored. */
  dispose: () => void;
};

/**
 * Writes a document's reading_state row: page debounced, mode and committed
 * zoom immediately. Skips writes that would store what is already stored.
 */
export function createReadingStateSaver({
  fileId,
  initial,
  save,
  onError,
  delayMs = SAVE_PAGE_DELAY_MS,
}: ReadingStateSaverOptions): ReadingStateSaver {
  const current = { page: initial.page, mode: initial.mode, zoom: initial.zoom };
  let saved: typeof current | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function cancelTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function write() {
    cancelTimer();
    if (
      saved !== null &&
      saved.page === current.page &&
      saved.mode === current.mode &&
      saved.zoom === current.zoom
    ) {
      return;
    }
    try {
      save({ fileId, page: current.page, mode: current.mode, zoom: current.zoom });
      saved = { ...current };
    } catch (error) {
      if (onError(error) === 'stop') {
        cancelTimer();
        disposed = true;
      }
    }
  }

  return {
    setPage(page) {
      if (disposed || page === current.page) return;
      current.page = page;
      cancelTimer();
      timer = setTimeout(write, delayMs);
    },
    setMode(mode) {
      if (disposed || mode === current.mode) return;
      current.mode = mode;
      write();
    },
    setZoom(zoom) {
      const clamped = clampZoom(zoom);
      if (disposed || clamped === current.zoom) return;
      current.zoom = clamped;
      write();
    },
    flush() {
      if (disposed || timer === null) return;
      write();
    },
    dispose() {
      if (disposed) return;
      if (timer !== null) write();
      disposed = true;
    },
  };
}
