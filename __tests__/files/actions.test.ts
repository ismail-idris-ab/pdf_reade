import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import { createTestDatabase } from '../db/testDatabase';
import { FAKE_MY_FILES_ROOT, type FakeFileIndexModule } from './fakeFileIndex';
import { createRepositories, type Repositories } from '@/db/repositories';
import type { NewFile } from '@/db/types';
import {
  canChangeSharedStorage,
  copyToMyFiles,
  deleteLibraryFile,
  deleteMyFilesFolder,
  duplicateLibraryFile,
  importIntoMyFiles,
  isFileGone,
  moveLibraryFile,
  printLibraryFile,
  reconcileMyFiles,
  removeFromLibrary,
  renameLibraryFile,
  renameMyFilesFolder,
  setFileFavorite,
  shareLibraryFile,
} from '@/features/files/actions';
import { availableFileActions } from '@/features/files/components/ActionSheets';
import { describeLocation as describeLocationForTest } from '@/features/files/location';
import { createInFlightGuard } from '@/features/files/useInFlight';
import { AppError } from '@/lib/errors';
import { fileOpErrorKind } from '@/lib/files';
import { indexLibrary, useLibraryVersionStore } from '@/lib/library';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('./fakeFileIndex').createFakeFileIndexModule(),
);

const native = FileIndexModule as unknown as FakeFileIndexModule;
const ROOT = FAKE_MY_FILES_ROOT;
const DL = '/storage/emulated/0/Download';

let repos: Repositories;

const version = () => useLibraryVersionStore.getState().version;

function row(path: string, overrides: Partial<NewFile> = {}): NewFile {
  const name = path.split('/').pop() ?? path;
  return {
    path,
    uri: null,
    name,
    ext: 'pdf',
    mime: 'application/pdf',
    size: 100,
    mtime: 1_000,
    source: 'downloads',
    ...overrides,
  };
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => e,
  );

beforeEach(() => {
  jest.clearAllMocks();
  native.resetFs();
  native.listPersistedUris.mockImplementation(() => []);
  repos = createRepositories(createTestDatabase().db);
});

describe('renameLibraryFile', () => {
  it('renames a path row on disk and keeps its id, favorite and bookmarks', async () => {
    native.addFile(`${DL}/old.pdf`, 100, 1_000);
    const file = repos.files.upsert(row(`${DL}/old.pdf`));
    repos.files.setFavorite(file.id, true);
    repos.files.setPageCount(file.id, 12);
    repos.bookmarks.add(file.id, 3, null, 1);
    const before = version();

    const { row: updated } = await renameLibraryFile(repos, file.id, '  New name.pdf ');

    expect(native.renameFile).toHaveBeenCalledWith(`${DL}/old.pdf`, 'New name.pdf');
    expect(updated).toMatchObject({
      id: file.id,
      path: `${DL}/New name.pdf`,
      name: 'New name.pdf',
      ext: 'pdf',
      source: 'downloads',
      isFavorite: true,
      // Same size and mtime: the cached page count stays.
      pageCount: 12,
    });
    expect(repos.bookmarks.listForFile(file.id)).toHaveLength(1);
    // The FTS triggers follow the new name.
    expect(repos.files.search('new name').map((r) => r.id)).toEqual([file.id]);
    expect(repos.files.search('old')).toEqual([]);
    expect(version()).toBeGreaterThan(before);
  });

  it('keeps the file’s extension, so its type never silently changes', async () => {
    native.addFile(`${DL}/a.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    expect((await renameLibraryFile(repos, file.id, 'Report')).row).toMatchObject({
      name: 'Report.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
    });
    expect(native.renameFile).toHaveBeenLastCalledWith(`${DL}/a.pdf`, 'Report.pdf');
    expect((await renameLibraryFile(repos, file.id, 'Report.txt')).row).toMatchObject({
      name: 'Report.txt.pdf',
      ext: 'pdf',
    });
  });

  it('lets a file without an extension gain one', async () => {
    native.addFile(`${DL}/README`);
    const file = repos.files.upsert(row(`${DL}/README`, { ext: '', mime: null }));
    expect((await renameLibraryFile(repos, file.id, 'notes.txt')).row).toMatchObject({
      name: 'notes.txt',
      ext: 'txt',
      mime: 'text/plain',
    });
  });

  it('drops and releases a stale fallback uri of a path row', async () => {
    native.addFile(`${DL}/a.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`, { uri: 'content://p/9' }));
    const { row: updated } = await renameLibraryFile(repos, file.id, 'b.pdf');
    expect(updated.uri).toBeNull();
    expect(native.releasePersistedUri).toHaveBeenCalledWith('content://p/9');
  });

  it('renames a picked row through its provider and follows the new URI', async () => {
    native.addDocument('content://p/1', { name: 'pick.pdf', size: 100 });
    const picked = repos.files.upsert(
      row('content://p/1', { uri: 'content://p/1', source: 'device' }),
    );
    // A scanned row using the same URI as its fallback follows it too.
    const scanned = repos.files.upsert(row(`${DL}/other.pdf`, { uri: 'content://p/1' }));

    const { row: updated, renamed } = await renameLibraryFile(repos, picked.id, 'renamed.pdf');

    expect(native.renameDocument).toHaveBeenCalledWith('content://p/1', 'renamed.pdf');
    expect(native.renameFile).not.toHaveBeenCalled();
    expect(updated).toMatchObject({
      id: picked.id,
      path: 'content://p/1-renamed',
      uri: 'content://p/1-renamed',
      name: 'renamed.pdf',
      source: 'device',
    });
    expect(renamed).toBe(true);
    expect(repos.files.getById(scanned.id)?.uri).toBe('content://p/1-renamed');
    // Native moved the grant; nothing is released here.
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('when the provider keeps the old name, still switches to the live URI', async () => {
    native.addDocument('content://p/1', { name: 'pick.pdf', size: 100 });
    native.refuseRename('content://p/1');
    const picked = repos.files.upsert(
      row('content://p/1', { uri: 'content://p/1', name: 'pick.pdf', source: 'device' }),
    );
    repos.bookmarks.add(picked.id, 2, null, 1);
    const scanned = repos.files.upsert(row(`${DL}/other.pdf`, { uri: 'content://p/1' }));

    const { row: updated, renamed } = await renameLibraryFile(repos, picked.id, 'new');

    expect(renamed).toBe(false);
    expect(updated).toMatchObject({
      id: picked.id,
      path: 'content://p/1-renamed',
      uri: 'content://p/1-renamed',
      name: 'pick.pdf',
    });
    // No row references the old URI any more; the live one is never released.
    expect(repos.files.isGrantInUse('content://p/1')).toBe(false);
    expect(repos.files.getById(scanned.id)?.uri).toBe('content://p/1-renamed');
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
    expect(repos.bookmarks.listForFile(picked.id)).toHaveLength(1);
  });

  it('keeps a picked row’s type when the new name has no known extension', async () => {
    native.addDocument('content://p/1', { name: 'pick.pdf', size: 100 });
    const picked = repos.files.upsert(
      row('content://p/1', { uri: 'content://p/1', name: 'pick.pdf' }),
    );
    const { row: updated } = await renameLibraryFile(repos, picked.id, 'scan of id');
    expect(updated).toMatchObject({ name: 'scan of id.pdf', ext: 'pdf', mime: 'application/pdf' });
  });

  it('reports ERR_NAME_EXISTS as a name error and leaves the row alone', async () => {
    native.addFile(`${DL}/a.pdf`);
    native.addFile(`${DL}/b.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    const before = version();
    const error = await failure(renameLibraryFile(repos, file.id, 'b.pdf'));
    expect(error).toBeInstanceOf(AppError);
    expect(fileOpErrorKind(error)).toBe('nameExists');
    expect(repos.files.getById(file.id)?.path).toBe(`${DL}/a.pdf`);
    expect(version()).toBe(before);
  });

  it('rejects invalid names before calling native', async () => {
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    for (const name of ['', '   ', 'a/b', '..', '.hidden', ' .x']) {
      expect(fileOpErrorKind(await failure(renameLibraryFile(repos, file.id, name)))).toBe(
        'nameInvalid',
      );
    }
    expect(native.renameFile).not.toHaveBeenCalled();
  });

  it('maps NOT_FOUND and keeps the row (the UI offers removing it)', async () => {
    const file = repos.files.upsert(row(`${DL}/gone.pdf`));
    const error = await failure(renameLibraryFile(repos, file.id, 'x.pdf'));
    expect((error as AppError).code).toBe('NOT_FOUND');
    expect(repos.files.getById(file.id)).toBeDefined();
  });

  it('does nothing when the name is unchanged', async () => {
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    await renameLibraryFile(repos, file.id, 'a.pdf');
    expect(native.renameFile).not.toHaveBeenCalled();
  });
});

describe('moveLibraryFile', () => {
  it('moves into My Files keeping the id and bookmarks; the source becomes myfiles', async () => {
    native.addFile(`${DL}/a.pdf`, 100, 1_000);
    native.addFolder(`${ROOT}/Work`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`, { uri: 'content://p/5' }));
    repos.bookmarks.add(file.id, 0, 'start', 1);
    repos.readingState.save({ fileId: file.id, page: 4, zoom: 1, mode: 'vertical' });

    const moved = await moveLibraryFile(repos, file.id, `${ROOT}/Work`);

    expect(moved).toMatchObject({
      id: file.id,
      path: `${ROOT}/Work/a.pdf`,
      source: 'myfiles',
      uri: null,
    });
    expect(repos.bookmarks.listForFile(file.id)).toEqual([
      expect.objectContaining({ page: 0, label: 'start' }),
    ]);
    expect(repos.readingState.get(file.id)?.page).toBe(4);
    expect(native.releasePersistedUri).toHaveBeenCalledWith('content://p/5');
  });

  it('suffixes a clashing name', async () => {
    native.addFile(`${DL}/a.pdf`);
    native.addFile(`${ROOT}/a.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    const moved = await moveLibraryFile(repos, file.id, ROOT);
    expect(moved).toMatchObject({ path: `${ROOT}/a (1).pdf`, name: 'a (1).pdf' });
  });

  it('does nothing when the file is already in that folder', async () => {
    native.addFile(`${ROOT}/a.pdf`);
    const file = repos.files.upsert(row(`${ROOT}/a.pdf`, { source: 'myfiles' }));
    await moveLibraryFile(repos, file.id, ROOT);
    expect(native.moveFile).not.toHaveBeenCalled();
  });

  it('refuses picked rows (they are copied instead)', async () => {
    const picked = repos.files.upsert(row('content://p/1', { uri: 'content://p/1' }));
    const error = await failure(moveLibraryFile(repos, picked.id, ROOT));
    expect((error as AppError).code).toBe('UNSUPPORTED');
    expect(native.moveFile).not.toHaveBeenCalled();
  });
});

describe('copyToMyFiles', () => {
  it('imports a picked document as a new myfiles row; the original and its grant stay', async () => {
    native.addDocument('content://p/1', { name: 'pick.pdf', size: 42 });
    const picked = repos.files.upsert(
      row('content://p/1', { uri: 'content://p/1', source: 'device' }),
    );
    const copy = await copyToMyFiles(repos, picked.id, ROOT);
    expect(native.importDocuments).toHaveBeenCalledWith(['content://p/1'], ROOT);
    expect(copy).toMatchObject({
      path: `${ROOT}/pick.pdf`,
      uri: null,
      name: 'pick.pdf',
      size: 42,
      source: 'myfiles',
    });
    expect(copy.id).not.toBe(picked.id);
    expect(repos.files.getById(picked.id)).toBeDefined();
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('turns a per-item error code into an AppError', async () => {
    const picked = repos.files.upsert(row('content://p/1', { uri: 'content://p/1' }));
    native.importDocuments.mockResolvedValueOnce([{ uri: 'content://p/1', errorCode: 'NO_SPACE' }]);
    const error = await failure(copyToMyFiles(repos, picked.id, ROOT));
    expect((error as AppError).code).toBe('NO_SPACE');
    expect(repos.files.countAll()).toBe(1);
  });
});

describe('duplicateLibraryFile', () => {
  it('copies next to the file and inserts a row with the same source', async () => {
    native.addFolder(DL);
    native.addFile(`${DL}/a.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    const copy = await duplicateLibraryFile(repos, file.id);
    expect(native.copyFile).toHaveBeenCalledWith(`${DL}/a.pdf`, DL);
    expect(copy).toMatchObject({ path: `${DL}/a (copy).pdf`, source: 'downloads' });
    expect(copy.id).not.toBe(file.id);
    expect(repos.files.countAll()).toBe(2);
  });

  it('duplicates in My Files as myfiles rows', async () => {
    native.addFile(`${ROOT}/Sub/a.pdf`);
    const file = repos.files.upsert(row(`${ROOT}/Sub/a.pdf`, { source: 'myfiles' }));
    const copy = await duplicateLibraryFile(repos, file.id);
    expect(copy).toMatchObject({ path: `${ROOT}/Sub/a (copy).pdf`, source: 'myfiles' });
  });

  it('refuses picked rows', async () => {
    const picked = repos.files.upsert(row('content://p/1', { uri: 'content://p/1' }));
    expect(((await failure(duplicateLibraryFile(repos, picked.id))) as AppError).code).toBe(
      'UNSUPPORTED',
    );
  });
});

describe('deleteLibraryFile', () => {
  it('deletes the file and the row; bookmarks cascade; the fallback grant is released', async () => {
    native.addFile(`${DL}/a.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`, { uri: 'content://p/7' }));
    repos.bookmarks.add(file.id, 1, null, 1);
    const before = version();

    await deleteLibraryFile(repos, file.id);

    expect(native.exists(`${DL}/a.pdf`)).toBe(false);
    expect(repos.files.getById(file.id)).toBeUndefined();
    expect(repos.bookmarks.listForFile(file.id)).toEqual([]);
    expect(native.releasePersistedUri).toHaveBeenCalledWith('content://p/7');
    expect(version()).toBeGreaterThan(before);
  });

  it('keeps a fallback grant another row still uses', async () => {
    native.addFile(`${DL}/a.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`, { uri: 'content://p/7' }));
    repos.files.upsert(row(`${DL}/b.pdf`, { uri: 'content://p/7' }));
    await deleteLibraryFile(repos, file.id);
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('deletes a picked document through its provider (native releases the grant)', async () => {
    native.addDocument('content://p/1', { name: 'pick.pdf', size: 1 });
    const picked = repos.files.upsert(row('content://p/1', { uri: 'content://p/1' }));
    const scanned = repos.files.upsert(row(`${DL}/x.pdf`, { uri: 'content://p/1' }));

    await deleteLibraryFile(repos, picked.id);

    expect(native.deleteDocument).toHaveBeenCalledWith('content://p/1');
    expect(native.deleteFile).not.toHaveBeenCalled();
    expect(repos.files.getById(picked.id)).toBeUndefined();
    expect(repos.files.getById(scanned.id)?.uri).toBeNull();
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('keeps the row when native deletion fails', async () => {
    native.addFile(`${DL}/a.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    native.deleteFile.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }),
    );
    const error = await failure(deleteLibraryFile(repos, file.id));
    expect((error as AppError).code).toBe('PERMISSION_DENIED');
    expect(repos.files.getById(file.id)).toBeDefined();
  });
});

describe('removeFromLibrary', () => {
  it('drops the row and releases the grants only it used', async () => {
    const picked = repos.files.upsert(row('content://p/1', { uri: 'content://p/1' }));
    await removeFromLibrary(repos, picked.id);
    expect(repos.files.getById(picked.id)).toBeUndefined();
    expect(native.releasePersistedUri).toHaveBeenCalledWith('content://p/1');
    expect(native.deleteDocument).not.toHaveBeenCalled();
  });
});

describe('setFileFavorite', () => {
  it('toggles the favorite and bumps the version', () => {
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    const before = version();
    setFileFavorite(repos, file.id, true);
    expect(repos.files.getById(file.id)?.isFavorite).toBe(true);
    expect(version()).toBeGreaterThan(before);
  });
});

describe('share and print', () => {
  it('shares path rows directly and picked rows through a cache copy', async () => {
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    await shareLibraryFile(repos, file.id);
    expect(native.share).toHaveBeenCalledWith([`${DL}/a.pdf`], 'application/pdf');

    const picked = repos.files.upsert(row('content://p/1', { uri: 'content://p/1' }));
    native.copyContentUriToCache.mockResolvedValueOnce({
      path: '/cache/pick.pdf',
      name: 'pick.pdf',
      nameFromProvider: true,
      size: 1,
      mime: 'application/pdf',
    });
    await shareLibraryFile(repos, picked.id);
    expect(native.copyContentUriToCache).toHaveBeenCalledWith('content://p/1');
    expect(native.share).toHaveBeenLastCalledWith(['/cache/pick.pdf'], 'application/pdf');
  });

  it('prints PDFs with the file name as the job name, and nothing else', async () => {
    const pdf = repos.files.upsert(row('content://p/1', { uri: 'content://p/1', name: 'Doc.pdf' }));
    await printLibraryFile(repos, pdf.id);
    expect(native.printPdf).toHaveBeenCalledWith('content://p/1', 'Doc.pdf');

    const txt = repos.files.upsert(row(`${DL}/a.txt`, { ext: 'txt' }));
    expect(((await failure(printLibraryFile(repos, txt.id))) as AppError).code).toBe('UNSUPPORTED');
  });
});

describe('My Files folders', () => {
  it('renames a folder and moves the rows under it, keeping ids', async () => {
    native.addFile(`${ROOT}/Old/a.pdf`);
    native.addFile(`${ROOT}/Old/Deep/b.pdf`);
    const a = repos.files.upsert(row(`${ROOT}/Old/a.pdf`, { source: 'myfiles' }));
    const b = repos.files.upsert(row(`${ROOT}/Old/Deep/b.pdf`, { source: 'myfiles' }));
    const other = repos.files.upsert(row(`${ROOT}/Older/c.pdf`, { source: 'myfiles' }));

    const entry = await renameMyFilesFolder(repos, `${ROOT}/Old`, 'New');

    expect(entry.path).toBe(`${ROOT}/New`);
    expect(repos.files.getById(a.id)?.path).toBe(`${ROOT}/New/a.pdf`);
    expect(repos.files.getById(b.id)?.path).toBe(`${ROOT}/New/Deep/b.pdf`);
    // A sibling whose name merely starts the same is untouched.
    expect(repos.files.getById(other.id)?.path).toBe(`${ROOT}/Older/c.pdf`);
  });

  it('keeps descendant paths intact for emoji, % and _ in folder names', async () => {
    // "📁" is two UTF-16 units but one SQLite character; "%" and "_" are
    // LIKE wildcards.
    const from = `${ROOT}/📁 50%_off`;
    native.addFile(`${from}/a.pdf`);
    native.addFile(`${from}/Sub 🎉/b.pdf`);
    const a = repos.files.upsert(row(`${from}/a.pdf`, { source: 'myfiles' }));
    const b = repos.files.upsert(row(`${from}/Sub 🎉/b.pdf`, { source: 'myfiles' }));
    repos.bookmarks.add(b.id, 1, null, 1);
    // Would match a LIKE '📁 50%_off/%' pattern, but is not under the folder.
    native.addFile(`${ROOT}/📁 50XYoff/c.pdf`, 100, 1_000);
    const lookalike = repos.files.upsert(row(`${ROOT}/📁 50XYoff/c.pdf`, { source: 'myfiles' }));

    await renameMyFilesFolder(repos, from, '🗂️ Done_100%');

    const to = `${ROOT}/🗂️ Done_100%`;
    expect(repos.files.getById(a.id)?.path).toBe(`${to}/a.pdf`);
    expect(repos.files.getById(b.id)?.path).toBe(`${to}/Sub 🎉/b.pdf`);
    expect(repos.files.getById(lookalike.id)?.path).toBe(`${ROOT}/📁 50XYoff/c.pdf`);
    // Rows match disk, so a reconcile prunes nothing and bookmarks survive.
    await expect(reconcileMyFiles(repos)).resolves.toMatchObject({ removed: 0 });
    expect(repos.bookmarks.listForFile(b.id)).toHaveLength(1);
  });

  it('drops stale rows already under the new folder name instead of failing', async () => {
    native.addFile(`${ROOT}/Old/a.pdf`);
    const a = repos.files.upsert(row(`${ROOT}/Old/a.pdf`, { source: 'myfiles' }));
    // Left over from a folder "New" deleted outside the app.
    const stale = repos.files.upsert(row(`${ROOT}/New/a.pdf`, { source: 'myfiles' }));

    await renameMyFilesFolder(repos, `${ROOT}/Old`, 'New');

    expect(repos.files.getById(stale.id)).toBeUndefined();
    expect(repos.files.getById(a.id)?.path).toBe(`${ROOT}/New/a.pdf`);
  });

  it('reports a folder name clash as a name error', async () => {
    native.addFolder(`${ROOT}/A`);
    native.addFolder(`${ROOT}/B`);
    const error = await failure(renameMyFilesFolder(repos, `${ROOT}/A`, 'B'));
    expect(fileOpErrorKind(error)).toBe('nameExists');
  });

  it('deletes a folder and every row under it, with cascades', async () => {
    native.addFile(`${ROOT}/Gone/a.pdf`);
    native.addFile(`${ROOT}/Gone/Sub/b.pdf`);
    const a = repos.files.upsert(row(`${ROOT}/Gone/a.pdf`, { source: 'myfiles' }));
    const b = repos.files.upsert(row(`${ROOT}/Gone/Sub/b.pdf`, { source: 'myfiles' }));
    const kept = repos.files.upsert(row(`${ROOT}/keep.pdf`, { source: 'myfiles' }));
    repos.bookmarks.add(a.id, 2, null, 1);

    await deleteMyFilesFolder(repos, `${ROOT}/Gone`);

    expect(native.exists(`${ROOT}/Gone`)).toBe(false);
    expect(repos.files.getById(a.id)).toBeUndefined();
    expect(repos.files.getById(b.id)).toBeUndefined();
    expect(repos.bookmarks.listForFile(a.id)).toEqual([]);
    expect(repos.files.getById(kept.id)).toBeDefined();
  });
});

describe('importIntoMyFiles', () => {
  const picked = (uri: string, persisted = true) => ({
    uri,
    name: null,
    size: null,
    mime: 'application/pdf',
    mtime: null,
    persisted,
  });

  it('adds the copies as myfiles rows, reports failures, and releases the pick grants', async () => {
    native.addDocument('content://p/1', { name: 'one.pdf', size: 1 });
    native.addDocument('content://p/3', { name: 'three.docx', size: 3 });
    // Already in the library as a picked row: its grant stays.
    repos.files.upsert(row('content://p/3', { uri: 'content://p/3' }));

    const outcome = await importIntoMyFiles(
      repos,
      [picked('content://p/1'), picked('content://p/2'), picked('content://p/3')],
      ROOT,
    );

    expect(outcome.imported.map((r) => [r.path, r.source, r.ext])).toEqual([
      [`${ROOT}/one.pdf`, 'myfiles', 'pdf'],
      [`${ROOT}/three.docx`, 'myfiles', 'docx'],
    ]);
    expect(outcome.failed).toEqual([{ uri: 'content://p/2', code: 'NOT_FOUND' }]);
    expect(native.releasePersistedUri.mock.calls).toEqual([['content://p/1'], ['content://p/2']]);
  });

  it('does not release grants that were never persisted', async () => {
    native.addDocument('content://p/1', { name: 'one.pdf', size: 1 });
    await importIntoMyFiles(repos, [picked('content://p/1', false)], ROOT);
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('still releases the grants when the import fails as a whole', async () => {
    native.importDocuments.mockRejectedValueOnce(
      Object.assign(new Error('full'), { code: 'NO_SPACE' }),
    );
    const error = await failure(importIntoMyFiles(repos, [picked('content://p/1')], ROOT));
    expect((error as AppError).code).toBe('NO_SPACE');
    expect(native.releasePersistedUri).toHaveBeenCalledWith('content://p/1');
    expect(repos.files.countAll()).toBe(0);
  });
});

describe('reconcileMyFiles', () => {
  it('adds untracked files, refreshes changed ones and removes rows whose file is gone', async () => {
    native.addFile(`${ROOT}/new.pdf`, 5, 50);
    native.addFile(`${ROOT}/Sub/changed.docx`, 9, 90);
    native.addFile(`${ROOT}/Sub/.changed.docx.tmp-42`, 1, 1);
    native.addFile(`${ROOT}/Sub/.rename-1791412064000-7f`, 1, 1);
    // A real dot-file (made by another app): listed, so never unreachable.
    native.addFile(`${ROOT}/.dotfile.pdf`, 3, 30);
    native.addFile(`${ROOT}/same.pdf`, 100, 1_000);
    const changed = repos.files.upsert(
      row(`${ROOT}/Sub/changed.docx`, { source: 'myfiles', ext: 'docx', size: 1, mtime: 1 }),
    );
    const same = repos.files.upsert(row(`${ROOT}/same.pdf`, { source: 'myfiles' }));
    const gone = repos.files.upsert(row(`${ROOT}/gone.pdf`, { source: 'myfiles' }));
    const outside = repos.files.upsert(row(`${DL}/outside.pdf`));
    const before = version();

    await expect(reconcileMyFiles(repos)).resolves.toEqual({ added: 2, updated: 1, removed: 1 });

    expect(repos.files.getByPath(`${ROOT}/new.pdf`)).toMatchObject({
      name: 'new.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 5,
      mtime: 50,
      source: 'myfiles',
    });
    expect(repos.files.getById(changed.id)).toMatchObject({ size: 9, mtime: 90 });
    expect(repos.files.getById(same.id)).toBeDefined();
    expect(repos.files.getById(gone.id)).toBeUndefined();
    expect(repos.files.getById(outside.id)).toBeDefined();
    // Only native work files (copy / rename in progress) are skipped.
    expect(repos.files.getByPath(`${ROOT}/Sub/.changed.docx.tmp-42`)).toBeUndefined();
    expect(repos.files.getByPath(`${ROOT}/Sub/.rename-1791412064000-7f`)).toBeUndefined();
    expect(repos.files.getByPath(`${ROOT}/.dotfile.pdf`)?.source).toBe('myfiles');
    expect(version()).toBeGreaterThan(before);
  });

  it('leaves rows under a folder that could not be listed', async () => {
    native.addFile(`${ROOT}/Locked/a.pdf`);
    const kept = repos.files.upsert(row(`${ROOT}/Locked/a.pdf`, { source: 'myfiles' }));
    // Root lists fine; the sub-folder cannot be listed.
    native.listFolder
      .mockResolvedValueOnce({
        path: ROOT,
        entries: [{ path: `${ROOT}/Locked`, name: 'Locked', isDirectory: true, size: 0, mtime: 0 }],
      })
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'PERMISSION_DENIED' }));
    await reconcileMyFiles(repos);
    expect(repos.files.getById(kept.id)).toBeDefined();
  });

  it('changes nothing (and does not bump) when the table already matches', async () => {
    native.addFile(`${ROOT}/a.pdf`, 100, 1_000);
    repos.files.upsert(row(`${ROOT}/a.pdf`, { source: 'myfiles' }));
    const before = version();
    await expect(reconcileMyFiles(repos)).resolves.toEqual({ added: 0, updated: 0, removed: 0 });
    expect(version()).toBe(before);
  });

  it('rejects when the root cannot be listed', async () => {
    native.listFolder.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'NOT_FOUND' }));
    expect(((await failure(reconcileMyFiles(repos))) as AppError).code).toBe('NOT_FOUND');
  });
});

describe('location', () => {
  it('describes locations without raw URIs or full paths', () => {
    const labels = {
      pickedFile: 'Picked file',
      phoneStorage: 'Phone storage',
      sdCard: 'SD card',
      myFiles: 'My Files',
      downloads: 'Downloads',
      whatsapp: 'WhatsApp',
      scans: 'Scans',
    };
    const describe = (path: string, source: Parameters<typeof describeLocationForTest>[1]) =>
      describeLocationForTest(path, source, ROOT, labels);
    expect(describe('content://com.android.providers/document/1', 'device')).toBe('Picked file');
    expect(describe(`${ROOT}/a.pdf`, 'myfiles')).toBe('My Files');
    expect(describe(`${ROOT}/a/b/c.pdf`, 'myfiles')).toBe('My Files › a › b');
    expect(describe(`${DL}/x/y.pdf`, 'downloads')).toBe('Downloads');
    expect(describe('/storage/emulated/0/WhatsApp/x.pdf', 'whatsapp')).toBe('WhatsApp');
    expect(describe('/storage/emulated/0/Documents/Work/cv.pdf', 'device')).toBe(
      'Phone storage › Documents › Work',
    );
    expect(describe('/storage/1A2B-3C4D/cv.pdf', 'device')).toBe('SD card');
    expect(describe('/somewhere/else.pdf', 'device')).toBe('Phone storage');
  });
});

describe('createInFlightGuard', () => {
  it('ignores calls while a task is in flight (double taps)', async () => {
    const guard = createInFlightGuard();
    let finish: () => void = () => undefined;
    const task = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('done');
        }),
    );
    const first = guard.run(task);
    const second = guard.run(task);
    expect(guard.busy).toBe(true);
    await expect(second).resolves.toBeUndefined();
    finish();
    await expect(first).resolves.toBe('done');
    expect(task).toHaveBeenCalledTimes(1);
    expect(guard.busy).toBe(false);

    await expect(guard.run(async () => 'again')).resolves.toBe('again');
  });

  it('frees the guard when the task fails', async () => {
    const guard = createInFlightGuard();
    await expect(guard.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(guard.busy).toBe(false);
  });
});

describe('operations run one at a time', () => {
  it('a reconcile waits for a running operation instead of seeing it half-applied', async () => {
    native.addFile(`${DL}/a.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    let release: () => void = () => undefined;
    native.moveFile.mockImplementationOnce(
      (path, dest) =>
        new Promise((resolve) => {
          release = () => {
            native.addFile(`${dest}/a.pdf`, 100, 1_000);
            resolve({ path: `${dest}/a.pdf`, name: 'a.pdf', size: 100, mtime: 1_000 });
          };
          void path;
        }),
    );
    const move = moveLibraryFile(repos, file.id, ROOT);
    const reconcile = reconcileMyFiles(repos);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(native.listFolder).not.toHaveBeenCalled();
    release();
    await move;
    // The moved row is already known: the reconcile adds nothing.
    await expect(reconcile).resolves.toEqual({ added: 0, updated: 0, removed: 0 });
    expect(repos.files.countAll()).toBe(1);
  });
});

describe('canChangeSharedStorage', () => {
  it('needs Android 11+ and all-files access', () => {
    expect(canChangeSharedStorage(true, 30)).toBe(true);
    expect(canChangeSharedStorage(true, 34)).toBe(true);
    expect(canChangeSharedStorage(false, 34)).toBe(false);
    expect(canChangeSharedStorage(true, 29)).toBe(false);
    expect(canChangeSharedStorage(true, 26)).toBe(false);
    expect(canChangeSharedStorage(true, 'ios-17')).toBe(false);
  });
});

describe('availableFileActions', () => {
  const writable = { capabilities: null, sharedStorageWritable: true, myFilesRoot: ROOT };
  const readOnly = { ...writable, sharedStorageWritable: false };

  it('offers everything for a shared-storage PDF when shared storage is writable', () => {
    expect(availableFileActions({ path: `${DL}/a.pdf`, ext: 'pdf' }, writable)).toEqual([
      'favorite',
      'rename',
      'move',
      'duplicate',
      'details',
      'share',
      'print',
      'delete',
    ]);
  });

  it('offers Print only for PDFs', () => {
    expect(availableFileActions({ path: `${DL}/a.docx`, ext: 'docx' }, writable)).not.toContain(
      'print',
    );
    expect(availableFileActions({ path: `${DL}/a.PDF`, ext: 'PDF' }, writable)).toContain('print');
  });

  it('hides changing actions for shared storage without write access, never for My Files', () => {
    expect(availableFileActions({ path: `${DL}/a.pdf`, ext: 'pdf' }, readOnly)).toEqual([
      'favorite',
      'details',
      'share',
      'print',
    ]);
    expect(availableFileActions({ path: `${ROOT}/a.pdf`, ext: 'pdf' }, readOnly)).toEqual([
      'favorite',
      'rename',
      'move',
      'duplicate',
      'details',
      'share',
      'print',
      'delete',
    ]);
  });

  it('for picked documents: copy instead of move, no duplicate, rename/delete per provider', () => {
    const file = { path: 'content://p/1', ext: 'pdf' };
    expect(availableFileActions(file, readOnly)).toEqual([
      'favorite',
      'copyToMyFiles',
      'details',
      'share',
      'print',
    ]);
    expect(
      availableFileActions(file, {
        ...readOnly,
        capabilities: { canRename: true, canDelete: false },
      }),
    ).toEqual(['favorite', 'rename', 'copyToMyFiles', 'details', 'share', 'print']);
    expect(
      availableFileActions(file, {
        ...readOnly,
        capabilities: { canRename: true, canDelete: true },
      }),
    ).toContain('delete');
  });
});

describe('second review fixes', () => {
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const completeScan = () =>
    native.emitComplete({
      scanId: 'scan-1',
      scanned: 0,
      emitted: 0,
      deleted: [],
      skippedDirs: 0,
      durationMs: 1,
      cancelled: false,
    });

  async function scan() {
    const run = indexLibrary(repos);
    await flush();
    completeScan();
    return run;
  }

  it('a scan never folds a picked document into its My Files copy (copy to My Files)', async () => {
    native.addDocument('content://p/1', { name: 'pick.pdf', size: 42 });
    native.listPersistedUris.mockImplementation(() => ['content://p/1']);
    const picked = repos.files.upsert(
      row('content://p/1', { uri: 'content://p/1', name: 'pick.pdf', size: 42, mtime: 5_000 }),
    );
    const copy = await copyToMyFiles(repos, picked.id, ROOT);
    // Same name, size and second as the pick: a merge candidate if allowed.
    repos.files.relocate(copy.id, { ...copy, mtime: 5_000 });

    await expect(scan()).resolves.toMatchObject({ status: 'completed', merged: 0 });
    expect(repos.files.getById(picked.id)).toMatchObject({ path: 'content://p/1' });
    expect(repos.files.getById(copy.id)?.uri).toBeNull();
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('a scan never folds a picked document into an imported copy', async () => {
    native.addDocument('content://p/2', { name: 'same.pdf', size: 7 });
    const picked = repos.files.upsert(
      row('content://p/2', { uri: 'content://p/2', name: 'same.pdf', size: 7, mtime: 9_000 }),
    );
    const { imported } = await importIntoMyFiles(
      repos,
      [
        {
          uri: 'content://p/2',
          name: 'same.pdf',
          size: 7,
          mime: 'application/pdf',
          mtime: 9_000,
          persisted: false,
        },
      ],
      ROOT,
    );
    const [copy] = imported;
    if (copy === undefined) throw new Error('not imported');
    repos.files.relocate(copy.id, { ...copy, mtime: 9_000 });

    await expect(scan()).resolves.toMatchObject({ merged: 0 });
    expect(repos.files.getById(picked.id)).toBeDefined();
    expect(repos.files.getById(copy.id)).toBeDefined();
  });

  it('still merges a pick into a scanned shared-storage row', async () => {
    const scanned = repos.files.upsert(row(`${DL}/cv.pdf`, { size: 50, mtime: 3_000 }));
    repos.files.upsert(
      row('content://p/3', { uri: 'content://p/3', name: 'cv.pdf', size: 50, mtime: 3_000 }),
    );
    await expect(scan()).resolves.toMatchObject({ merged: 1 });
    expect(repos.files.getById(scanned.id)?.uri).toBe('content://p/3');
  });

  it('a scan’s merge waits for a running file action', async () => {
    native.addFile(`${DL}/a.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    let release: () => void = () => undefined;
    native.renameFile.mockImplementationOnce(
      (path) =>
        new Promise((resolve) => {
          release = () => resolve({ path: `${DL}/b.pdf`, name: 'b.pdf', size: 100, mtime: 1_000 });
          void path;
        }),
    );
    const merge = jest.spyOn(repos.files, 'mergeContentDuplicates');
    const rename = renameLibraryFile(repos, file.id, 'b.pdf');
    const run = indexLibrary(repos);
    await flush();
    completeScan();
    await flush();
    expect(merge).not.toHaveBeenCalled();
    release();
    await rename;
    await expect(run).resolves.toMatchObject({ status: 'completed' });
    expect(merge).toHaveBeenCalledTimes(1);
  });

  it('a new file never inherits a stale row at its path', async () => {
    native.addFolder(DL);
    native.addFile(`${DL}/a.pdf`);
    const file = repos.files.upsert(row(`${DL}/a.pdf`));
    // A stale row where the copy will land, favorite and bookmarked.
    const stale = repos.files.upsert(row(`${DL}/a (copy).pdf`));
    repos.files.setFavorite(stale.id, true);
    repos.bookmarks.add(stale.id, 4, null, 1);

    const copy = await duplicateLibraryFile(repos, file.id);

    expect(copy.path).toBe(`${DL}/a (copy).pdf`);
    expect(copy.id).not.toBe(stale.id);
    expect(copy.isFavorite).toBe(false);
    expect(repos.bookmarks.listForFile(copy.id)).toEqual([]);
    expect(repos.files.getById(stale.id)).toBeUndefined();
  });

  it('isFileGone checks the disk for paths and the grant for picked documents', async () => {
    native.addFile(`${DL}/here.pdf`);
    const here = repos.files.upsert(row(`${DL}/here.pdf`));
    const ghost = repos.files.upsert(row(`${DL}/ghost.pdf`));
    const kept = repos.files.upsert(row('content://p/k', { uri: 'content://p/k' }));
    const lost = repos.files.upsert(row('content://p/l', { uri: 'content://p/l' }));
    native.listPersistedUris.mockImplementation(() => ['content://p/k']);

    const notFound = new AppError('NOT_FOUND');
    const failed = new AppError('UNKNOWN');
    await expect(isFileGone(repos, here.id, notFound)).resolves.toBe(false);
    await expect(isFileGone(repos, ghost.id, notFound)).resolves.toBe(true);
    // Picked: the provider's own NOT_FOUND is proof, even with the grant held.
    await expect(isFileGone(repos, kept.id, notFound)).resolves.toBe(true);
    await expect(isFileGone(repos, kept.id, failed)).resolves.toBe(false);
    await expect(isFileGone(repos, lost.id, failed)).resolves.toBe(true);
    // A failing check is not proof: keep the row.
    native.stat.mockRejectedValueOnce(new Error('io'));
    await expect(isFileGone(repos, ghost.id, notFound)).resolves.toBe(false);
  });

  it('deleting a picked document already gone from its provider still drops the row', async () => {
    // Deleted outside the app: the provider answers NOT_FOUND, our grant remains.
    const picked = repos.files.upsert(row('content://p/x', { uri: 'content://p/x' }));
    const scanned = repos.files.upsert(row(`${DL}/x.pdf`, { uri: 'content://p/x' }));
    repos.bookmarks.add(picked.id, 1, null, 1);

    await deleteLibraryFile(repos, picked.id);

    expect(native.deleteDocument).toHaveBeenCalledWith('content://p/x');
    expect(repos.files.getById(picked.id)).toBeUndefined();
    expect(repos.bookmarks.listForFile(picked.id)).toEqual([]);
    expect(repos.files.getById(scanned.id)?.uri).toBeNull();
    // Native did not release it on NOT_FOUND, so it is released here.
    expect(native.releasePersistedUri).toHaveBeenCalledWith('content://p/x');
  });

  it('other provider failures keep the picked row', async () => {
    native.addDocument('content://p/y', { name: 'y.pdf', size: 1 });
    const picked = repos.files.upsert(row('content://p/y', { uri: 'content://p/y' }));
    native.deleteDocument.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'ERR_FILE_OP_FAILED' }),
    );
    expect(await failure(deleteLibraryFile(repos, picked.id))).toBeInstanceOf(AppError);
    expect(repos.files.getById(picked.id)).toBeDefined();
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('shares and prints through the fallback URI without all-files access', async () => {
    const file = repos.files.upsert(row(`${DL}/a.pdf`, { uri: 'content://p/f', name: 'a.pdf' }));
    native.hasAllFilesAccess.mockImplementation(() => false);
    native.copyContentUriToCache.mockResolvedValueOnce({
      path: '/cache/a.pdf',
      name: 'a.pdf',
      nameFromProvider: true,
      size: 1,
      mime: 'application/pdf',
    });
    await shareLibraryFile(repos, file.id);
    expect(native.copyContentUriToCache).toHaveBeenCalledWith('content://p/f');
    expect(native.share).toHaveBeenCalledWith(['/cache/a.pdf'], 'application/pdf');
    await printLibraryFile(repos, file.id);
    expect(native.printPdf).toHaveBeenCalledWith('content://p/f', 'a.pdf');

    // With access, the path is used directly.
    native.hasAllFilesAccess.mockImplementation(() => true);
    await printLibraryFile(repos, file.id);
    expect(native.printPdf).toHaveBeenLastCalledWith(`${DL}/a.pdf`, 'a.pdf');
  });
});
