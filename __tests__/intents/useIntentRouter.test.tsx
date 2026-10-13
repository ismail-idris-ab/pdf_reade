import { renderHook } from '@testing-library/react-native';

import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { getRepositories } from '@/db/client';
import { useReceivedImagesStore } from '@/features/intents/store';
import { useIntentRouter } from '@/features/intents/useIntentRouter';
import { useOnboardingStore } from '@/features/onboarding/store';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);

jest.mock('@/db/client', () => {
  const { createTestDatabase: createTestDb } =
    jest.requireActual<typeof import('../db/testDatabase')>('../db/testDatabase');
  const { createRepositories } =
    jest.requireActual<typeof import('@/db/repositories')>('@/db/repositories');
  const repositories = createRepositories(createTestDb().db);
  return { getRepositories: () => repositories, getDatabase: jest.fn() };
});

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const native = FileIndexModule as unknown as FakeFileIndexModule;
// Several microtask hops happen between an emitted intent and router.replace
// (copy -> classify -> db -> route), so this is awaited more than once.
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

function viewIntent(path: string) {
  return { action: 'view' as const, uris: [`content://p/${path}`], mimeType: 'application/pdf' };
}

function document(path: string, name: string, mime = 'application/pdf') {
  return { path, name, nameFromProvider: true, size: 10, mime };
}

beforeEach(() => {
  jest.clearAllMocks();
  useOnboardingStore.setState({ onboardingComplete: true });
  useReceivedImagesStore.setState({ images: [] });
  native.setLaunchIntent(null);
  for (const row of getRepositories().files.listIndexEntries()) {
    getRepositories().files.remove(row.id);
  }
});

describe('useIntentRouter — cold start', () => {
  it('reads the launch intent once and routes to the reader', async () => {
    native.setLaunchIntent(viewIntent('a'));
    native.copyContentUriToCache.mockResolvedValueOnce(document('/cache/a.pdf', 'a.pdf'));

    renderHook(() => useIntentRouter());
    await flush();

    expect(native.getLaunchIntent).toHaveBeenCalledTimes(1);
    const fileId = getRepositories().files.getByPath('/cache/a.pdf')?.id;
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/reader/[fileId]',
      params: { fileId: String(fileId) },
    });
  });

  it('does nothing on a normal launch (no intent)', async () => {
    renderHook(() => useIntentRouter());
    await flush();

    expect(native.getLaunchIntent).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('processes the hand-off exactly once, even across a remount', async () => {
    native.setLaunchIntent(viewIntent('a'));
    native.copyContentUriToCache.mockResolvedValueOnce(document('/cache/a.pdf', 'a.pdf'));

    const { unmount } = await renderHook(() => useIntentRouter());
    await flush();
    expect(mockReplace).toHaveBeenCalledTimes(1);

    await unmount();
    // getLaunchIntent already consumed the intent natively (returns null now);
    // a remount must not show it, or process it, a second time.
    renderHook(() => useIntentRouter());
    await flush();

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(native.copyContentUriToCache).toHaveBeenCalledTimes(1);
  });
});

describe('useIntentRouter — warm start', () => {
  it('routes an intent that arrives while mounted', async () => {
    native.copyContentUriToCache.mockResolvedValueOnce(document('/cache/warm.pdf', 'warm.pdf'));

    renderHook(() => useIntentRouter());
    await flush();
    expect(mockReplace).not.toHaveBeenCalled();

    native.emitIncomingIntent(viewIntent('warm'));
    await flush();

    const fileId = getRepositories().files.getByPath('/cache/warm.pdf')?.id;
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/reader/[fileId]',
      params: { fileId: String(fileId) },
    });
  });

  it('stops routing after unmount (unsubscribes)', async () => {
    const { unmount } = await renderHook(() => useIntentRouter());
    await flush();
    await unmount();

    native.emitIncomingIntent(viewIntent('late'));
    await flush();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('hands SEND_MULTIPLE images off to /image-to-pdf without touching the library', async () => {
    native.copyContentUriToCache.mockResolvedValueOnce(
      document('/cache/img1.jpg', 'img1.jpg', 'image/jpeg'),
    );
    native.copyContentUriToCache.mockResolvedValueOnce(
      document('/cache/img2.jpg', 'img2.jpg', 'image/jpeg'),
    );

    renderHook(() => useIntentRouter());
    await flush();
    native.emitIncomingIntent({
      action: 'send',
      uris: ['content://p/img1', 'content://p/img2'],
      mimeType: 'image/jpeg',
    });
    await flush();

    expect(mockReplace).toHaveBeenCalledWith('/image-to-pdf');
    expect(useReceivedImagesStore.getState().images).toEqual([
      { path: '/cache/img1.jpg', name: 'img1.jpg', size: 10 },
      { path: '/cache/img2.jpg', name: 'img2.jpg', size: 10 },
    ]);
    expect(getRepositories().files.countAll()).toBe(0);
  });

  describe('a SEND of several documents (library target)', () => {
    it('opens the library once onboarding is complete', async () => {
      useOnboardingStore.setState({ onboardingComplete: true });
      native.copyContentUriToCache.mockResolvedValueOnce(document('/cache/a.pdf', 'a.pdf'));
      native.copyContentUriToCache.mockResolvedValueOnce(document('/cache/b.pdf', 'b.pdf'));

      renderHook(() => useIntentRouter());
      await flush();
      native.emitIncomingIntent({
        action: 'send',
        uris: ['content://p/a', 'content://p/b'],
        mimeType: 'application/pdf',
      });
      await flush();

      expect(mockReplace).toHaveBeenCalledWith('/');
    });

    it('falls back to the reader for the first file when onboarding is not complete yet', async () => {
      // The library route sits behind the onboarding guard; a user who just
      // handed over several files must not be bounced to onboarding and lose
      // them, so this opens the first file instead (see useIntentRouter).
      useOnboardingStore.setState({ onboardingComplete: false });
      native.copyContentUriToCache.mockResolvedValueOnce(document('/cache/a.pdf', 'a.pdf'));
      native.copyContentUriToCache.mockResolvedValueOnce(document('/cache/b.pdf', 'b.pdf'));

      renderHook(() => useIntentRouter());
      await flush();
      native.emitIncomingIntent({
        action: 'send',
        uris: ['content://p/a', 'content://p/b'],
        mimeType: 'application/pdf',
      });
      await flush();

      const firstId = getRepositories().files.getByPath('/cache/a.pdf')?.id;
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/reader/[fileId]',
        params: { fileId: String(firstId) },
      });
      // Still not onboarded: the bypass never marks onboarding complete.
      expect(useOnboardingStore.getState().onboardingComplete).toBe(false);
    });
  });
});
