import { useCallback, useEffect, useMemo, useState } from 'react';

import { getRepositories } from '@/db/client';
import type { FileRow } from '@/db/types';
import { reportError } from '@/lib/crash';
import { closeDocument, openDocument, type OpenedDocument } from '@/lib/engine';
import { toAppError, type AppErrorCode } from '@/lib/errors';
import { bumpLibraryVersion } from '@/lib/library/version';

import { isContentPath, readableSource } from '../files/actions';
import { isReaderSupported } from './layout';

/**
 * How long a document stays open after the reader lets go of it, ms. The
 * page views are removed from the screen in the same commit, but natively a
 * little later; closing first would make a still-attached view report
 * ERR_DOC_NOT_OPEN. A few frames are enough.
 */
export const CLOSE_DELAY_MS = 250;

export type ReaderDocumentState =
  | { status: 'loading'; file: FileRow }
  | { status: 'ready'; file: FileRow; document: OpenedDocument }
  /** Not a PDF (Office and text viewing is T2.10). */
  | { status: 'unsupported'; file: FileRow }
  /**
   * `file` is null when the library row itself is gone (NOT_FOUND).
   * `contentSource`: the file was read through a content:// URI.
   */
  | { status: 'error'; file: FileRow | null; code: AppErrorCode; contentSource: boolean };

export type ReaderDocument = {
  state: ReaderDocumentState;
  /** Opens the document again (after an error). */
  retry: () => void;
};

type Lookup = { file: FileRow; source: string } | { file: null; source: null; code: AppErrorCode };

function sourceOf(file: FileRow): string {
  try {
    return readableSource(file);
  } catch (error) {
    reportError(error);
    return file.path;
  }
}

function lookUp(fileId: number | null): Lookup {
  if (fileId === null) return { file: null, source: null, code: 'NOT_FOUND' };
  try {
    const file = getRepositories().files.getById(fileId);
    return file
      ? { file, source: sourceOf(file) }
      : { file: null, source: null, code: 'NOT_FOUND' };
  } catch (error) {
    reportError(error);
    return { file: null, source: null, code: 'UNKNOWN' };
  }
}

type Outcome =
  { status: 'ready'; document: OpenedDocument } | { status: 'error'; code: AppErrorCode };

/** Records the open in the library (Recent shelf, page count). Best-effort. */
function recordOpened(file: FileRow, document: OpenedDocument) {
  try {
    const { files } = getRepositories();
    files.markOpened(file.id, Date.now());
    if (file.pageCount !== document.pageCount) files.setPageCount(file.id, document.pageCount);
    bumpLibraryVersion();
  } catch (error) {
    reportError(error);
  }
}

/**
 * Opens library file `fileId` for reading and keeps it open while mounted:
 * resolves the row, opens it through the engine (from its path, or its
 * content:// URI when that is the readable source) and closes it on unmount
 * or retry, CLOSE_DELAY_MS later so the page views detach first. An open
 * still running at unmount is aborted, so nothing leaks. A successful open
 * marks the file as opened.
 */
export function useReaderDocument(fileId: number | null): ReaderDocument {
  const [attempt, setAttempt] = useState(0);
  // Re-read the row on every attempt: a retry may follow a rename or move.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `attempt` forces a fresh read
  const lookup = useMemo(() => lookUp(fileId), [fileId, attempt]);
  const key = `${fileId ?? 'none'}:${attempt}`;
  const [outcome, setOutcome] = useState<{ key: string; outcome: Outcome } | null>(null);

  const { file, source } = lookup;
  const supported = file !== null && isReaderSupported(file);

  useEffect(() => {
    if (file === null || source === null || !supported) return undefined;
    const controller = new AbortController();
    let docId: string | null = null;

    openDocument(source, { signal: controller.signal }).then(
      (document) => {
        if (controller.signal.aborted) {
          void closeDocument(document.docId);
          return;
        }
        docId = document.docId;
        recordOpened(file, document);
        setOutcome({ key, outcome: { status: 'ready', document } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const appError = toAppError(error);
        if (appError.code === 'UNKNOWN') reportError(error);
        setOutcome({ key, outcome: { status: 'error', code: appError.code } });
      },
    );

    return () => {
      controller.abort();
      const opened = docId;
      if (opened !== null) setTimeout(() => void closeDocument(opened), CLOSE_DELAY_MS);
    };
  }, [file, source, supported, key]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  let state: ReaderDocumentState;
  if (lookup.file === null) {
    state = { status: 'error', file: null, code: lookup.code, contentSource: false };
  } else if (!supported) {
    state = { status: 'unsupported', file: lookup.file };
  } else if (outcome?.key === key) {
    state =
      outcome.outcome.status === 'ready'
        ? { status: 'ready', file: lookup.file, document: outcome.outcome.document }
        : {
            status: 'error',
            file: lookup.file,
            code: outcome.outcome.code,
            contentSource: isContentPath(lookup.source),
          };
  } else {
    state = { status: 'loading', file: lookup.file };
  }
  return { state, retry };
}
