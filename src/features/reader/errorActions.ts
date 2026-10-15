import type { AppErrorCode } from '@/lib/errors';

/** What a reader error screen offers; the first entry is the primary button. */
export type ReaderErrorAction =
  'retry' | 'allFilesAccess' | 'freeSpace' | 'pickAnotherFile' | 'pickAgain' | 'back';

/**
 * Open failures the error screen shows. A password-protected file never gets
 * there: PASSWORD_REQUIRED and WRONG_PASSWORD go to the password prompt.
 */
export type ReaderOpenErrorCode = Exclude<AppErrorCode, 'PASSWORD_REQUIRED' | 'WRONG_PASSWORD'>;

export type ReaderErrorContext = {
  /**
   * The file is read through a content:// URI (a picked or handed-over
   * document) rather than a filesystem path.
   */
  contentSource: boolean;
};

/**
 * Buttons for a document that could not be opened, by error code:
 * - damaged / unsupported / missing: choose another file (back to the library);
 * - permission on a path: grant all-files access (the only setting that can
 *   fix it), then try again; on a content:// URI the grant was lost and no
 *   setting brings it back, so pick the file again in the system picker;
 * - out of space: free up space (storage settings), then try again;
 * - out of memory, cancelled, unknown: try again.
 * Every screen also has a way back.
 */
export function readerErrorActions(
  code: ReaderOpenErrorCode,
  { contentSource }: ReaderErrorContext,
): ReaderErrorAction[] {
  switch (code) {
    case 'CORRUPT_FILE':
    case 'UNSUPPORTED':
    case 'NOT_FOUND':
      return ['pickAnotherFile'];
    case 'PERMISSION_DENIED':
      return contentSource ? ['pickAgain', 'retry', 'back'] : ['allFilesAccess', 'retry', 'back'];
    case 'NO_SPACE':
      return ['freeSpace', 'retry', 'back'];
    case 'OUT_OF_MEMORY':
    case 'CANCELLED':
    case 'UNKNOWN':
      return ['retry', 'back'];
  }
}
