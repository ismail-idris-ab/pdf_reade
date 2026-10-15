import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getRepositories } from '@/db/client';
import type { FileRow } from '@/db/types';
import { reportError } from '@/lib/crash';
import { closeDocument, openDocument, type OpenedDocument } from '@/lib/engine';
import { AppError, toAppError } from '@/lib/errors';
import { bumpLibraryVersion } from '@/lib/library/version';

import { isContentPath, readableSource } from '../files/actions';
import type { ReaderOpenErrorCode } from './errorActions';
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
  /**
   * The file is password-protected. `checking`: a submitted password is being
   * tried. `failedAttempts`: passwords rejected since the prompt first
   * appeared (one more per WRONG_PASSWORD).
   */
  | { status: 'password'; file: FileRow; checking: boolean; failedAttempts: number }
  /** Not a PDF (Office and text viewing is T2.10). */
  | { status: 'unsupported'; file: FileRow }
  /**
   * `file` is null when the library row itself is gone (NOT_FOUND).
   * `contentSource`: the file was read through a content:// URI.
   */
  | { status: 'error'; file: FileRow | null; code: ReaderOpenErrorCode; contentSource: boolean };

export type ReaderDocument = {
  state: ReaderDocumentState;
  /**
   * Opens the document again (after an error). Never reuses a password: a
   * protected file asks for it again.
   */
  retry: () => void;
  /**
   * Tries to open the protected document with `password`. Ignored for an
   * empty password, while a try is running and outside the password state.
   */
  submitPassword: (password: string) => void;
};

type Lookup =
  { file: FileRow; source: string } | { file: null; source: null; code: ReaderOpenErrorCode };

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
  | { status: 'ready'; document: OpenedDocument }
  | { status: 'password' }
  | { status: 'error'; code: ReaderOpenErrorCode };

/**
 * What crash reporting gets for an unexpected open failure. An open that
 * carried a password is reported by code only: a native or bridge message
 * could echo the call's arguments, and the password must never leave the
 * device.
 */
export function reportableOpenError(error: unknown, withPassword: boolean): unknown {
  if (!withPassword) return error;
  const kind = error instanceof Error ? error.name : typeof error;
  return new AppError('UNKNOWN', `Opening a protected document failed (${kind})`);
}

type PendingPassword = { attempt: number; password: string };

/**
 * Starts the open for `attempt`, taking that attempt's password (if any) out
 * of `passwordRef`, so the ref no longer holds it and no caller's closure
 * does either: from here only the engine call keeps it, until it settles.
 */
function startOpen(
  source: string,
  passwordRef: { current: PendingPassword | null },
  attempt: number,
  signal: AbortSignal,
): { opening: Promise<OpenedDocument>; withPassword: boolean } {
  const pending = passwordRef.current;
  const password = pending?.attempt === attempt ? pending.password : undefined;
  if (password !== undefined) passwordRef.current = null;
  return {
    opening: openDocument(source, { password, signal }),
    withPassword: password !== undefined,
  };
}

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
 *
 * A password-protected file lands in the 'password' state; `submitPassword`
 * opens it again with that password. The password waits in a ref only until
 * that open starts, which takes it out (see startOpen); after that only the
 * engine call holds it, until the open settles. A retry or unmount clears a
 * password not yet taken. It is never stored, logged or reported, so every
 * later open (retry, reopening the file) asks again.
 *
 * Known limitation: for a content:// source every attempt copies the file to
 * the cache again natively (openDocument copies per call). Copying once per
 * prompt and reusing the copy is a follow-up.
 */
export function useReaderDocument(fileId: number | null): ReaderDocument {
  const [attempt, setAttempt] = useState(0);
  // The attempt that carries a password: the prompt stays up while it runs.
  const [passwordAttempt, setPasswordAttempt] = useState<number | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  // The password for one attempt. A ref, not state: no render keeps a copy.
  const passwordRef = useRef<PendingPassword | null>(null);
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
    // Only startOpen sees the password; this closure (kept by the cleanup
    // for the whole reading session) holds no reference to it.
    const { opening, withPassword } = startOpen(source, passwordRef, attempt, controller.signal);

    opening.then(
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
        const { code } = toAppError(error);
        if (code === 'UNKNOWN') reportError(reportableOpenError(error, withPassword));
        if (code === 'WRONG_PASSWORD') setFailedAttempts((count) => count + 1);
        setOutcome({
          key,
          outcome:
            code === 'PASSWORD_REQUIRED' || code === 'WRONG_PASSWORD'
              ? { status: 'password' }
              : { status: 'error', code },
        });
      },
    );

    return () => {
      controller.abort();
      const opened = docId;
      if (opened !== null) setTimeout(() => void closeDocument(opened), CLOSE_DELAY_MS);
    };
  }, [file, source, supported, key, attempt]);

  // Nothing of a password outlives the reader.
  useEffect(
    () => () => {
      passwordRef.current = null;
    },
    [],
  );

  const retry = useCallback(() => {
    passwordRef.current = null;
    setPasswordAttempt(null);
    setFailedAttempts(0);
    setAttempt((value) => value + 1);
  }, []);

  const current = outcome?.key === key ? outcome.outcome : null;
  const prompting = current?.status === 'password';
  const checking = current === null && passwordAttempt === attempt;

  const submitPassword = useCallback(
    (password: string) => {
      if (password.length === 0 || !prompting) return;
      const next = attempt + 1;
      passwordRef.current = { attempt: next, password };
      setPasswordAttempt(next);
      setAttempt(next);
    },
    [attempt, prompting],
  );

  let state: ReaderDocumentState;
  if (lookup.file === null) {
    state = { status: 'error', file: null, code: lookup.code, contentSource: false };
  } else if (!supported) {
    state = { status: 'unsupported', file: lookup.file };
  } else if (current === null) {
    state = checking
      ? { status: 'password', file: lookup.file, checking: true, failedAttempts }
      : { status: 'loading', file: lookup.file };
  } else if (current.status === 'ready') {
    state = { status: 'ready', file: lookup.file, document: current.document };
  } else if (current.status === 'password') {
    state = { status: 'password', file: lookup.file, checking: false, failedAttempts };
  } else {
    state = {
      status: 'error',
      file: lookup.file,
      code: current.code,
      contentSource: isContentPath(lookup.source),
    };
  }
  return { state, retry, submitPassword };
}
