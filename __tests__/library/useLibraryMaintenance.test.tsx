import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { getRepositories } from '@/db/client';
import { useAllFilesAccessStore } from '@/lib/files';
import { isIndexing } from '@/lib/library';
import { useLibraryMaintenance } from '@/lib/library/useLibraryMaintenance';

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

const native = FileIndexModule as unknown as FakeFileIndexModule;
let appStateListeners: ((state: AppStateStatus) => void)[] = [];

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  appStateListeners = [];
  useAllFilesAccessStore.setState({ granted: null });
  native.hasAllFilesAccess.mockImplementation(() => false);
  native.startScan.mockImplementation(() => Promise.resolve('scan-1'));
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'change') appStateListeners.push(listener as (state: AppStateStatus) => void);
    return { remove: jest.fn() };
  });
});

afterEach(async () => {
  // Let any scan this test started finish, so runs never leak across tests.
  if (isIndexing()) {
    await act(async () => {
      native.emitComplete({
        scanId: 'scan-1',
        scanned: 0,
        emitted: 0,
        deleted: [],
        skippedDirs: 0,
        durationMs: 1,
        cancelled: false,
      });
    });
  }
  jest.restoreAllMocks();
});

describe('useLibraryMaintenance', () => {
  it('does nothing before onboarding is complete', async () => {
    native.hasAllFilesAccess.mockImplementation(() => true);
    await renderHook(() => useLibraryMaintenance(false));
    await flush();
    expect(native.listPersistedUris).not.toHaveBeenCalled();
    expect(native.startScan).not.toHaveBeenCalled();
  });

  it('prunes picked rows whose grant was lost, without scanning while access is missing', async () => {
    getRepositories().files.upsert({
      path: 'content://p/lost',
      uri: 'content://p/lost',
      name: 'lost.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 1,
      mtime: 1,
      source: 'device',
    });
    await renderHook(() => useLibraryMaintenance(true));
    await flush();
    expect(native.listPersistedUris).toHaveBeenCalled();
    expect(getRepositories().files.getByPath('content://p/lost')).toBeUndefined();
    expect(native.startScan).not.toHaveBeenCalled();
  });

  it('starts a scan when access is granted while the app is running', async () => {
    await renderHook(() => useLibraryMaintenance(true));
    await flush();
    expect(native.startScan).not.toHaveBeenCalled();

    // The user grants access in Settings and comes back.
    native.hasAllFilesAccess.mockImplementation(() => true);
    await act(async () => {
      for (const listener of appStateListeners) listener('active');
    });
    await flush();
    expect(native.startScan).toHaveBeenCalledTimes(1);
    expect(isIndexing()).toBe(true);
  });
});
