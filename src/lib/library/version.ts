import { create } from 'zustand';

type LibraryVersionState = {
  /** Increases whenever the files table changed; screens re-query on change. */
  version: number;
};

/** Session-only change counter for the library (not persisted). */
export const useLibraryVersionStore = create<LibraryVersionState>()(() => ({ version: 0 }));

/** Tells mounted library screens that the files table changed. */
export function bumpLibraryVersion(): void {
  useLibraryVersionStore.setState((state) => ({ version: state.version + 1 }));
}

/** The current library version; re-renders the caller when it changes. */
export function useLibraryVersion(): number {
  return useLibraryVersionStore((state) => state.version);
}
