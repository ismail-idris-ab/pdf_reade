import { showErrorToast } from '@/components/errorToast';
import { toast } from '@/components/ui';
import { i18n } from '@/i18n';
import { reportError } from '@/lib/crash';
import { toAppError, toRecoveryLabel, toUserMessage } from '@/lib/errors';
import { fileOpErrorKind, openAllFilesAccessSettings } from '@/lib/files';

import { usesLegacyWritePermission } from './actions';
import { showSharedWriteRefused } from './sharedWriteAccess';

export type FileActionErrorOptions = {
  /**
   * The operation touched shared storage (not My Files, not a picked
   * document): PERMISSION_DENIED then means all-files access is missing
   * (Android 11+) or the storage permission was revoked (Android 8–10).
   */
  sharedStorage?: boolean;
  /**
   * Offered on NOT_FOUND: drops the stale library row. Pass it only once the
   * file is confirmed gone (isFileGone); otherwise NOT_FOUND shows plainly.
   */
  onRemoveFromLibrary?: () => void;
  /**
   * Offered for retryable errors (UNKNOWN, which includes ERR_FILE_OP_FAILED,
   * and OUT_OF_MEMORY): typically re-opens the same dialog for the same item.
   */
  onRetry?: () => void;
};

function openAllFilesAccess(): void {
  openAllFilesAccessSettings().catch(reportError);
}

/**
 * Shows a failed file action as a toast with its recovery:
 * - ERR_DUPLICATE_LEFT explains that a second copy remains (no action:
 *   both copies are intact and listed);
 * - NOT_FOUND offers "Remove from library" when `onRemoveFromLibrary` is given;
 * - PERMISSION_DENIED on shared storage opens the all-files access screen
 *   (Android 11+), or explains the storage permission with "Try again"
 *   (`onRetry`, which should re-run the permission gate) on Android 8–10;
 * - everything else goes through showErrorToast (NO_SPACE explains,
 *   retryable errors offer `onRetry`, CANCELLED is silent).
 * Name errors never get here: the dialogs show them inline.
 */
export function showFileActionError(
  error: unknown,
  { sharedStorage = false, onRemoveFromLibrary, onRetry }: FileActionErrorOptions = {},
): void {
  if (fileOpErrorKind(error) === 'duplicateLeft') {
    toast(i18n.t('fileActions.duplicateLeft'));
    return;
  }
  const { code } = toAppError(error);
  if (code === 'NOT_FOUND' && onRemoveFromLibrary) {
    const { title, message } = toUserMessage(code);
    toast(i18n.t('common.errorToast', { title, message }), {
      actionLabel: i18n.t('fileActions.removeFromLibrary'),
      onAction: onRemoveFromLibrary,
    });
    return;
  }
  if (code === 'PERMISSION_DENIED' && sharedStorage && usesLegacyWritePermission()) {
    // Android 8–10: the storage permission was revoked since the gate let
    // the action through. "Try again" runs the gate (and its prompt) again.
    if (onRetry) showSharedWriteRefused('denied', onRetry);
    else toast(i18n.t('fileActions.writeAccessDenied'));
    return;
  }
  if (code === 'PERMISSION_DENIED' && sharedStorage) {
    const { title } = toUserMessage(code);
    toast(
      i18n.t('common.errorToast', { title, message: i18n.t('fileActions.allowAccessToChange') }),
      {
        actionLabel: toRecoveryLabel('openSettings'),
        onAction: openAllFilesAccess,
      },
    );
    return;
  }
  if (code === 'UNKNOWN') reportError(error);
  showErrorToast(error, { onRetry });
}

/**
 * A picked document whose provider could not keep the app's access under the
 * new name, so it kept its old name: explain, and offer a renamable copy.
 */
export function showRenameNotKept(onCopyToMyFiles: () => void): void {
  toast(i18n.t('fileActions.renameUnsupported'), {
    actionLabel: i18n.t('fileActions.copyToMyFiles'),
    onAction: onCopyToMyFiles,
  });
}
