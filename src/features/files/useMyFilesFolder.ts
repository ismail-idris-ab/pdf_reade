import { useEffect, useMemo, useState } from 'react';

import { getRepositories } from '@/db/client';
import { compareNames, type LibraryFile, type LibrarySort, type SortDir } from '@/db/repositories';
import { reportError } from '@/lib/crash';
import { AppError, toAppError } from '@/lib/errors';
import { isTempEntry, listFolder, tryGetMyFilesRoot, type FolderEntry } from '@/lib/files';
import { useLibraryVersion } from '@/lib/library/version';

import type { LibraryTab } from '../library/store';
import { reconcileFiles } from '../library/reconcile';
import { reconcileMyFiles } from './actions';

export type MyFilesFolder =
  | { status: 'loading' }
  | {
      status: 'ready';
      folders: readonly FolderEntry[];
      files: readonly LibraryFile[];
    }
  | { status: 'error'; error: AppError };

export type MyFilesQuery = {
  tab: LibraryTab;
  sort: LibrarySort;
  sortDir: SortDir;
  locale: string;
};

const NO_FILES: readonly LibraryFile[] = [];

/** Sub-folders by name (native work entries left out), in the list's locale. */
export function sortFolders(entries: readonly FolderEntry[], locale: string): FolderEntry[] {
  return entries
    .filter((entry) => entry.isDirectory && !isTempEntry(entry.name))
    .map((entry, index) => ({ entry, id: index, name: entry.name }))
    .sort((a, b) => compareNames(a, b, locale))
    .map(({ entry }) => entry);
}

/** The My Files root, or null when the native module cannot give it. */
export function useMyFilesRoot(): string | null {
  return useMemo(() => tryGetMyFilesRoot(), []);
}

/**
 * Contents of one My Files folder: its sub-folders (from disk, by name) and
 * its files (library rows directly inside it, with the tab filter and sort
 * applied). Re-read whenever the folder, the query or the library changes.
 * When `enabled` turns on, the whole My Files tree is reconciled with the
 * table first (changes made outside the app's own actions). Idle while
 * disabled.
 */
export function useMyFilesFolder(
  dir: string | null,
  { tab, sort, sortDir, locale }: MyFilesQuery,
  enabled: boolean,
): MyFilesFolder {
  const version = useLibraryVersion();
  // The last result, with the folder it belongs to: another folder's
  // contents are never shown under this folder's breadcrumb, while a
  // re-read of the same folder keeps the old contents until it lands.
  const [loaded, setLoaded] = useState<{ dir: string; data: MyFilesFolder } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Its bump re-reads the folder below; failures leave the rows as they are.
    reconcileMyFiles(getRepositories()).catch(reportError);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || dir === null) return undefined;
    let live = true;
    listFolder(dir).then(
      (listing) => {
        if (!live) return;
        try {
          const files = getRepositories().files.listLibrary({
            folder: dir,
            extGroup: tab,
            sort,
            dir: sortDir,
            locale,
          });
          setLoaded((previous) => {
            const old =
              previous !== null && previous.dir === dir && previous.data.status === 'ready'
                ? previous.data.files
                : NO_FILES;
            return {
              dir,
              data: {
                status: 'ready',
                folders: sortFolders(listing.entries, locale),
                files: reconcileFiles(old, files),
              },
            };
          });
        } catch (error) {
          setLoaded({ dir, data: { status: 'error', error: toAppError(error) } });
        }
      },
      (error: unknown) => {
        if (live) setLoaded({ dir, data: { status: 'error', error: toAppError(error) } });
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, dir, tab, sort, sortDir, locale, version]);

  if (dir === null) return ROOT_UNAVAILABLE;
  return loaded !== null && loaded.dir === dir ? loaded.data : LOADING;
}

const LOADING: MyFilesFolder = { status: 'loading' };
const ROOT_UNAVAILABLE: MyFilesFolder = {
  status: 'error',
  error: new AppError('UNKNOWN', 'My Files root unavailable'),
};
