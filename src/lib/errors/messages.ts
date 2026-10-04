import { i18n } from '@/i18n';

import type { AppErrorCode } from './codes';

/** What the screen should offer the user after an error. */
export type RecoveryAction =
  'retry' | 'enterPassword' | 'freeSpace' | 'openSettings' | 'pickAnotherFile' | 'none';

export type UserMessage = {
  title: string;
  message: string;
  recovery: RecoveryAction;
};

const RECOVERY: Record<AppErrorCode, RecoveryAction> = {
  PASSWORD_REQUIRED: 'enterPassword',
  WRONG_PASSWORD: 'enterPassword',
  CORRUPT_FILE: 'pickAnotherFile',
  UNSUPPORTED: 'pickAnotherFile',
  NO_SPACE: 'freeSpace',
  OUT_OF_MEMORY: 'retry',
  CANCELLED: 'none',
  PERMISSION_DENIED: 'openSettings',
  NOT_FOUND: 'pickAnotherFile',
  UNKNOWN: 'retry',
};

/** Human message in the current language plus the recovery to offer. */
export function toUserMessage(code: AppErrorCode): UserMessage {
  return {
    title: i18n.t(`errors.${code}.title`),
    message: i18n.t(`errors.${code}.message`),
    recovery: RECOVERY[code],
  };
}

/** Button label for a recovery action, in the current language. */
export function toRecoveryLabel(action: Exclude<RecoveryAction, 'none'>): string {
  return i18n.t(`recovery.${action}`);
}
