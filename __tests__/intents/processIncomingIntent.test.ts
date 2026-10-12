import type { CachedContent, IncomingIntent } from '../../modules/file-index/src/FileIndexModule';
import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import { createTestDatabase } from '../db/testDatabase';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { createRepositories, type Repositories } from '@/db/repositories';
import { processIncomingIntent } from '@/features/intents/processIncomingIntent';
import { AppError } from '@/lib/errors';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);

const native = FileIndexModule as unknown as FakeFileIndexModule;
const nativeError = (code: string) => Object.assign(new Error('native failure'), { code });

function setup(): Repositories {
  return createRepositories(createTestDatabase().db);
}

function content(overrides: Partial<CachedContent> = {}): CachedContent {
  return {
    path: '/cache/intent/doc.pdf',
    name: 'doc.pdf',
    nameFromProvider: true,
    size: 100,
    mime: 'application/pdf',
    ...overrides,
  };
}

function viewIntent(uris: string[], mimeType: string | null = null): IncomingIntent {
  return { action: 'view', uris, mimeType };
}

function sendIntent(uris: string[], mimeType: string | null = null): IncomingIntent {
  return { action: 'send', uris, mimeType };
}

const options = { now: () => 42_000, fallbackName: 'Untitled document' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('processIncomingIntent — documents', () => {
  it('copies the uri and stores the row by cache path with uri null', async () => {
    const repos = setup();
    native.copyContentUriToCache.mockResolvedValueOnce(content());

    const target = await processIncomingIntent(repos, viewIntent(['content://p/doc']), options);

    expect(native.copyContentUriToCache).toHaveBeenCalledWith('content://p/doc');
    expect(target).toEqual({ type: 'open', fileId: expect.any(Number) });
    const row = repos.files.getByPath('/cache/intent/doc.pdf');
    expect(row).toMatchObject({
      path: '/cache/intent/doc.pdf',
      uri: null, // critical: never the transient content:// URI (T1.2/T1.3 rule)
      name: 'doc.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 100,
      mtime: 42_000,
      source: 'device',
    });
  });

  it('shows a localized fallback name when the provider gave none', async () => {
    const repos = setup();
    native.copyContentUriToCache.mockResolvedValueOnce(
      content({ name: 'document.pdf', nameFromProvider: false }),
    );

    await processIncomingIntent(repos, viewIntent(['content://p/doc']), options);

    expect(repos.files.getByPath('/cache/intent/doc.pdf')?.name).toBe('Untitled document');
  });

  it('dedupes against a row the storage scan already indexed (name + size)', async () => {
    const repos = setup();
    repos.files.upsert({
      path: '/storage/emulated/0/Download/report.pdf',
      uri: null,
      name: 'report.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 100,
      mtime: 1_000,
      source: 'downloads',
    });
    native.copyContentUriToCache.mockResolvedValueOnce(
      content({ path: '/cache/intent/report.pdf', name: 'report.pdf', size: 100 }),
    );

    const target = await processIncomingIntent(repos, viewIntent(['content://p/report']), options);

    // Reuses the existing scanned row; no second row was created for the cache copy.
    expect(repos.files.countAll()).toBe(1);
    expect(target).toEqual({
      type: 'open',
      fileId: repos.files.getByPath('/storage/emulated/0/Download/report.pdf')?.id,
    });
  });

  it('sends several documents to the library, by the first row as a fallback', async () => {
    const repos = setup();
    native.copyContentUriToCache.mockResolvedValueOnce(
      content({ path: '/cache/a.pdf', name: 'a.pdf' }),
    );
    native.copyContentUriToCache.mockResolvedValueOnce(
      content({ path: '/cache/b.pdf', name: 'b.pdf' }),
    );

    const target = await processIncomingIntent(
      repos,
      sendIntent(['content://p/a', 'content://p/b']),
      options,
    );

    expect(repos.files.countAll()).toBe(2);
    expect(target).toEqual({
      type: 'library',
      firstFileId: repos.files.getByPath('/cache/a.pdf')?.id,
    });
  });

  it('classifies a document by its name when the provider reports no MIME type', async () => {
    const repos = setup();
    native.copyContentUriToCache.mockResolvedValueOnce(
      content({ path: '/cache/report.docx', name: 'report.docx', mime: null }),
    );

    const target = await processIncomingIntent(repos, viewIntent(['content://p/doc']), options);

    expect(target).toEqual({ type: 'open', fileId: expect.any(Number) });
    expect(repos.files.getByPath('/cache/report.docx')).toMatchObject({ ext: 'docx' });
  });
});

describe('processIncomingIntent — images', () => {
  it('hands off a 5-image SEND_MULTIPLE without touching the library', async () => {
    const repos = setup();
    const uris = Array.from({ length: 5 }, (_, i) => `content://p/img${i}`);
    for (let i = 0; i < 5; i += 1) {
      native.copyContentUriToCache.mockResolvedValueOnce(
        content({
          path: `/cache/img${i}.jpg`,
          name: `img${i}.jpg`,
          mime: 'image/jpeg',
          size: 10 + i,
        }),
      );
    }

    const target = await processIncomingIntent(repos, sendIntent(uris), options);

    expect(target).toEqual({
      type: 'imageToPdf',
      images: Array.from({ length: 5 }, (_, i) => ({
        path: `/cache/img${i}.jpg`,
        name: `img${i}.jpg`,
        size: 10 + i,
      })),
    });
    expect(repos.files.countAll()).toBe(0);
  });

  it('shows a localized fallback name for an image the provider named nothing', async () => {
    const repos = setup();
    native.copyContentUriToCache.mockResolvedValueOnce(
      content({
        path: '/cache/img.jpg',
        name: 'image.jpg',
        nameFromProvider: false,
        mime: 'image/jpeg',
      }),
    );

    const target = await processIncomingIntent(repos, sendIntent(['content://p/img']), options);

    expect(target).toMatchObject({
      type: 'imageToPdf',
      images: [{ path: '/cache/img.jpg', name: 'Untitled document', size: 100 }],
    });
  });
});

describe('processIncomingIntent — unsupported and errors', () => {
  it('rejects an unknown MIME type as UNSUPPORTED', async () => {
    const repos = setup();
    native.copyContentUriToCache.mockResolvedValueOnce(
      content({
        path: '/cache/unknown.bin',
        name: 'unknown.bin',
        mime: 'application/octet-stream',
      }),
    );

    await expect(
      processIncomingIntent(repos, viewIntent(['content://p/x']), options),
    ).rejects.toMatchObject({ name: 'AppError', code: 'UNSUPPORTED' });
    expect(repos.files.countAll()).toBe(0);
  });

  it('rejects a mixed batch of documents and images as UNSUPPORTED', async () => {
    const repos = setup();
    native.copyContentUriToCache.mockResolvedValueOnce(
      content({ path: '/cache/a.pdf', name: 'a.pdf' }),
    );
    native.copyContentUriToCache.mockResolvedValueOnce(
      content({ path: '/cache/b.jpg', name: 'b.jpg', mime: 'image/jpeg' }),
    );

    await expect(
      processIncomingIntent(repos, sendIntent(['content://p/a', 'content://p/b']), options),
    ).rejects.toMatchObject({ name: 'AppError', code: 'UNSUPPORTED' });
  });

  it.each(['NOT_FOUND', 'PERMISSION_DENIED', 'NO_SPACE', 'CANCELLED'])(
    'propagates a %s failure from copyContentUriToCache',
    async (code) => {
      const repos = setup();
      native.copyContentUriToCache.mockRejectedValueOnce(nativeError(code));

      await expect(
        processIncomingIntent(repos, viewIntent(['content://p/x']), options),
      ).rejects.toMatchObject({ name: 'AppError', code });
      expect(repos.files.countAll()).toBe(0);
    },
  );

  it('throws an AppError, not a raw error, when it is not already one', async () => {
    const repos = setup();
    native.copyContentUriToCache.mockRejectedValueOnce(new Error('boom'));

    const error = await processIncomingIntent(repos, viewIntent(['content://p/x']), options).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('UNKNOWN');
  });
});

describe('processIncomingIntent — file:// hand-offs', () => {
  const DL = '/storage/emulated/0/Download';

  beforeEach(() => {
    native.resetFs();
  });

  it('uses the path as it lies, without copying it to the cache', async () => {
    const repos = setup();
    native.addFile(`${DL}/report.pdf`, 2_048, 1_700_000_000_000);

    const target = await processIncomingIntent(
      repos,
      viewIntent([`file://${DL}/report.pdf`]),
      options,
    );

    expect(native.copyContentUriToCache).not.toHaveBeenCalled();
    expect(target).toEqual({ type: 'open', fileId: expect.any(Number) });
    expect(repos.files.getByPath(`${DL}/report.pdf`)).toMatchObject({
      path: `${DL}/report.pdf`,
      uri: null,
      name: 'report.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 2_048,
      // Its own mtime, not options.now() — the file is the original.
      mtime: 1_700_000_000_000,
    });
  });

  it('decodes percent-escapes in the path', async () => {
    const repos = setup();
    native.addFile(`${DL}/my report.pdf`, 10, 5_000);

    await processIncomingIntent(repos, viewIntent([`file://${DL}/my%20report.pdf`]), options);

    expect(repos.files.getByPath(`${DL}/my report.pdf`)?.name).toBe('my report.pdf');
  });

  it('reuses the row the scan already indexed for the same file', async () => {
    const repos = setup();
    native.addFile(`${DL}/report.pdf`, 2_048, 1_700_000_000_000);
    const scanned = repos.files.upsert({
      path: `${DL}/report.pdf`,
      uri: null,
      name: 'report.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 2_048,
      mtime: 1_700_000_000_000,
      source: 'downloads',
    });

    const target = await processIncomingIntent(
      repos,
      viewIntent([`file://${DL}/report.pdf`]),
      options,
    );

    expect(target).toEqual({ type: 'open', fileId: scanned.id });
    expect(repos.files.countAll()).toBe(1);
  });

  it('reports NOT_FOUND when the path is gone', async () => {
    const repos = setup();

    await expect(
      processIncomingIntent(repos, viewIntent([`file://${DL}/missing.pdf`]), options),
    ).rejects.toMatchObject({ name: 'AppError', code: 'NOT_FOUND' });
    expect(repos.files.countAll()).toBe(0);
  });

  it('handles a mixed batch of a cached copy and a path in one send', async () => {
    const repos = setup();
    native.addFile(`${DL}/a.pdf`, 11, 6_000);
    native.copyContentUriToCache.mockResolvedValueOnce(
      content({ path: '/cache/intent/b.pdf', name: 'b.pdf', size: 22 }),
    );

    const target = await processIncomingIntent(
      repos,
      sendIntent([`file://${DL}/a.pdf`, 'content://p/b']),
      options,
    );

    expect(target).toMatchObject({ type: 'library' });
    expect(repos.files.getByPath(`${DL}/a.pdf`)?.size).toBe(11);
    expect(repos.files.getByPath('/cache/intent/b.pdf')?.size).toBe(22);
    expect(repos.files.countAll()).toBe(2);
  });
});
