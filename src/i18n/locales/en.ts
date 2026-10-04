// Source catalogue. Every key here must exist in ha.ts and fr.ts (type error
// otherwise), and every ha/fr string is listed in docs/TRANSLATIONS_TO_REVIEW.md.
export const en = {
  common: {
    cancel: 'Cancel',
    close: 'Close',
    errorToast: '{{title}}. {{message}}',
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
  onboarding: {
    title: 'Your documents, ready when you are',
    valueTools: 'Read, scan and compress PDFs in one app',
    valuePrivate: 'Works offline. Your files stay on your phone',
    valueNoAds: 'No ads while you read',
    allowAccess: 'Allow access to find all documents',
    allowAccessHint: 'Opens Settings. You can change this at any time.',
    pickFiles: 'Pick files manually',
    manualNote: 'Everything works without access. You can pick files yourself.',
  },
  access: {
    bannerMessage: 'Allow access so the app can find all your documents automatically.',
    allow: 'Allow access',
  },
  library: {
    untitled: 'Untitled document',
    evictedOldPicks:
      'To make room, older picked files were removed from your library ({{count}}). Pick them again to get them back.',
    cannotKeepAccess:
      'Some files couldn’t be added: their source app doesn’t allow lasting access. Try saving them to your phone first.',
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Shape every catalogue must have: the same keys as `en`, any strings. */
export type Catalog = Widen<typeof en>;
