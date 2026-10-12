import { useEffect, useState } from 'react';

import { getRepositories } from '@/db/client';
import type { LibraryFile } from '@/db/repositories';
import { toAppError, type AppError } from '@/lib/errors';
import { useLibraryVersion } from '@/lib/library/version';

import { matchesFilters, showsShelves, type LibraryFilters } from './filters';
import { reconcileFiles, toLibraryFile } from './reconcile';

/** Search results considered before tab/source filtering. */
const SEARCH_LIMIT = 2000;
/** Cards in the Recent row. */
const RECENT_LIMIT = 20;
/** Longest a deferred re-read waits for an idle moment, ms. */
const IDLE_TIMEOUT_MS = 500;

const NO_FILES: readonly LibraryFile[] = [];

export type LibraryData =
  | {
      status: 'ready';
      items: readonly LibraryFile[];
      /** Shown only on All / All with no search; empty otherwise. */
      recent: readonly LibraryFile[];
      favorites: readonly LibraryFile[];
      /** Rows in the whole library, ignoring filters and search. */
      total: number;
    }
  | { status: 'error'; error: AppError };

/**
 * Reads the list for `filters`. Unchanged files keep their object from
 * `previous`, and `previous` itself is returned when nothing changed, so
 * memoised rows (and the list) skip re-rendering. Never throws.
 */
export function readLibrary(
  filters: LibraryFilters,
  locale: string,
  previous: LibraryData | null,
): LibraryData {
  const { tab, chip, sort, sortDir, query } = filters;
  const shelves = showsShelves(filters);
  try {
    const repos = getRepositories().files;
    const search = query.trim();
    const items =
      search === ''
        ? repos.listLibrary({ extGroup: tab, source: chip, sort, dir: sortDir, locale })
        : repos
            .search(search, SEARCH_LIMIT)
            .filter((file) => matchesFilters(file, tab, chip))
            .map(toLibraryFile);
    const recent = shelves ? repos.listRecent(RECENT_LIMIT).map(toLibraryFile) : NO_FILES;
    const favorites = shelves ? repos.listFavorites().map(toLibraryFile) : NO_FILES;
    const total = repos.countAll();

    const old = previous?.status === 'ready' ? previous : null;
    const next = {
      status: 'ready' as const,
      items: reconcileFiles(old?.items ?? NO_FILES, items),
      recent: reconcileFiles(old?.recent ?? NO_FILES, recent),
      favorites: reconcileFiles(old?.favorites ?? NO_FILES, favorites),
      total,
    };
    if (
      old !== null &&
      old.items === next.items &&
      old.recent === next.recent &&
      old.favorites === next.favorites &&
      old.total === next.total
    ) {
      return old;
    }
    return next;
  } catch (error) {
    return { status: 'error', error: toAppError(error) };
  }
}

type IdleHost = {
  requestIdleCallback?: (task: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Runs `task` when the JS thread is idle (or within the timeout); returns a canceller. */
export function scheduleIdle(task: () => void): () => void {
  const host = globalThis as IdleHost;
  const { requestIdleCallback, cancelIdleCallback } = host;
  if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') {
    const handle = requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(task, 0);
  return () => clearTimeout(timer);
}

type Snapshot = { key: string; version: number; data: LibraryData };

/**
 * The library list for the current filters.
 * - Filter changes are taps: the list is re-read at once (during that render)
 *   so the tap shows its result in the same frame.
 * - Library changes (scan batches, picks, prunes: the library version) are
 *   background events: the re-read is deferred until the JS thread is idle,
 *   never done in render, and coalesced if several arrive.
 * Without a search the database filters and sorts; with one, FTS results
 * (best match first) are filtered by tab and source here, keeping rank order.
 */
export function useLibraryData(filters: LibraryFilters, locale: string): LibraryData {
  const version = useLibraryVersion();
  const { tab, chip, sort, sortDir, query } = filters;
  const key = [tab, chip, sort, sortDir, query, locale].join('\u0000');
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    key,
    version,
    data: readLibrary(filters, locale, null),
  }));

  let current = snapshot;
  if (snapshot.key !== key) {
    current = { key, version, data: readLibrary(filters, locale, snapshot.data) };
    setSnapshot(current);
  }

  useEffect(() => {
    if (current.version === version) return undefined;
    return scheduleIdle(() => {
      setSnapshot({
        key,
        version,
        data: readLibrary({ tab, chip, sort, sortDir, query }, locale, current.data),
      });
    });
  }, [current, version, key, tab, chip, sort, sortDir, query, locale]);

  return current.data;
}

/** `value`, updated only after it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
