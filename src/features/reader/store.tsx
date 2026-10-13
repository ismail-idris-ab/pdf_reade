import { createContext, useContext, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';

export type ReaderUiState = {
  /** 0-based page shown in the indicator (the most visible page). */
  page: number;
  /** Top bar, page indicator and thumbnail strip; false is fullscreen. */
  chromeVisible: boolean;
  setPage: (page: number) => void;
  toggleChrome: () => void;
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
    setPage: (page) => set((state) => (state.page === page ? state : { page })),
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
