import { createContext, useContext, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';

import type { DetailRegion } from '@/lib/engine';

export type ReaderUiState = {
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
  setPage: (page: number) => void;
  setDetails: (details: Readonly<Record<number, DetailRegion>>) => void;
  toggleChrome: () => void;
};

const NO_DETAILS: Readonly<Record<number, DetailRegion>> = {};

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
    setPage: (page) => set((state) => (state.page === page ? state : { page })),
    setDetails: (details) =>
      set((state) =>
        Object.keys(details).length === 0 && Object.keys(state.details).length === 0
          ? state
          : { details: Object.keys(details).length === 0 ? NO_DETAILS : details },
      ),
    toggleChrome: () => set((state) => ({ chromeVisible: !state.chromeVisible })),
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
