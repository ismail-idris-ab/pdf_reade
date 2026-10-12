import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import { createTestDatabase } from '../db/testDatabase';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { useToastStore } from '@/components/ui';
import { createRepositories } from '@/db/repositories';
import { handleIncomingIntent } from '@/features/intents/handleIncomingIntent';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);

const native = FileIndexModule as unknown as FakeFileIndexModule;
const nativeError = (code: string) => Object.assign(new Error('native failure'), { code });

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ current: null });
});

describe('handleIncomingIntent', () => {
  it('returns the route target on success, without toasting', async () => {
    const repos = createRepositories(createTestDatabase().db);
    native.copyContentUriToCache.mockResolvedValueOnce({
      path: '/cache/a.pdf',
      name: 'a.pdf',
      nameFromProvider: true,
      size: 10,
      mime: 'application/pdf',
    });

    const target = await handleIncomingIntent(repos, {
      action: 'view',
      uris: ['content://p/a'],
      mimeType: 'application/pdf',
    });

    expect(target).toEqual({ type: 'open', fileId: expect.any(Number) });
    expect(useToastStore.getState().current).toBeNull();
  });

  it('shows NOT_FOUND as a toast and returns null, instead of throwing', async () => {
    const repos = createRepositories(createTestDatabase().db);
    native.copyContentUriToCache.mockRejectedValueOnce(nativeError('NOT_FOUND'));

    const target = await handleIncomingIntent(repos, {
      action: 'view',
      uris: ['content://p/gone'],
      mimeType: 'application/pdf',
    });

    expect(target).toBeNull();
    expect(useToastStore.getState().current?.message).toMatch(/not found/i);
  });

  it('shows PERMISSION_DENIED with an "Open Settings" action', async () => {
    const repos = createRepositories(createTestDatabase().db);
    native.copyContentUriToCache.mockRejectedValueOnce(nativeError('PERMISSION_DENIED'));

    const target = await handleIncomingIntent(repos, {
      action: 'view',
      uris: ['content://p/x'],
      mimeType: 'application/pdf',
    });

    expect(target).toBeNull();
    expect(useToastStore.getState().current?.actionLabel).toBe('Open Settings');
  });

  it('shows NO_SPACE as a toast', async () => {
    const repos = createRepositories(createTestDatabase().db);
    native.copyContentUriToCache.mockRejectedValueOnce(nativeError('NO_SPACE'));

    await handleIncomingIntent(repos, {
      action: 'view',
      uris: ['content://p/x'],
      mimeType: 'application/pdf',
    });

    expect(useToastStore.getState().current?.message).toMatch(/out of storage/i);
  });

  it('shows nothing for CANCELLED', async () => {
    const repos = createRepositories(createTestDatabase().db);
    native.copyContentUriToCache.mockRejectedValueOnce(nativeError('CANCELLED'));

    await handleIncomingIntent(repos, {
      action: 'view',
      uris: ['content://p/x'],
      mimeType: 'application/pdf',
    });

    expect(useToastStore.getState().current).toBeNull();
  });

  it('shows UNSUPPORTED as a toast for an unknown MIME type', async () => {
    const repos = createRepositories(createTestDatabase().db);
    native.copyContentUriToCache.mockResolvedValueOnce({
      path: '/cache/x.bin',
      name: 'x.bin',
      nameFromProvider: true,
      size: 10,
      mime: 'application/octet-stream',
    });

    const target = await handleIncomingIntent(repos, {
      action: 'view',
      uris: ['content://p/x'],
      mimeType: 'application/octet-stream',
    });

    expect(target).toBeNull();
    expect(useToastStore.getState().current?.message).toMatch(/isn.t supported/i);
  });
});
