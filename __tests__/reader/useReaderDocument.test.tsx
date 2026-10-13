import { act, renderHook, waitFor } from '@testing-library/react-native';

import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import { codedError, type FakePdfEngineModule } from '../engine/fakePdfEngine';
import { getRepositories } from '@/db/client';
import type { NewFile } from '@/db/types';
import { CLOSE_DELAY_MS, useReaderDocument } from '@/features/reader/useReaderDocument';
import { ERROR_CODES } from '@/lib/errors';
import { useLibraryVersionStore } from '@/lib/library/version';

jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
  jest.requireActual('../engine/fakePdfEngine').createFakePdfEngineModule(),
);
jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);
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

  it.each([...ERROR_CODES.filter((code) => code !== 'CANCELLED'), 'UNKNOWN'])(
    'reports %s as an error state without marking the file opened',
    async (code) => {
      const file = addFile();
      engine.open.mockRejectedValueOnce(codedError(code === 'UNKNOWN' ? 'ERR_BRIDGE' : code));
      const { result } = await renderHook(() => useReaderDocument(file.id));
      await flush();
      expect(result.current.state).toMatchObject({ status: 'error', code, contentSource: false });
      expect(getRepositories().files.getById(file.id)?.lastOpenedAt).toBeNull();
    },
  );

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
