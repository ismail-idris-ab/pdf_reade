import { createContext, useContext, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';

import type { BookmarkRow } from '@/db/types';
import type { DetailRegion } from '@/lib/engine';

import {
  EMPTY_RESULTS,
  type MatchRef,
  type SearchOptionsState,
  type SearchResults,
  type SearchStatus,
} from './search';
import type { TextSelection } from './selection';

/** In-document search (T2.6); the page cells read the results per page. */
export type ReaderSearchState = {
  searchOpen: boolean;
  /**
   * The search was just opened: the field takes focus (and the keyboard
   * opens) once, not again each time the chrome comes back from fullscreen.
   */
  searchFocusPending: boolean;
  searchQuery: string;
  searchOptions: SearchOptionsState;
  searchStatus: SearchStatus;
  searchResults: SearchResults;
  /** The selected match (stronger highlight); null before the first next/previous. */
  currentMatch: MatchRef | null;
};

export type ReaderUiState = ReaderSearchState & {
  /** 0-based page shown in the indicator (the most visible page). */
  page: number;
  /** Top bar, page indicator and thumbnail strip; false is fullscreen. */
  chromeVisible: boolean;
  /**
   * Sharp-tile region per visible page while zoomed in and settled (empty at
   * 1× and during a pinch). Read per page, so a change re-renders only the
   * page cells whose region changed.
   */
  details: Readonly<Record<number, DetailRegion>>;
  /** This file's bookmarks, ascending by page. */
  bookmarks: readonly BookmarkRow[];
  /** The text selection (T2.8), on one page; null when nothing is selected. */
  selection: TextSelection | null;
  setPage: (page: number) => void;
  setSearch: (patch: Partial<ReaderSearchState>) => void;
  setBookmarks: (bookmarks: readonly BookmarkRow[]) => void;
  setDetails: (details: Readonly<Record<number, DetailRegion>>) => void;
  toggleChrome: () => void;
  setSelection: (selection: TextSelection | null) => void;
};

const NO_DETAILS: Readonly<Record<number, DetailRegion>> = {};

/** A closed search: no query, no results. */
export const CLOSED_SEARCH: ReaderSearchState = {
  searchOpen: false,
  searchFocusPending: false,
  searchQuery: '',
  searchOptions: { matchCase: false, wholeWord: false },
  searchStatus: { kind: 'idle' },
  searchResults: EMPTY_RESULTS,
  currentMatch: null,
};

export type ReaderStore = StoreApi<ReaderUiState>;

/**
 * Reader UI state that changes while reading, one store per open reader (so
 * two readers on the stack never share a page). Kept out of the page list's
 * props so a page change re-renders only the indicator and the two affected
 * thumbnails, never the page cells.
 */
export function createReaderStore(initialPage: number): ReaderStore {
  return createStore<ReaderUiState>()((set) => ({
    page: initialPage,
    chromeVisible: true,
    details: NO_DETAILS,
    ...CLOSED_SEARCH,
    bookmarks: [],
    selection: null,
    setPage: (page) => set((state) => (state.page === page ? state : { page })),
    setSearch: (patch) => set(patch),
    setBookmarks: (bookmarks) => set({ bookmarks }),
    setDetails: (details) =>
      set((state) =>
        Object.keys(details).length === 0 && Object.keys(state.details).length === 0
          ? state
          : { details: Object.keys(details).length === 0 ? NO_DETAILS : details },
      ),
    toggleChrome: () => set((state) => ({ chromeVisible: !state.chromeVisible })),
    setSelection: (selection) =>
      set((state) => (state.selection === selection ? state : { selection })),
  }));
}

const ReaderStoreContext = createContext<ReaderStore | null>(null);

export function ReaderStoreProvider({
  store,
  children,
}: {
  store: ReaderStore;
  children: ReactNode;
}) {
  return <ReaderStoreContext.Provider value={store}>{children}</ReaderStoreContext.Provider>;
}

/** The store of the reader this component belongs to. */
export function useReaderStoreApi(): ReaderStore {
  const store = useContext(ReaderStoreContext);
  if (store === null) throw new Error('useReaderStoreApi must be used inside ReaderStoreProvider');
  return store;
}

/** Subscribes to a slice of this reader's UI state. */
export function useReaderStore<T>(selector: (state: ReaderUiState) => T): T {
  return useStore(useReaderStoreApi(), selector);
}
