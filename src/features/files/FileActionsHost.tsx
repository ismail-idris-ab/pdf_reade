import { useEffect, useState } from 'react';

import { showErrorToast } from '@/components/errorToast';
import { Dialog, toast } from '@/components/ui';
import { getRepositories } from '@/db/client';
import type { LibraryFile } from '@/db/repositories';
import { useTranslation } from '@/i18n';
import { toAppError } from '@/lib/errors';
import {
  folderStats,
  isInMyFiles,
  keepExtension,
  tryGetMyFilesRoot,
  type FolderEntry,
} from '@/lib/files';

import { toLibraryFile } from '../library/reconcile';
import {
  copyToMyFiles,
  deleteLibraryFile,
  deleteMyFilesFolder,
  duplicateLibraryFile,
  isContentPath,
  isFileGone,
  moveLibraryFile,
  parentDir,
  printLibraryFile,
  reconcileMyFiles,
  removeFromLibrary,
  renameLibraryFile,
  renameMyFilesFolder,
  setFileFavorite,
  shareLibraryFile,
} from './actions';
import { FileActionsSheet, FolderActionsSheet, type FileAction } from './components/ActionSheets';
import { DetailsSheet } from './components/DetailsSheet';
import { FolderPicker } from './components/FolderPicker';
import { NameDialog } from './components/NameDialog';
import { WriteAccessDialog } from './components/WriteAccessDialog';
import { showFileActionError, showRenameNotKept } from './errors';
import {
  ensureSharedWriteAccess,
  explainSharedWriteAccess,
  showSharedWriteRefused,
} from './sharedWriteAccess';
import {
  closeFileActions,
  openFileActions,
  showActionOverlay,
  useFileActionsStore,
  type ActionOverlay,
} from './store';
import { useInFlight } from './useInFlight';

const noop = () => undefined;

/**
 * Renders the file actions UI for whatever openFileActions() targeted: the
 * actions sheet and the rename, move / copy, details and delete overlays.
 * Mount once on a screen that lists files. Every overlay is closed before
 * a result toast is shown (toasts sit behind open overlays).
 */
export function FileActionsHost() {
  const target = useFileActionsStore((state) => state.target);
  const overlay = useFileActionsStore((state) => state.overlay);
  return (
    <>
      {target === null ? null : target.kind === 'file' ? (
        <FileOverlays key={`file-${target.file.id}`} file={target.file} overlay={overlay} />
      ) : (
        <FolderOverlays
          key={`folder-${target.folder.path}`}
          folder={target.folder}
          overlay={overlay}
        />
      )}
      <WriteAccessDialog />
    </>
  );
}

/** File actions that change a file in place, so they need shared-storage write access. */
type WriteAction = 'rename' | 'move' | 'duplicate' | 'delete';

function folderLabel(dir: string, rootName: string): string {
  const root = tryGetMyFilesRoot();
  return dir === root ? rootName : dir.slice(dir.lastIndexOf('/') + 1);
}

function FileOverlays({ file, overlay }: { file: LibraryFile; overlay: ActionOverlay | null }) {
  const { t } = useTranslation();
  const repos = getRepositories();
  const { busy, run } = useInFlight();
  const picked = isContentPath(file.path);
  const sharedStorage = !picked && !isInMyFiles(file.path, tryGetMyFilesRoot());

  const removeStale = () => {
    void removeFromLibrary(repos, file.id).then(
      () => toast(t('fileActions.removedFromLibrary')),
      (error: unknown) => showErrorToast(error),
    );
  };

  const fail = (error: unknown, onRetry?: () => void) => {
    void (async () => {
      // "Remove from library" only when the file is confirmed gone.
      const gone =
        toAppError(error).code === 'NOT_FOUND' && (await isFileGone(repos, file.id, error));
      showFileActionError(error, {
        sharedStorage,
        onRemoveFromLibrary: gone ? removeStale : undefined,
        onRetry,
      });
      // Bring My Files back in line with disk: the native half may have
      // succeeded before the database write failed, a move may have left
      // its original behind (ERR_DUPLICATE_LEFT), or the file changed
      // outside the app.
      await reconcileMyFiles(repos).catch(noop);
    })();
  };

  // One-shot actions: close the sheet, run once (double taps are ignored),
  // then report.
  const perform = (task: () => Promise<string | null>, retry: () => void) => {
    closeFileActions();
    void run(async () => {
      try {
        const message = await task();
        if (message !== null) toast(message);
      } catch (error) {
        fail(error, retry);
      }
    });
  };

  const duplicate = () =>
    perform(
      async () => {
        await duplicateLibraryFile(repos, file.id);
        return t('fileActions.duplicated');
      },
      () => beginWrite('duplicate'),
    );

  // Starts a write action for this file: Duplicate runs, the others open
  // their dialog. It closes over this render's `file`, so a toast's "Try
  // again" keeps acting on the file the toast was about, which is what we
  // want; it reopens the sheet through the store rather than assuming one is
  // still on screen.
  const openWrite = (action: WriteAction) => {
    if (action === 'duplicate') {
      duplicate();
      return;
    }
    openFileActions({ kind: 'file', file });
    showActionOverlay(action);
  };

  // Write actions on shared storage pass the permission gate first (Android
  // 8–10: explanation, then the system prompt; a no-op otherwise). The gate
  // finishes before the operation is queued, and a double tap while it is
  // open is ignored. Retries of failed write actions come back through here.
  const beginWrite = (action: WriteAction) => {
    if (!sharedStorage) {
      openWrite(action);
      return;
    }
    const explain = () => {
      closeFileActions();
      return explainSharedWriteAccess();
    };
    const retry = () => beginWrite(action);
    void run(() => ensureSharedWriteAccess(explain)).then(
      (outcome) => {
        // undefined: a double tap while the gate was already open.
        if (outcome === undefined || outcome === 'cancelled') return;
        if (outcome === 'granted') openWrite(action);
        else showSharedWriteRefused(outcome, retry);
      },
      (error: unknown) => {
        closeFileActions();
        showErrorToast(error, { onRetry: retry });
      },
    );
  };
  const shareFile = () =>
    perform(async () => {
      await shareLibraryFile(repos, file.id);
      return null;
    }, shareFile);
  const printFile = () =>
    perform(async () => {
      await printLibraryFile(repos, file.id);
      return null;
    }, printFile);

  const onSelect = (action: FileAction) => {
    switch (action) {
      case 'favorite':
        closeFileActions();
        try {
          setFileFavorite(repos, file.id, !file.isFavorite);
          toast(t(file.isFavorite ? 'fileActions.unfavorited' : 'fileActions.favorited'));
        } catch (error) {
          fail(error);
        }
        return;
      case 'rename':
      case 'move':
      case 'delete':
      case 'duplicate':
        beginWrite(action);
        return;
      case 'copyToMyFiles':
        // Picked documents: copied into My Files, nothing in shared storage changes.
        showActionOverlay('move');
        return;
      case 'details':
        showActionOverlay('details');
        return;
      case 'share':
        shareFile();
        return;
      case 'print':
        printFile();
        return;
    }
  };

  const confirmDelete = () => {
    void run(async () => {
      try {
        await deleteLibraryFile(repos, file.id);
        closeFileActions();
        toast(t('fileActions.deleted'));
      } catch (error) {
        closeFileActions();
        fail(error, () => beginWrite('delete'));
      }
    });
  };

  const closeAfterError = (retry: WriteAction) => (error: unknown) => {
    closeFileActions();
    fail(error, () => beginWrite(retry));
  };

  return (
    <>
      <FileActionsSheet
        visible={overlay === 'actions'}
        file={file}
        onSelect={onSelect}
        onClose={closeFileActions}
      />
      {overlay === 'rename' ? (
        <NameDialog
          testID="rename-dialog"
          title={t('fileActions.rename')}
          initialName={file.name}
          selectBaseName
          confirmLabel={t('fileActions.save')}
          finalName={(typed) => keepExtension(typed, file.name)}
          onSubmit={async (name) => {
            if (keepExtension(name, file.name) === file.name) {
              closeFileActions();
              return;
            }
            const outcome = await renameLibraryFile(repos, file.id, name);
            closeFileActions();
            if (outcome.renamed) {
              toast(t('fileActions.renamed'));
              return;
            }
            // The provider kept the old name. The row now holds the live
            // URI, so the copy is offered for that row as it is now.
            const current = toLibraryFile(outcome.row);
            showRenameNotKept(() => {
              openFileActions({ kind: 'file', file: current });
              showActionOverlay('move');
            });
          }}
          onError={closeAfterError('rename')}
          onDismiss={closeFileActions}
        />
      ) : null}
      {overlay === 'move' ? (
        <FolderPicker
          title={t(picked ? 'fileActions.copyTitle' : 'fileActions.moveTitle')}
          confirmLabel={t(picked ? 'fileActions.copyHere' : 'fileActions.moveHere')}
          currentParent={picked ? null : parentDir(file.path)}
          onConfirm={async (destDir) => {
            if (picked) await copyToMyFiles(repos, file.id, destDir);
            else await moveLibraryFile(repos, file.id, destDir);
            closeFileActions();
            const folder = folderLabel(destDir, t('folders.root'));
            toast(t(picked ? 'fileActions.copied' : 'fileActions.moved', { folder }));
          }}
          onError={closeAfterError('move')}
          onDismiss={closeFileActions}
        />
      ) : null}
      <DetailsSheet
        visible={overlay === 'details'}
        file={file}
        row={overlay === 'details' ? repos.files.getById(file.id) : undefined}
        onClose={closeFileActions}
      />
      <Dialog
        visible={overlay === 'delete'}
        testID="delete-dialog"
        title={t('fileActions.deleteTitle', { name: file.name })}
        message={t('fileActions.deleteMessage')}
        onDismiss={busy ? noop : closeFileActions}
        actions={[
          {
            label: t('common.cancel'),
            onPress: closeFileActions,
            disabled: busy,
            testID: 'delete-cancel',
          },
          {
            label: t('fileActions.delete'),
            variant: 'danger',
            onPress: confirmDelete,
            loading: busy,
            testID: 'delete-confirm',
          },
        ]}
      />
    </>
  );
}

function FolderOverlays({
  folder,
  overlay,
}: {
  folder: FolderEntry;
  overlay: ActionOverlay | null;
}) {
  const { t } = useTranslation();
  const repos = getRepositories();
  const { busy, run } = useInFlight();
  // Counted each time the delete dialog opens. Without a count (still
  // loading, or folderStats failed) the dialog still names the folder.
  const [itemCount, setItemCount] = useState<number | null>(null);

  useEffect(() => {
    if (overlay !== 'delete') return undefined;
    let live = true;
    folderStats(folder.path).then(
      (stats) => {
        if (live) setItemCount(stats.fileCount + stats.folderCount);
      },
      () => {
        if (live) setItemCount(null);
      },
    );
    return () => {
      live = false;
    };
  }, [overlay, folder.path]);

  // A folder that vanished (changed outside the app): show why, then bring
  // the list back in line with disk.
  // Retryable failures re-open the same dialog for this same folder.
  const fail = (error: unknown, retry: ActionOverlay) => {
    showFileActionError(error, {
      onRetry: () => {
        openFileActions({ kind: 'folder', folder });
        showActionOverlay(retry);
      },
    });
    void reconcileMyFiles(repos).catch(noop);
  };

  const confirmDelete = () => {
    void run(async () => {
      try {
        await deleteMyFilesFolder(repos, folder.path);
        closeFileActions();
        toast(t('folders.deleted'));
      } catch (error) {
        closeFileActions();
        fail(error, 'delete');
      }
    });
  };

  return (
    <>
      <FolderActionsSheet
        visible={overlay === 'actions'}
        folder={folder}
        onSelect={(action) => showActionOverlay(action)}
        onClose={closeFileActions}
      />
      {overlay === 'rename' ? (
        <NameDialog
          testID="rename-folder-dialog"
          title={t('fileActions.rename')}
          initialName={folder.name}
          confirmLabel={t('fileActions.save')}
          onSubmit={async (name) => {
            if (name === folder.name) {
              closeFileActions();
              return;
            }
            await renameMyFilesFolder(repos, folder.path, name);
            closeFileActions();
            toast(t('folders.renamed'));
          }}
          onError={(error) => {
            closeFileActions();
            fail(error, 'rename');
          }}
          onDismiss={closeFileActions}
        />
      ) : null}
      <Dialog
        visible={overlay === 'delete'}
        testID="delete-folder-dialog"
        title={
          itemCount !== null && itemCount > 0
            ? t('folders.deleteTitleWithItems', { name: folder.name, count: itemCount })
            : t('folders.deleteTitle', { name: folder.name })
        }
        message={t('fileActions.deleteMessage')}
        onDismiss={busy ? noop : closeFileActions}
        actions={[
          {
            label: t('common.cancel'),
            onPress: closeFileActions,
            disabled: busy,
            testID: 'delete-folder-cancel',
          },
          {
            label: t('fileActions.delete'),
            variant: 'danger',
            onPress: confirmDelete,
            loading: busy,
            testID: 'delete-folder-confirm',
          },
        ]}
      />
    </>
  );
}
