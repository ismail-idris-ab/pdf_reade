import { reportError } from '@/lib/crash';
import { searchDocument, type SearchHandle } from '@/lib/engine';
import { toAppError } from '@/lib/errors';

import {
  addPageMatches,
  EMPTY_RESULTS,
  nextMatch,
  previousMatch,
  SEARCH_DEBOUNCE_MS,
  type MatchRef,
  type SearchOptionsState,
} from './search';
import { CLOSED_SEARCH, type ReaderStore } from './store';

export type SearchController = {
  /** Shows the search field. */
  open: () => void;
  /** New query text: the running search stops at once, the next starts after a typing pause. */
  setQuery: (query: string) => void;
  /** Match case / whole word changed: searches again at once. */
  setOptions: (patch: Partial<SearchOptionsState>) => void;
  /** Runs the current query again (after an error). */
  retry: () => void;
  /** Selects the next match (wrapping) and shows it. */
  next: () => void;
  /** Selects the previous match (wrapping) and shows it. */
  previous: () => void;
  /** Stops the search and clears the query, results and highlights. */
  close: () => void;
  /** Stops the running search (the reader is closing). */
  dispose: () => void;
  /** Sets how a selected match is brought into view (it changes with zoom and layout). */
  setNavigator: (navigate: (match: MatchRef) => void) => void;
};

export type SearchControllerOptions = {
  docId: string;
  store: ReaderStore;
  debounceMs?: number;
};

/**
 * Runs the reader's in-document search (T2.6) against the engine and keeps
 * its state in the reader store. Only one search runs at a time: a new
 * query, new options, close and dispose all cancel the running one, and
 * events of a superseded search are ignored. The query is never logged or
 * reported.
 */
export function createSearchController({
  docId,
  store,
  debounceMs = SEARCH_DEBOUNCE_MS,
}: SearchControllerOptions): SearchController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: SearchHandle | null = null;
  // Bumped on every restart: callbacks of an older search do nothing.
  let generation = 0;
  let navigate: (match: MatchRef) => void = () => undefined;

  function stop() {
    generation += 1;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    running?.cancel();
    running = null;
  }

  function start(query: string) {
    timer = null;
    const mine = generation;
    const { searchOptions } = store.getState();
    store
      .getState()
      .setSearch({ searchStatus: { kind: 'searching', pagesSearched: 0, pageCount: 0 } });
    const handle = searchDocument(docId, query, searchOptions, {
      onResult: (event) => {
        if (mine !== generation) return;
        const { searchResults, setSearch } = store.getState();
        setSearch({
          searchResults: addPageMatches(searchResults, event.page, event.matches, event.rotation),
        });
      },
      onProgress: (event) => {
        if (mine !== generation) return;
        store.getState().setSearch({
          searchStatus: {
            kind: 'searching',
            pagesSearched: event.pagesSearched,
            pageCount: event.pageCount,
          },
        });
      },
    });
    running = handle;
    handle.done.then(
      () => {
        if (mine !== generation) return;
        running = null;
        store.getState().setSearch({ searchStatus: { kind: 'done' } });
      },
      (error: unknown) => {
        if (mine !== generation) return;
        running = null;
        const appError = toAppError(error);
        if (appError.code === 'CANCELLED') {
          // Not ours (the document closed under the search): nothing to say.
          store.getState().setSearch({ searchStatus: { kind: 'idle' } });
          return;
        }
        // The engine error carries a code, never the query.
        if (appError.code === 'UNKNOWN') reportError(appError);
        store.getState().setSearch({ searchStatus: { kind: 'error', code: appError.code } });
      },
    );
  }

  function restart(delay: number) {
    stop();
    const query = store.getState().searchQuery;
    if (query.trim() === '') {
      store.getState().setSearch({
        searchStatus: { kind: 'idle' },
        searchResults: EMPTY_RESULTS,
        currentMatch: null,
      });
      return;
    }
    store.getState().setSearch({
      searchStatus: { kind: 'pending' },
      searchResults: EMPTY_RESULTS,
      currentMatch: null,
    });
    timer = setTimeout(() => start(query), delay);
  }

  function select(pick: typeof nextMatch) {
    const { searchResults, searchStatus, currentMatch, page, setSearch } = store.getState();
    // Only a finished search (or one that failed part-way) wraps around.
    const complete = searchStatus.kind !== 'pending' && searchStatus.kind !== 'searching';
    const target = pick(searchResults, currentMatch, page, complete);
    if (target === null) return;
    setSearch({ currentMatch: target });
    navigate(target);
  }

  return {
    open: () => {
      store.getState().setSearch({ searchOpen: true, searchFocusPending: true });
    },
    setQuery: (query) => {
      store.getState().setSearch({ searchQuery: query });
      restart(debounceMs);
    },
    setOptions: (patch) => {
      const { searchOptions, setSearch } = store.getState();
      setSearch({ searchOptions: { ...searchOptions, ...patch } });
      restart(0);
    },
    retry: () => restart(0),
    next: () => select(nextMatch),
    previous: () => select(previousMatch),
    close: () => {
      stop();
      store.getState().setSearch(CLOSED_SEARCH);
    },
    dispose: stop,
    setNavigator: (next) => {
      navigate = next;
    },
  };
}
