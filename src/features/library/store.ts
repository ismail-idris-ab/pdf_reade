import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import type { FileSource } from '@/db/schema';
import type { LibrarySort, SortDir } from '@/db/repositories';
import { EXT_GROUPS, type ExtGroup } from '@/lib/files/extGroups';

export type LibraryView = 'list' | 'grid';
export type LibraryTab = 'all' | ExtGroup;
/** Source chips. 'device' rows show under All only. */
export type LibraryChip = 'all' | Exclude<FileSource, 'device'>;

export const LIBRARY_TABS: readonly LibraryTab[] = ['all', ...EXT_GROUPS];
export const LIBRARY_CHIPS: readonly LibraryChip[] = [
  'all',
  'downloads',
  'whatsapp',
  'scans',
  'myfiles',
];
export const LIBRARY_SORTS: readonly LibrarySort[] = ['name', 'date', 'size'];
const VIEWS: readonly LibraryView[] = ['list', 'grid'];
const DIRS: readonly SortDir[] = ['asc', 'desc'];

/** Direction a sort starts in when chosen: A→Z, newest first, largest first. */
export const DEFAULT_SORT_DIR: Record<LibrarySort, SortDir> = {
  name: 'asc',
  date: 'desc',
  size: 'desc',
};

type LibraryPrefs = {
  view: LibraryView;
  sort: LibrarySort;
  sortDir: SortDir;
  tab: LibraryTab;
  chip: LibraryChip;
};

type LibraryPrefsState = LibraryPrefs & {
  setView: (view: LibraryView) => void;
  /** Picks a sort field and resets the direction to that field's default. */
  setSort: (sort: LibrarySort) => void;
  setSortDir: (sortDir: SortDir) => void;
  setTab: (tab: LibraryTab) => void;
  setChip: (chip: LibraryChip) => void;
};

const DEFAULTS: LibraryPrefs = {
  view: 'list',
  sort: 'date',
  sortDir: 'desc',
  tab: 'all',
  chip: 'all',
};

// Synchronous storage so the first frame already uses the saved view, sort
// and filters (no flash of the defaults, no second query).
const syncStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => {
    // A failed save must not break the tap: the choice applies for this
    // session and the previous one comes back next launch.
    try {
      Storage.setItemSync(name, value);
    } catch {
      // Ignored: nothing useful to show the user for a list preference.
    }
  },
  removeItem: (name) => {
    Storage.removeItemSync(name);
  },
};

function pick<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Library view, sort and filters, persisted. The search query is not. */
export const useLibraryPrefsStore = create<LibraryPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setView: (view) => set({ view }),
      setSort: (sort) => set({ sort, sortDir: DEFAULT_SORT_DIR[sort] }),
      setSortDir: (sortDir) => set({ sortDir }),
      setTab: (tab) => set({ tab }),
      setChip: (chip) => set({ chip }),
    }),
    {
      name: 'library-prefs',
      version: 1,
      storage: createJSONStorage(() => syncStorage),
      partialize: ({ view, sort, sortDir, tab, chip }) => ({ view, sort, sortDir, tab, chip }),
      // Each field falls back on its own if the stored value is unknown
      // (e.g. a tab or source removed in a later version).
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Record<keyof LibraryPrefs, unknown>>;
        return {
          ...current,
          view: pick(VIEWS, saved.view, current.view),
          sort: pick(LIBRARY_SORTS, saved.sort, current.sort),
          sortDir: pick(DIRS, saved.sortDir, current.sortDir),
          tab: pick(LIBRARY_TABS, saved.tab, current.tab),
          chip: pick(LIBRARY_CHIPS, saved.chip, current.chip),
        };
      },
    },
  ),
);
