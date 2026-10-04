import { Linking } from 'react-native';

import { i18n } from '@/i18n';
import { reportError } from '@/lib/crash';
import { toAppError, toRecoveryLabel, toUserMessage } from '@/lib/errors';

import { toast, type ToastOptions } from './ui';

export type ErrorToastOptions = {
  /** Offered as "Try again" when the error's recovery is a retry. */
  onRetry?: () => void;
};

function openAppSettings(): void {
  Linking.openSettings().catch(reportError);
}

/**
 * Shows an error as a toast: title and message in the current language, plus
 * the recovery action when one fits a toast. PERMISSION_DENIED opens the
 * app's system settings; retryable errors offer `onRetry` when given.
 * CANCELLED shows nothing (the user chose it).
 */
export function showErrorToast(error: unknown, { onRetry }: ErrorToastOptions = {}): void {
  const { code } = toAppError(error);
  if (code === 'CANCELLED') return;
  const { title, message, recovery } = toUserMessage(code);
  const text = i18n.t('common.errorToast', { title, message });
  let options: ToastOptions | undefined;
  if (recovery === 'openSettings') {
    options = { actionLabel: toRecoveryLabel('openSettings'), onAction: openAppSettings };
  } else if (recovery === 'retry' && onRetry) {
    options = { actionLabel: toRecoveryLabel('retry'), onAction: onRetry };
  }
  toast(text, options);
}
