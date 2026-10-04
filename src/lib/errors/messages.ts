import type { AppErrorCode } from './codes';

/** What the screen should offer the user after an error. */
export type RecoveryAction =
  'retry' | 'enterPassword' | 'freeSpace' | 'openSettings' | 'pickAnotherFile' | 'none';

export type UserMessage = {
  title: string;
  message: string;
  recovery: RecoveryAction;
};

// English copy. T0.6 moves these strings into the i18n catalogue
// (keys `errors.<CODE>.title` / `.message`) without changing this shape.
const MESSAGES: Record<AppErrorCode, UserMessage> = {
  PASSWORD_REQUIRED: {
    title: 'This file is password-protected',
    message: 'Enter the password to open it.',
    recovery: 'enterPassword',
  },
  WRONG_PASSWORD: {
    title: 'Wrong password',
    message: 'That password did not work. Check it and try again.',
    recovery: 'enterPassword',
  },
  CORRUPT_FILE: {
    title: 'This file is damaged',
    message: 'It may not have downloaded completely. Try getting the file again.',
    recovery: 'pickAnotherFile',
  },
  UNSUPPORTED: {
    title: "This file type isn't supported",
    message: 'Try opening a PDF, image or Office document instead.',
    recovery: 'pickAnotherFile',
  },
  NO_SPACE: {
    title: 'Your phone is out of storage',
    message: 'Free up some space, then try again.',
    recovery: 'freeSpace',
  },
  OUT_OF_MEMORY: {
    title: 'This file is too large to handle right now',
    message: 'Close other apps and try again.',
    recovery: 'retry',
  },
  CANCELLED: {
    title: 'Cancelled',
    message: 'Nothing was changed.',
    recovery: 'none',
  },
  PERMISSION_DENIED: {
    title: 'Permission needed',
    message: 'Allow access in Settings so the app can open your documents.',
    recovery: 'openSettings',
  },
  NOT_FOUND: {
    title: 'File not found',
    message: 'It may have been moved or deleted.',
    recovery: 'pickAnotherFile',
  },
  UNKNOWN: {
    title: 'Something went wrong',
    message: 'Please try again.',
    recovery: 'retry',
  },
};

export function toUserMessage(code: AppErrorCode): UserMessage {
  return MESSAGES[code];
}

const RECOVERY_LABELS: Record<Exclude<RecoveryAction, 'none'>, string> = {
  retry: 'Try again',
  enterPassword: 'Enter password',
  freeSpace: 'Free up space',
  openSettings: 'Open Settings',
  pickAnotherFile: 'Choose another file',
};

/** Button label for a recovery action. */
export function toRecoveryLabel(action: Exclude<RecoveryAction, 'none'>): string {
  return RECOVERY_LABELS[action];
}
