// Source catalogue. Every key here must exist in ha.ts and fr.ts (type error
// otherwise), and every ha/fr string is listed in docs/TRANSLATIONS_TO_REVIEW.md.
export const en = {
  common: {
    cancel: 'Cancel',
    close: 'Close',
  },
  errors: {
    PASSWORD_REQUIRED: {
      title: 'This file is password-protected',
      message: 'Enter the password to open it.',
    },
    WRONG_PASSWORD: {
      title: 'Wrong password',
      message: 'That password did not work. Check it and try again.',
    },
    CORRUPT_FILE: {
      title: 'This file is damaged',
      message: 'It may not have downloaded completely. Try getting the file again.',
    },
    UNSUPPORTED: {
      title: "This file type isn't supported",
      message: 'Try opening a PDF, image or Office document instead.',
    },
    NO_SPACE: {
      title: 'Your phone is out of storage',
      message: 'Free up some space, then try again.',
    },
    OUT_OF_MEMORY: {
      title: 'This file is too large to handle right now',
      message: 'Close other apps and try again.',
    },
    CANCELLED: {
      title: 'Cancelled',
      message: 'Nothing was changed.',
    },
    PERMISSION_DENIED: {
      title: 'Permission needed',
      message: 'Allow access in Settings so the app can open your documents.',
    },
    NOT_FOUND: {
      title: 'File not found',
      message: 'It may have been moved or deleted.',
    },
    UNKNOWN: {
      title: 'Something went wrong',
      message: 'Please try again.',
    },
  },
  recovery: {
    retry: 'Try again',
    enterPassword: 'Enter password',
    freeSpace: 'Free up space',
    openSettings: 'Open Settings',
    pickAnotherFile: 'Choose another file',
  },
  units: {
    byte: 'B',
    kilobyte: 'KB',
    megabyte: 'MB',
    gigabyte: 'GB',
  },
  language: {
    title: 'Language',
    system: 'Use phone language',
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Shape every catalogue must have: the same keys as `en`, any strings. */
export type Catalog = Widen<typeof en>;
