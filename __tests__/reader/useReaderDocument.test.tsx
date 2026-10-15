import { act, renderHook, waitFor } from '@testing-library/react-native';

import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import { codedError, type FakePdfEngineModule } from '../engine/fakePdfEngine';
import { getRepositories } from '@/db/client';
import type { NewFile } from '@/db/types';
import {
  CLOSE_DELAY_MS,
  reportableOpenError,
  useReaderDocument,
} from '@/features/reader/useReaderDocument';
import { reportError } from '@/lib/crash';
import { AppError, ERROR_CODES } from '@/lib/errors';
import { useLibraryVersionStore } from '@/lib/library/version';

jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
  jest.requireActual('../engine/fakePdfEngine').createFakePdfEngineModule(),
);
jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);
jest.mock('@/lib/crash', () => ({
  ...jest.requireActual<typeof import('@/lib/crash')>('@/lib/crash'),
  reportError: jest.fn(),
}));
jest.mock('@/db/client', () => {
  const { createTestDatabase } =
    jest.requireActual<typeof import('../db/testDatabase')>('../db/testDatabase');
  const { createRepositories } =
    jest.requireActual<typeof import('@/db/repositories')>('@/db/repositories');
  const repositories = createRepositories(createTestDatabase().db);
  return { getRepositories: () => repositories, getDatabase: jest.fn() };
});

const engine = PdfEngineModule as unknown as FakePdfEngineModule;

function addFile(overrides: Partial<NewFile> = {}) {
  return getRepositories().files.upsert({
    path: '/storage/emulated/0/Download/report.pdf',
    uri: null,
    name: 'report.pdf',
    ext: 'pdf',
    mime: 'application/pdf',
    size: 100,
    mtime: 1,
    source: 'downloads',
    ...overrides,
  });
}

const flush = () => act(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  engine.reset();
  for (const row of getRepositories().files.listIndexEntries()) {
    getRepositories().files.remove(row.id);
  }
});

describe('useReaderDocument', () => {
  it('opens the file from its path, marks it opened and closes it on unmount', async () => {
    const file = addFile();
    const version = useLibraryVersionStore.getState().version;
    const { result, unmount } = await renderHook(() => useReaderDocument(file.id));
    await flush();

    expect(engine.open).toHaveBeenCalledWith(file.path, null, expect.any(String));
    const { state } = result.current;
    if (state.status !== 'ready') throw new Error(`expected ready, got ${state.status}`);
    expect(state.document.pageCount).toBe(3);
    expect(engine.openDocIds()).toEqual([state.document.docId]);

    const row = getRepositories().files.getById(file.id);
    expect(row?.lastOpenedAt).toEqual(expect.any(Number));
    expect(row?.pageCount).toBe(3);
    expect(useLibraryVersionStore.getState().version).toBeGreaterThan(version);

    await unmount();
    // Closed CLOSE_DELAY_MS later, so the page views detach first.
    expect(engine.close).not.toHaveBeenCalled();
    await waitFor(() => expect(engine.close).toHaveBeenCalledWith(state.document.docId), {
      timeout: CLOSE_DELAY_MS * 8,
    });
    expect(engine.openDocIds()).toEqual([]);
  });

  it('opens a picked file through its content:// URI', async () => {
    const file = addFile({ path: 'content://provider/doc/9', source: 'device' });
    await renderHook(() => useReaderDocument(file.id));
    await flush();
    expect(engine.open).toHaveBeenCalledWith('content://provider/doc/9', null, expect.any(String));
  });

  it('says whether a failed file was read through a content:// URI', async () => {
    const file = addFile({ path: 'content://provider/doc/9', source: 'device' });
    engine.open.mockRejectedValueOnce(codedError('PERMISSION_DENIED'));
    const { result } = await renderHook(() => useReaderDocument(file.id));
    await flush();
    expect(result.current.state).toMatchObject({
      status: 'error',
      code: 'PERMISSION_DENIED',
      contentSource: true,
    });
  });

  it('aborts an open still running at unmount, leaving nothing open', async () => {
    engine.setHoldOpens(true);
    const file = addFile();
    const { result, unmount } = await renderHook(() => useReaderDocument(file.id));
    expect(result.current.state).toMatchObject({ status: 'loading', file: { id: file.id } });
    const [openId] = engine.pendingOpenIds();
    expect(openId).toBeDefined();

    await unmount();
    expect(engine.cancelOpen).toHaveBeenCalledWith(openId);
    expect(engine.openDocIds()).toEqual([]);
    expect(getRepositories().files.getById(file.id)?.lastOpenedAt).toBeNull();
  });

  it.each([
    ...ERROR_CODES.filter(
      (code) => code !== 'CANCELLED' && code !== 'PASSWORD_REQUIRED' && code !== 'WRONG_PASSWORD',
    ),
    'UNKNOWN',
  ])('reports %s as an error state without marking the file opened', async (code) => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError(code === 'UNKNOWN' ? 'ERR_BRIDGE' : code));
    const { result } = await renderHook(() => useReaderDocument(file.id));
    await flush();
    expect(result.current.state).toMatchObject({ status: 'error', code, contentSource: false });
    expect(getRepositories().files.getById(file.id)?.lastOpenedAt).toBeNull();
  });

  it('retries after an error and opens the document', async () => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('OUT_OF_MEMORY'));
    const { result } = await renderHook(() => useReaderDocument(file.id));
    await flush();
    expect(result.current.state).toMatchObject({ status: 'error', code: 'OUT_OF_MEMORY' });

    await act(async () => result.current.retry());
    await flush();
    expect(result.current.state.status).toBe('ready');
    expect(engine.open).toHaveBeenCalledTimes(2);
  });

  it('closes the previous document when retried while open', async () => {
    const file = addFile();
    const { result } = await renderHook(() => useReaderDocument(file.id));
    await flush();
    const first = result.current.state.status === 'ready' ? result.current.state.document : null;
    await act(async () => result.current.retry());
    await flush();
    await waitFor(() => expect(engine.close).toHaveBeenCalledWith(first?.docId), {
      timeout: CLOSE_DELAY_MS * 8,
    });
    expect(engine.openDocIds()).toHaveLength(1);
  });

  it('answers NOT_FOUND for a missing row or an invalid id, without opening', async () => {
    const missing = await renderHook(() => useReaderDocument(9999));
    expect(missing.result.current.state).toEqual({
      status: 'error',
      file: null,
      code: 'NOT_FOUND',
      contentSource: false,
    });
    const invalid = await renderHook(() => useReaderDocument(null));
    expect(invalid.result.current.state).toMatchObject({ status: 'error', code: 'NOT_FOUND' });
    expect(engine.open).not.toHaveBeenCalled();
  });

  it.each(['docx', 'xlsx', 'csv', 'txt'])('does not open a .%s file (unsupported)', async (ext) => {
    const file = addFile({ path: `/storage/emulated/0/Download/notes.${ext}`, ext });
    const { result } = await renderHook(() => useReaderDocument(file.id));
    await flush();
    expect(result.current.state).toMatchObject({ status: 'unsupported' });
    expect(engine.open).not.toHaveBeenCalled();
  });
});

const SECRET = 'hunter2-secret';

describe('useReaderDocument — password-protected files', () => {
  it('asks for a password, opens with it, and drops it once the open settles', async () => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    const { result } = await renderHook(() => useReaderDocument(file.id));
    await flush();
    expect(result.current.state).toMatchObject({
      status: 'password',
      checking: false,
      failedAttempts: 0,
    });
    expect(engine.open).toHaveBeenLastCalledWith(file.path, null, expect.any(String));
    expect(getRepositories().files.getById(file.id)?.lastOpenedAt).toBeNull();

    await act(async () => result.current.submitPassword(SECRET));
    await flush();
    expect(engine.open).toHaveBeenLastCalledWith(file.path, SECRET, expect.any(String));
    expect(result.current.state.status).toBe('ready');
    expect(getRepositories().files.getById(file.id)?.lastOpenedAt).toEqual(expect.any(Number));
    // The hook's result holds no copy of the password.
    expect(JSON.stringify(result.current.state)).not.toContain(SECRET);
  });

  it('keeps the prompt while checking and counts each wrong password, unlimited', async () => {
    engine.setHoldOpens(true);
    const file = addFile();
    const { result } = await renderHook(() => useReaderDocument(file.id));
    await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'PASSWORD_REQUIRED'));

    for (let tries = 1; tries <= 4; tries += 1) {
      await act(async () => result.current.submitPassword(`wrong-${tries}`));
      expect(result.current.state).toMatchObject({
        status: 'password',
        checking: true,
        failedAttempts: tries - 1,
      });
      // A second submit while checking is ignored.
      await act(async () => result.current.submitPassword('again'));
      expect(engine.pendingOpenIds()).toHaveLength(1);
      await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'WRONG_PASSWORD'));
      expect(result.current.state).toMatchObject({
        status: 'password',
        checking: false,
        failedAttempts: tries,
      });
    }
    expect(engine.open).toHaveBeenCalledTimes(5);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('ignores an empty password', async () => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    const { result } = await renderHook(() => useReaderDocument(file.id));
    await flush();
    await act(async () => result.current.submitPassword(''));
    expect(engine.open).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ status: 'password', checking: false });
  });

  it('goes to the error state for another failure, and Try again asks for the password again', async () => {
    const file = addFile();
    engine.open
      .mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'))
      .mockRejectedValueOnce(codedError('OUT_OF_MEMORY'))
      .mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    const { result } = await renderHook(() => useReaderDocument(file.id));
    await flush();
    await act(async () => result.current.submitPassword(SECRET));
    await flush();
    expect(result.current.state).toMatchObject({ status: 'error', code: 'OUT_OF_MEMORY' });

    await act(async () => result.current.retry());
    await flush();
    // The retry carries no password: the prompt is back, with no stale error.
    expect(engine.open).toHaveBeenLastCalledWith(file.path, null, expect.any(String));
    expect(result.current.state).toMatchObject({ status: 'password', failedAttempts: 0 });
  });

  it('reports an unexpected failure of a password open by code only', async () => {
    const file = addFile();
    engine.open
      .mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'))
      .mockRejectedValueOnce(codedError('ERR_BRIDGE', `cannot convert argument "${SECRET}"`));
    const { result } = await renderHook(() => useReaderDocument(file.id));
    await flush();
    await act(async () => result.current.submitPassword(SECRET));
    await flush();
    expect(result.current.state).toMatchObject({ status: 'error', code: 'UNKNOWN' });
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = jest.mocked(reportError).mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(AppError);
    expect((reported as AppError).message).not.toContain(SECRET);
    expect((reported as AppError).cause).toBeUndefined();
  });

  it('aborts a password open still running at unmount, leaving nothing open', async () => {
    engine.setHoldOpens(true);
    const file = addFile();
    const { result, unmount } = await renderHook(() => useReaderDocument(file.id));
    await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'PASSWORD_REQUIRED'));
    await act(async () => result.current.submitPassword(SECRET));
    const [openId] = engine.pendingOpenIds();
    expect(openId).toBeDefined();

    await unmount();
    expect(engine.cancelOpen).toHaveBeenCalledWith(openId);
    expect(engine.openDocIds()).toEqual([]);
    expect(getRepositories().files.getById(file.id)?.lastOpenedAt).toBeNull();
  });

  it('asks again when the file is opened again later', async () => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    const first = await renderHook(() => useReaderDocument(file.id));
    await flush();
    await act(async () => first.result.current.submitPassword(SECRET));
    await flush();
    expect(first.result.current.state.status).toBe('ready');
    await first.unmount();

    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    const second = await renderHook(() => useReaderDocument(file.id));
    await flush();
    expect(engine.open).toHaveBeenLastCalledWith(file.path, null, expect.any(String));
    expect(second.result.current.state).toMatchObject({ status: 'password' });
  });
});

describe('reportableOpenError', () => {
  it('passes an error through when no password was given', () => {
    const error = new Error('boom');
    expect(reportableOpenError(error, false)).toBe(error);
  });

  it('replaces it with a code-only error when a password was given', () => {
    const reported = reportableOpenError(new TypeError(`bad ${SECRET}`), true);
    expect(reported).toBeInstanceOf(AppError);
    expect((reported as AppError).code).toBe('UNKNOWN');
    expect((reported as AppError).message).toBe('Opening a protected document failed (TypeError)');
  });
});
