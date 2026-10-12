import type { LibraryFile, LibrarySort, SortDir } from '@/db/repositories';
import { extGroupOf } from '@/lib/files/extGroups';

import type { LibraryChip, LibraryTab } from './store';

export type LibraryFilters = {
  tab: LibraryTab;
  chip: LibraryChip;
  sort: LibrarySort;
  sortDir: SortDir;
  /** Debounced search text; blank for no search. */
  query: string;
};

/** Whether a file passes the tab and source filters (used on search results). */
export function matchesFilters(
  file: Pick<LibraryFile, 'ext' | 'source'>,
  tab: LibraryTab,
  chip: LibraryChip,
): boolean {
  if (tab !== 'all' && extGroupOf(file.ext) !== tab) return false;
  if (chip !== 'all' && file.source !== chip) return false;
  return true;
}

/** Whether the Recent and Favorites rows belong on screen: All tab, All chip, no search. */
export function showsShelves({ tab, chip, query }: Pick<LibraryFilters, 'tab' | 'chip' | 'query'>) {
  return tab === 'all' && chip === 'all' && query.trim() === '';
}
