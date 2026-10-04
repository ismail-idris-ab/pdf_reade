import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import type { FakeFileIndexModule } from './fakeFileIndex';
import { useAllFilesAccess, useAllFilesAccessStore } from '@/lib/files';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('./fakeFileIndex').createFakeFileIndexModule(),
);

const native = FileIndexModule as unknown as FakeFileIndexModule;

let appStateListeners: ((state: AppStateStatus) => void)[] = [];
const removeListener = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  appStateListeners = [];
  useAllFilesAccessStore.setState({ granted: null });
  native.hasAllFilesAccess.mockImplementation(() => false);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'change') appStateListeners.push(listener as (state: AppStateStatus) => void);
    return { remove: removeListener };
  });
});

afterEach(() => jest.restoreAllMocks());

const emitAppState = (state: AppStateStatus) => {
  for (const listener of appStateListeners) listener(state);
};

describe('useAllFilesAccess', () => {
  it('reads the permission on mount', async () => {
    const { result } = await renderHook(() => useAllFilesAccess());
    expect(native.hasAllFilesAccess).toHaveBeenCalled();
    expect(result.current.granted).toBe(false);
  });

  it('re-checks when the app becomes active again', async () => {
    const { result } = await renderHook(() => useAllFilesAccess());
    native.hasAllFilesAccess.mockClear();
    native.hasAllFilesAccess.mockImplementation(() => true);

    await act(async () => emitAppState('background'));
    expect(native.hasAllFilesAccess).not.toHaveBeenCalled();
    expect(result.current.granted).toBe(false);

    await act(async () => emitAppState('active'));
    expect(native.hasAllFilesAccess).toHaveBeenCalledTimes(1);
    expect(result.current.granted).toBe(true);
  });

  it('stops listening on unmount', async () => {
    const { unmount } = await renderHook(() => useAllFilesAccess());
    await unmount();
    expect(removeListener).toHaveBeenCalled();
  });

  it('requestAccess opens Settings, then re-checks', async () => {
    const { result } = await renderHook(() => useAllFilesAccess());
    native.openAllFilesAccessSettings.mockImplementationOnce(() => {
      native.hasAllFilesAccess.mockImplementation(() => true);
      return Promise.resolve();
    });
    let granted: boolean | undefined;
    await act(async () => {
      granted = await result.current.requestAccess();
    });
    expect(native.openAllFilesAccessSettings).toHaveBeenCalledTimes(1);
    expect(granted).toBe(true);
    expect(result.current.granted).toBe(true);
  });

  it('requestAccess rejects with an AppError when Settings cannot open', async () => {
    const { result } = await renderHook(() => useAllFilesAccess());
    native.openAllFilesAccessSettings.mockRejectedValueOnce(
      Object.assign(new Error('no activity'), { code: 'ERR_NO_ACTIVITY' }),
    );
    await expect(result.current.requestAccess()).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNKNOWN',
    });
  });

  it('treats a failed check as not granted', async () => {
    native.hasAllFilesAccess.mockImplementation(() => {
      throw new Error('native failure');
    });
    const { result } = await renderHook(() => useAllFilesAccess());
    expect(result.current.granted).toBe(false);
  });
});
