import { showErrorToast } from '@/components/errorToast';
import { toast } from '@/components/ui';
import type { BookmarksRepository } from '@/db/repositories/bookmarks';
import type { BookmarkRow } from '@/db/types';
import { i18n } from '@/i18n';
import { reportError } from '@/lib/crash';

import type { ReaderStore } from './store';

export type BookmarkActions = {
  /** Reads this file's bookmarks into the reader store. */
  load: () => void;
  /**
   * Bookmarks `page`, or removes its bookmark (with Undo), from the top bar:
   * the outcome and any failure are shown as a toast.
   */
  toggle: (page: number) => void;
  /**
   * Removes the bookmark of `page` and returns it (for Undo); null when the
   * page had none. Throws (after reporting) when the write fails, so a
   * caller in a sheet can show the failure where the user is looking.
   */
  remove: (page: number) => BookmarkRow | null;
  /** Puts a removed bookmark back. Throws (after reporting) when the write fails. */
  restore: (row: BookmarkRow) => void;
};

export type BookmarkActionsOptions = {
  fileId: number;
  store: ReaderStore;
  repository: () => BookmarksRepository;
  now?: () => number;
};

/**
 * Page bookmarks of the open file (T2.6), stored in the bookmarks table (one
 * per file and page; deleted with the file by its foreign key). Every change
 * is written first and the store re-read from the table, so the list on
 * screen is always what was saved.
 *
 * Toasts are drawn in the main window, behind an open sheet, so only the
 * top-bar toggle reports through them; the bookmarks sheet shows its own
 * Undo and errors (NavigationSheet).
 */
export function createBookmarkActions({
  fileId,
  store,
  repository,
  now = Date.now,
}: BookmarkActionsOptions): BookmarkActions {
  function refresh() {
    store.getState().setBookmarks(repository().listForFile(fileId));
  }

  /** Runs a write; a failure is reported and rethrown. */
  function write(change: () => void) {
    try {
      change();
      refresh();
    } catch (error) {
      reportError(error);
      throw error;
    }
  }

  function load() {
    try {
      refresh();
    } catch (error) {
      reportError(error);
      showErrorToast(error, { onRetry: load });
    }
  }

  function remove(page: number): BookmarkRow | null {
    const row = store.getState().bookmarks.find((bookmark) => bookmark.page === page) ?? null;
    write(() => repository().remove(fileId, page));
    return row;
  }

  function restore(row: BookmarkRow) {
    write(() => repository().add(fileId, row.page, row.label, row.createdAt));
  }

  /** A top-bar change: its failure as a toast with Try again. */
  function withToast<T>(change: () => T, retry: () => void): { value: T } | null {
    try {
      return { value: change() };
    } catch (error) {
      showErrorToast(error, { onRetry: retry });
      return null;
    }
  }

  function add(page: number) {
    const done = withToast(
      () => write(() => repository().add(fileId, page, null, now())),
      () => add(page),
    );
    if (done) toast(i18n.t('reader.bookmarks.added', { page: page + 1 }));
  }

  function undo(row: BookmarkRow) {
    withToast(
      () => restore(row),
      () => undo(row),
    );
  }

  function removeWithUndo(page: number) {
    const done = withToast(
      () => remove(page),
      () => removeWithUndo(page),
    );
    if (!done) return;
    const row = done.value;
    toast(i18n.t('reader.bookmarks.removed', { page: page + 1 }), {
      actionLabel: i18n.t('reader.bookmarks.undo'),
      onAction: () => {
        if (row) undo(row);
      },
    });
  }

  return {
    load,
    toggle: (page) => {
      if (store.getState().bookmarks.some((bookmark) => bookmark.page === page)) {
        removeWithUndo(page);
      } else {
        add(page);
      }
    },
    remove,
    restore,
  };
}
