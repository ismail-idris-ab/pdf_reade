import { Platform } from 'react-native';

import FileIndexModule, {
  type PickedDocument,
  type ScanCompleteEvent,
  type ScannedFile,
} from '../../modules/file-index/src/FileIndexModule';
import { createTestDatabase } from '../db/testDatabase';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { createRepositories, type Repositories } from '@/db/repositories';
import type { NewFile } from '@/db/types';
import { AppError } from '@/lib/errors';
import {
  addPickedDocuments,
  indexLibrary,
  isContentUri,
  isIndexing,
  mergePickedDuplicates,
  pickedGrantLimit,
  prunePickedDocuments,
  useLibraryVersionStore,
} from '@/lib/library';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);

const native = FileIndexModule as unknown as FakeFileIndexModule;

const DOWNLOAD = '/storage/emulated/0/Download';
const PICKED_URI = 'content://com.android.providers.downloads.documents/document/42';

const scanned = (name: string, mtime = 1_000): ScannedFile => ({
  path: `${DOWNLOAD}/${name}`,
  name,
  ext: 'pdf',
  size: 100,
  mtime,
});

const fileRow = (path: string, mtime = 1_000): NewFile => ({
  path,
  uri: path.startsWith('content://') ? path : null,
  name: path.split('/').pop() ?? 'x',
  ext: 'pdf',
  mime: 'application/pdf',
  size: 100,
  mtime,
  source: path.startsWith('content://') ? 'device' : 'downloads',
});

const complete = (overrides: Partial<ScanCompleteEvent> = {}): ScanCompleteEvent => ({
  scanId: 'scan-1',
  scanned: 3,
  emitted: 0,
  deleted: [],
  skippedDirs: 0,
  durationMs: 5,
  cancelled: false,
  ...overrides,
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

let repos: Repositories;

beforeEach(() => {
  jest.clearAllMocks();
  native.hasAllFilesAccess.mockImplementation(() => true);
  native.startScan.mockImplementation(() => Promise.resolve('scan-1'));
  native.listPersistedUris.mockImplementation(() => []);
  native.releasePersistedUri.mockImplementation(() => undefined);
  repos = createRepositories(createTestDatabase().db);
});

describe('isContentUri', () => {
  it('detects SAF URIs only', () => {
    expect(isContentUri(PICKED_URI)).toBe(true);
    expect(isContentUri('CONTENT://x/y')).toBe(true);
    expect(isContentUri(`${DOWNLOAD}/a.pdf`)).toBe(false);
  });
});

describe('indexLibrary', () => {
  it('builds knownMtimes from filesystem rows only, never content:// rows', async () => {
    repos.files.upsert(fileRow(`${DOWNLOAD}/a.pdf`, 111));
    repos.files.upsert(fileRow(PICKED_URI, 222));

    const run = indexLibrary(repos);
    await flush();
    expect(native.startScan).toHaveBeenCalledWith({
      exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'ppt', 'pptx'],
      knownMtimes: { [`${DOWNLOAD}/a.pdf`]: 111 },
    });
    native.emitComplete(complete());
    await expect(run).resolves.toEqual({
      status: 'completed',
      upserted: 0,
      removed: 0,
      scanned: 3,
      merged: 0,
    });
  });

  it('upserts emitted files and removes rows of deleted paths', async () => {
    repos.files.upsert(fileRow(`${DOWNLOAD}/old.pdf`));
    repos.files.upsert(fileRow(`${DOWNLOAD}/changed.pdf`, 1));
    repos.files.upsert(fileRow(PICKED_URI));

    const run = indexLibrary(repos);
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [scanned('new.pdf'), scanned('changed.pdf', 9)] });
    native.emitComplete(complete({ deleted: [`${DOWNLOAD}/old.pdf`, PICKED_URI] }));

    await expect(run).resolves.toEqual({
      status: 'completed',
      upserted: 2,
      removed: 1,
      scanned: 3,
      merged: 0,
    });
    expect(repos.files.getByPath(`${DOWNLOAD}/new.pdf`)).toMatchObject({
      name: 'new.pdf',
      source: 'downloads',
      mime: 'application/pdf',
    });
    expect(repos.files.getByPath(`${DOWNLOAD}/changed.pdf`)?.mtime).toBe(9);
    expect(repos.files.getByPath(`${DOWNLOAD}/old.pdf`)).toBeUndefined();
    // A picked row is never removed by a scan, even if a path list names it.
    expect(repos.files.getByPath(PICKED_URI)).toBeDefined();
  });

  it('does not overlap: a second call joins the running scan', async () => {
    const first = indexLibrary(repos);
    const second = indexLibrary(repos);
    expect(second).toBe(first);
    expect(isIndexing()).toBe(true);
    await flush();
    expect(native.startScan).toHaveBeenCalledTimes(1);
    native.emitComplete(complete());
    await first;
    expect(isIndexing()).toBe(false);

    const third = indexLibrary(repos);
    expect(third).not.toBe(first);
    await flush();
    expect(native.startScan).toHaveBeenCalledTimes(2);
    native.emitComplete(complete());
    await third;
  });

  it('resolves permissionDenied without scanning when access is not held', async () => {
    native.hasAllFilesAccess.mockImplementation(() => false);
    repos.files.upsert(fileRow(`${DOWNLOAD}/a.pdf`));
    await expect(indexLibrary(repos)).resolves.toEqual({ status: 'permissionDenied' });
    expect(native.startScan).not.toHaveBeenCalled();
    expect(repos.files.getByPath(`${DOWNLOAD}/a.pdf`)).toBeDefined();
    expect(isIndexing()).toBe(false);
  });

  it('resolves permissionDenied when the scan reports PERMISSION_DENIED', async () => {
    const run = indexLibrary(repos);
    await flush();
    native.emitError({ scanId: 'scan-1', code: 'PERMISSION_DENIED', message: 'revoked' });
    await expect(run).resolves.toEqual({ status: 'permissionDenied' });
  });

  it('rejects with an AppError on unexpected scan failures', async () => {
    const run = indexLibrary(repos);
    await flush();
    native.emitError({ scanId: 'scan-1', code: 'ERR_IO', message: 'boom' });
    await expect(run).rejects.toBeInstanceOf(AppError);
    await expect(run).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect(isIndexing()).toBe(false);
  });

  it('keeps written rows and applies no deletions when aborted', async () => {
    repos.files.upsert(fileRow(`${DOWNLOAD}/old.pdf`));
    const controller = new AbortController();
    const run = indexLibrary(repos, { signal: controller.signal });
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [scanned('new.pdf')] });
    controller.abort();
    expect(native.cancelScan).toHaveBeenCalledWith('scan-1');
    native.emitComplete(complete({ deleted: [`${DOWNLOAD}/old.pdf`] }));

    await expect(run).resolves.toEqual({ status: 'cancelled', upserted: 1 });
    expect(repos.files.getByPath(`${DOWNLOAD}/new.pdf`)).toBeDefined();
    expect(repos.files.getByPath(`${DOWNLOAD}/old.pdf`)).toBeDefined();
  });
});

describe('indexLibrary batch writes', () => {
  it('writes each batch in one transaction and all deletions in one', async () => {
    const { db } = createTestDatabase();
    const transaction = jest.spyOn(db, 'transaction');
    repos = createRepositories(db);
    repos.files.upsert(fileRow(`${DOWNLOAD}/old1.pdf`));
    repos.files.upsert(fileRow(`${DOWNLOAD}/old2.pdf`));

    const run = indexLibrary(repos);
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [scanned('a.pdf'), scanned('b.pdf')] });
    native.emitBatch({ scanId: 'scan-1', files: [scanned('c.pdf')] });
    native.emitComplete(complete({ deleted: [`${DOWNLOAD}/old1.pdf`, `${DOWNLOAD}/old2.pdf`] }));
    await expect(run).resolves.toMatchObject({ upserted: 3, removed: 2 });
    // Two batches + one deletion pass + one duplicate-merge pass.
    expect(transaction).toHaveBeenCalledTimes(4);
  });

  it('rolls back a whole batch when one row fails, keeping earlier batches', async () => {
    const run = indexLibrary(repos);
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [scanned('first.pdf')] });
    // A NOT NULL violation in the second row of the second batch.
    const broken = { ...scanned('broken.pdf'), name: null as unknown as string };
    native.emitBatch({ scanId: 'scan-1', files: [scanned('same-batch.pdf'), broken] });

    await expect(run).rejects.toMatchObject({ name: 'AppError', code: 'UNKNOWN' });
    expect(native.cancelScan).toHaveBeenCalledWith('scan-1');
    expect(repos.files.getByPath(`${DOWNLOAD}/first.pdf`)).toBeDefined();
    expect(repos.files.getByPath(`${DOWNLOAD}/same-batch.pdf`)).toBeUndefined();
  });
});

const picked = (overrides: Partial<PickedDocument> = {}): PickedDocument => ({
  uri: PICKED_URI,
  name: 'Report.PDF',
  size: 2048,
  mime: 'application/pdf',
  mtime: 5_000,
  persisted: true,
  ...overrides,
});
const pickOptions = { now: 9_999, fallbackName: 'Untitled document', grantLimit: 500 };

describe('addPickedDocuments', () => {
  it('stores the document keyed by its URI with source device', () => {
    const { rows, notPersisted, evicted } = addPickedDocuments(repos, [picked()], pickOptions);
    expect(notPersisted).toBe(0);
    expect(evicted).toBe(0);
    expect(rows[0]).toMatchObject({
      path: PICKED_URI,
      uri: PICKED_URI,
      name: 'Report.PDF',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 2048,
      mtime: 5_000,
      source: 'device',
    });
  });

  it('falls back to the given name, MIME-derived ext and default size/mtime', () => {
    const { rows } = addPickedDocuments(
      repos,
      [
        picked({
          name: null,
          size: null,
          mtime: null,
          mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ],
      pickOptions,
    );
    expect(rows[0]).toMatchObject({
      name: 'Untitled document',
      ext: 'docx',
      size: 0,
      mtime: 9_999,
    });
  });

  it('uses the MIME type when the name has no known extension', () => {
    const { rows } = addPickedDocuments(
      repos,
      [
        picked({ uri: 'content://p/1', name: 'scan', mime: 'text/csv' }),
        picked({ uri: 'content://p/2', name: 'notes.final', mime: 'text/plain' }),
        picked({ uri: 'content://p/3', name: '  ', mime: null }),
      ],
      pickOptions,
    );
    expect(rows[0]).toMatchObject({ name: 'scan', ext: 'csv', mime: 'text/csv' });
    expect(rows[1]).toMatchObject({ ext: 'txt' });
    expect(rows[2]).toMatchObject({ name: 'Untitled document', ext: '', mime: null });
  });

  it('derives the MIME type from the name when the provider gives none', () => {
    const { rows } = addPickedDocuments(
      repos,
      [picked({ name: 'sheet.xlsx', mime: null })],
      pickOptions,
    );
    expect(rows[0]).toMatchObject({
      ext: 'xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  });

  it('refreshes instead of duplicating when the same URI is picked again', () => {
    addPickedDocuments(repos, [picked()], pickOptions);
    addPickedDocuments(repos, [picked({ size: 4096 })], pickOptions);
    const rows = repos.files.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.size).toBe(4096);
  });

  it('leaves out documents whose grant was not persisted', () => {
    const result = addPickedDocuments(
      repos,
      [picked({ uri: 'content://p/kept' }), picked({ uri: 'content://p/temp', persisted: false })],
      pickOptions,
    );
    expect(result.notPersisted).toBe(1);
    expect(result.rows.map((row) => row.path)).toEqual(['content://p/kept']);
    expect(repos.files.getByPath('content://p/temp')).toBeUndefined();
  });

  it('a non-persisted pick is never stored, so the next prune has nothing to drop', () => {
    native.listPersistedUris.mockImplementation(() => ['content://p/kept']);
    addPickedDocuments(
      repos,
      [picked({ uri: 'content://p/kept' }), picked({ uri: 'content://p/temp', persisted: false })],
      pickOptions,
    );
    expect(prunePickedDocuments(repos)).toBe(0);
    expect(repos.files.getByPath('content://p/kept')).toBeDefined();
    expect(repos.files.getByPath('content://p/temp')).toBeUndefined();
  });

  it('defaults the grant limit by Android version (120 below API 30, else 500)', () => {
    const version = Platform.Version;
    expect(pickedGrantLimit()).toBe(typeof version === 'number' && version < 30 ? 120 : 500);
  });
});

describe('addPickedDocuments grant cap', () => {
  const oldUri = (i: number) => `content://p/old-${i}`;
  const OLD = [0, 1, 2, 3, 4].map(oldUri);

  // Five older picked rows holding grants; old-0 was opened, the rest never.
  function seedOldPicks() {
    OLD.forEach((uri, i) => repos.files.upsert(fileRow(uri, 100 + i)));
    const opened = repos.files.getByPath(oldUri(0));
    if (opened) repos.files.markOpened(opened.id, 1);
  }

  it('evicts nothing while under the limit', () => {
    seedOldPicks();
    native.listPersistedUris.mockImplementation(() => OLD);
    const result = addPickedDocuments(repos, [picked({ uri: 'content://p/new' })], {
      ...pickOptions,
      grantLimit: 6,
    });
    expect(result.evicted).toBe(0);
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('releases and removes only as many least-recently-used picks as needed', () => {
    seedOldPicks();
    // The picker may already list the new grant; it is counted once.
    native.listPersistedUris.mockImplementation(() => [...OLD, 'content://p/new1']);
    const result = addPickedDocuments(
      repos,
      [picked({ uri: 'content://p/new1' }), picked({ uri: 'content://p/new2' })],
      { ...pickOptions, grantLimit: 5 },
    );
    expect(result.evicted).toBe(2);
    // Never-opened rows go first, oldest mtime first; the opened old-0 stays.
    expect(native.releasePersistedUri.mock.calls).toEqual([[oldUri(1)], [oldUri(2)]]);
    expect(repos.files.getByPath(oldUri(1))).toBeUndefined();
    expect(repos.files.getByPath(oldUri(2))).toBeUndefined();
    expect(repos.files.getByPath(oldUri(0))).toBeDefined();
    expect(repos.files.getByPath('content://p/new1')).toBeDefined();
    expect(repos.files.getByPath('content://p/new2')).toBeDefined();
  });

  it('releases orphan grants (no library row) before evicting rows', () => {
    seedOldPicks();
    native.listPersistedUris.mockImplementation(() => [...OLD, 'content://p/orphan']);
    const result = addPickedDocuments(repos, [picked({ uri: 'content://p/new' })], {
      ...pickOptions,
      grantLimit: 6,
    });
    expect(result.evicted).toBe(0);
    expect(native.releasePersistedUri.mock.calls).toEqual([['content://p/orphan']]);
    expect(repos.files.listIndexEntries()).toHaveLength(6);
  });
});

describe('prunePickedDocuments', () => {
  it('removes content:// rows without a persisted permission and keeps everything else', () => {
    repos.files.upsert(fileRow('content://p/kept'));
    repos.files.upsert(fileRow('content://p/lost'));
    repos.files.upsert(fileRow(`${DOWNLOAD}/a.pdf`));
    native.listPersistedUris.mockImplementation(() => ['content://p/kept']);

    expect(prunePickedDocuments(repos)).toBe(1);
    expect(repos.files.getByPath('content://p/kept')).toBeDefined();
    expect(repos.files.getByPath('content://p/lost')).toBeUndefined();
    expect(repos.files.getByPath(`${DOWNLOAD}/a.pdf`)).toBeDefined();
  });
});

describe('duplicate picked documents', () => {
  const pickedCopy = (uri: string, name: string, overrides: Partial<NewFile> = {}): NewFile => ({
    path: uri,
    uri,
    name,
    ext: 'pdf',
    mime: 'application/pdf',
    size: 100,
    mtime: 1_000,
    source: 'device',
    ...overrides,
  });

  it('a completed scan folds a pick into the scanned row and keeps its grant as fallback', async () => {
    const pickedRow = repos.files.upsert(pickedCopy(PICKED_URI, 'cv.pdf'));
    repos.files.setFavorite(pickedRow.id, true);
    repos.files.markOpened(pickedRow.id, 7_000);

    const run = indexLibrary(repos);
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [scanned('cv.pdf')] });
    native.emitComplete(complete());

    await expect(run).resolves.toMatchObject({ status: 'completed', upserted: 1, merged: 1 });
    // The document must stay openable if all-files access is revoked later.
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
    expect(repos.files.getByPath(PICKED_URI)).toBeUndefined();
    expect(repos.files.getByPath(`${DOWNLOAD}/cv.pdf`)).toMatchObject({
      uri: PICKED_URI,
      isFavorite: true,
      lastOpenedAt: 7_000,
    });
  });

  it('a rescan keeps the fallback uri', async () => {
    repos.files.upsert({ ...fileRow(`${DOWNLOAD}/cv.pdf`), uri: PICKED_URI });
    const run = indexLibrary(repos);
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [scanned('cv.pdf', 2_000)] });
    native.emitComplete(complete());
    await run;
    expect(repos.files.getByPath(`${DOWNLOAD}/cv.pdf`)).toMatchObject({
      mtime: 2_000,
      uri: PICKED_URI,
    });
  });

  it('releases only a grant no row uses any more after commit', () => {
    repos.files.upsert({ ...fileRow(`${DOWNLOAD}/cv.pdf`), uri: 'content://p/first' });
    repos.files.upsert(pickedCopy('content://p/second', 'cv.pdf'));
    native.releasePersistedUri.mockImplementation((uri) => {
      expect(repos.files.getByPath(uri)).toBeUndefined();
    });
    expect(mergePickedDuplicates(repos)).toBe(1);
    expect(native.releasePersistedUri.mock.calls).toEqual([['content://p/second']]);
    expect(repos.files.getByPath(`${DOWNLOAD}/cv.pdf`)?.uri).toBe('content://p/first');
  });

  it('picking a file the scan already indexed merges it at once', () => {
    const scannedRow = repos.files.upsert(fileRow(`${DOWNLOAD}/cv.pdf`));
    const result = addPickedDocuments(
      repos,
      [picked({ uri: PICKED_URI, name: 'cv.pdf', size: 100, mtime: 1_000 })],
      pickOptions,
    );
    expect(result.rows).toHaveLength(1);
    expect(repos.files.getByPath(PICKED_URI)).toBeUndefined();
    expect(repos.files.getById(scannedRow.id)?.uri).toBe(PICKED_URI);
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('a pick without a provider mtime merges on name and size', () => {
    const scannedRow = repos.files.upsert(fileRow(`${DOWNLOAD}/cv.pdf`));
    addPickedDocuments(
      repos,
      [picked({ uri: PICKED_URI, name: 'cv.pdf', size: 100, mtime: null })],
      pickOptions,
    );
    expect(repos.files.getByPath(PICKED_URI)).toBeUndefined();
    expect(repos.files.getById(scannedRow.id)?.uri).toBe(PICKED_URI);
  });

  it('a pick with a different provider mtime is kept separate', () => {
    repos.files.upsert(fileRow(`${DOWNLOAD}/cv.pdf`));
    addPickedDocuments(
      repos,
      [picked({ uri: PICKED_URI, name: 'cv.pdf', size: 100, mtime: 99_000 })],
      pickOptions,
    );
    expect(repos.files.getByPath(PICKED_URI)).toBeDefined();
  });

  it('does not merge on a cancelled scan', async () => {
    repos.files.upsert(fileRow(`${DOWNLOAD}/cv.pdf`));
    repos.files.upsert(pickedCopy(PICKED_URI, 'cv.pdf'));
    const controller = new AbortController();
    const run = indexLibrary(repos, { signal: controller.signal });
    await flush();
    controller.abort();
    native.emitComplete(complete());
    await expect(run).resolves.toEqual({ status: 'cancelled', upserted: 0 });
    expect(repos.files.getByPath(PICKED_URI)).toBeDefined();
  });

  it('releases nothing and keeps every row when the merge fails', () => {
    const { db, sqlite } = createTestDatabase();
    repos = createRepositories(db);
    repos.files.upsert({ ...fileRow(`${DOWNLOAD}/cv.pdf`), uri: 'content://p/first' });
    repos.files.upsert(pickedCopy(PICKED_URI, 'cv.pdf'));
    sqlite.exec(`CREATE TRIGGER block_delete BEFORE DELETE ON files
      BEGIN SELECT RAISE(ABORT, 'blocked'); END;`);

    expect(() => mergePickedDuplicates(repos)).toThrow(AppError);
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
    expect(repos.files.getByPath(PICKED_URI)).toBeDefined();
  });

  it('keeps the merge when releasing an unused grant fails', () => {
    repos.files.upsert({ ...fileRow(`${DOWNLOAD}/cv.pdf`), uri: 'content://p/first' });
    repos.files.upsert(pickedCopy(PICKED_URI, 'cv.pdf'));
    native.releasePersistedUri.mockImplementation(() => {
      throw new Error('provider gone');
    });
    expect(mergePickedDuplicates(repos)).toBe(1);
    expect(repos.files.getByPath(PICKED_URI)).toBeUndefined();
  });
});

describe('fallback uris and the grant cap / prune', () => {
  it('counts a fallback grant as in use, not as an orphan', () => {
    repos.files.upsert({ ...fileRow(`${DOWNLOAD}/a.pdf`), uri: 'content://p/fallback' });
    native.listPersistedUris.mockImplementation(() => ['content://p/fallback']);
    const result = addPickedDocuments(repos, [picked({ uri: 'content://p/new' })], {
      ...pickOptions,
      grantLimit: 2,
    });
    expect(result.evicted).toBe(0);
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('evicting a fallback grant only clears the uri; the row stays', () => {
    const row = repos.files.upsert({
      ...fileRow(`${DOWNLOAD}/a.pdf`, 1),
      uri: 'content://p/fallback',
    });
    native.listPersistedUris.mockImplementation(() => ['content://p/fallback']);
    const result = addPickedDocuments(repos, [picked({ uri: 'content://p/new' })], {
      ...pickOptions,
      grantLimit: 1,
    });
    expect(result.evicted).toBe(0);
    expect(native.releasePersistedUri.mock.calls).toEqual([['content://p/fallback']]);
    expect(repos.files.getById(row.id)).toMatchObject({ path: `${DOWNLOAD}/a.pdf`, uri: null });
  });

  it('prune clears a lost fallback uri instead of deleting the path row', () => {
    const kept = repos.files.upsert({ ...fileRow(`${DOWNLOAD}/a.pdf`), uri: 'content://p/kept' });
    const lost = repos.files.upsert({ ...fileRow(`${DOWNLOAD}/b.pdf`), uri: 'content://p/lost' });
    native.listPersistedUris.mockImplementation(() => ['content://p/kept']);
    expect(prunePickedDocuments(repos)).toBe(0);
    expect(repos.files.getById(kept.id)?.uri).toBe('content://p/kept');
    expect(repos.files.getById(lost.id)).toMatchObject({ path: `${DOWNLOAD}/b.pdf`, uri: null });
  });
});

describe('library version', () => {
  const version = () => useLibraryVersionStore.getState().version;

  it('is bumped when a scan changed rows, and not when nothing changed', async () => {
    let start = version();
    let run = indexLibrary(repos);
    await flush();
    native.emitComplete(complete());
    await run;
    expect(version()).toBe(start);

    start = version();
    run = indexLibrary(repos);
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [scanned('a.pdf')] });
    native.emitComplete(complete());
    await run;
    expect(version()).toBe(start + 1);
  });

  it('is bumped when a failing scan already wrote rows', async () => {
    const start = version();
    const run = indexLibrary(repos);
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [scanned('a.pdf')] });
    native.emitError({ scanId: 'scan-1', code: 'ERR_IO', message: 'boom' });
    await expect(run).rejects.toBeInstanceOf(AppError);
    expect(version()).toBe(start + 1);
  });

  it('is bumped by picks and by prunes that removed rows', () => {
    const start = version();
    addPickedDocuments(repos, [picked()], pickOptions);
    expect(version()).toBe(start + 1);
    native.listPersistedUris.mockImplementation(() => [PICKED_URI]);
    expect(prunePickedDocuments(repos)).toBe(0);
    expect(version()).toBe(start + 1);
    native.listPersistedUris.mockImplementation(() => []);
    expect(prunePickedDocuments(repos)).toBe(1);
    expect(version()).toBe(start + 2);
  });
});
