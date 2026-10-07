import { createRepositories, type Repositories } from '@/db/repositories';
import type { NewFile } from '@/db/types';
import { matchesFilters } from '@/features/library/filters';
import { extGroupOf } from '@/lib/files/extGroups';

import { createTestDatabase } from './testDatabase';

const DL = '/storage/emulated/0/Download';
const WA = '/storage/emulated/0/WhatsApp/Media/WhatsApp Documents';

function file(path: string, overrides: Partial<NewFile> = {}): NewFile {
  const name = path.split('/').pop() ?? path;
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
  return {
    path,
    uri: path.startsWith('content://') ? path : null,
    name,
    ext,
    mime: null,
    size: 100,
    mtime: 1_000,
    source: 'downloads',
    ...overrides,
  };
}

function setup() {
  const { db, sqlite } = createTestDatabase();
  return { repos: createRepositories(db), sqlite };
}

const names = (rows: { name: string }[]) => rows.map((row) => row.name);

describe('extGroupOf', () => {
  it.each([
    ['pdf', 'pdf'],
    ['PDF', 'pdf'],
    ['doc', 'word'],
    ['docx', 'word'],
    ['xls', 'excel'],
    ['xlsx', 'excel'],
    ['csv', 'excel'],
    ['txt', 'other'],
    ['ppt', 'other'],
    ['pptx', 'other'],
    ['', 'other'],
  ])('%s -> %s', (ext, group) => {
    expect(extGroupOf(ext)).toBe(group);
  });
});

describe('listLibrary', () => {
  let repos: Repositories;

  beforeEach(() => {
    ({ repos } = setup());
    repos.files.upsertMany([
      file(`${DL}/banana.pdf`, { size: 300, mtime: 3_000 }),
      file(`${DL}/Apple.docx`, { size: 100, mtime: 1_000 }),
      file(`${WA}/cherry.xlsx`, { size: 200, mtime: 2_000, source: 'whatsapp' }),
      file(`${WA}/apricot.csv`, { size: 50, mtime: 5_000, source: 'whatsapp' }),
      file(`${DL}/notes.txt`, { size: 10, mtime: 4_000 }),
      file(`${DL}/slides.pptx`, { size: 400, mtime: 6_000 }),
      file(`${DL}/noext`, { size: 5, mtime: 7_000 }),
      file('/storage/emulated/0/Documents/zeta.pdf', { size: 1, mtime: 8_000, source: 'device' }),
    ]);
  });

  it('sorts by name ignoring case, both directions', () => {
    expect(names(repos.files.listLibrary({ sort: 'name', dir: 'asc' }))).toEqual([
      'Apple.docx',
      'apricot.csv',
      'banana.pdf',
      'cherry.xlsx',
      'noext',
      'notes.txt',
      'slides.pptx',
      'zeta.pdf',
    ]);
    expect(names(repos.files.listLibrary({ sort: 'name', dir: 'desc' }))[0]).toBe('zeta.pdf');
  });

  it('breaks name ties by id in the sort direction', () => {
    const a = repos.files.upsert(file(`${WA}/Same.pdf`, { source: 'whatsapp' }));
    const b = repos.files.upsert(file(`${DL}/same.pdf`));
    const asc = repos.files
      .listLibrary({ sort: 'name', dir: 'asc' })
      .filter((r) => /same/i.test(r.name));
    expect(asc.map((r) => r.id)).toEqual([a.id, b.id]);
    const desc = repos.files
      .listLibrary({ sort: 'name', dir: 'desc' })
      .filter((r) => /same/i.test(r.name));
    expect(desc.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('sorts by date and by size', () => {
    expect(names(repos.files.listLibrary({ sort: 'date', dir: 'desc' })).slice(0, 2)).toEqual([
      'zeta.pdf',
      'noext',
    ]);
    expect(names(repos.files.listLibrary({ sort: 'date', dir: 'asc' }))[0]).toBe('Apple.docx');
    expect(names(repos.files.listLibrary({ sort: 'size', dir: 'desc' }))[0]).toBe('slides.pptx');
    expect(names(repos.files.listLibrary({ sort: 'size', dir: 'asc' }))[0]).toBe('zeta.pdf');
  });

  it('filters by extension group', () => {
    const list = (extGroup: 'pdf' | 'word' | 'excel' | 'other') =>
      names(repos.files.listLibrary({ extGroup, sort: 'name', dir: 'asc' }));
    expect(list('pdf')).toEqual(['banana.pdf', 'zeta.pdf']);
    expect(list('word')).toEqual(['Apple.docx']);
    expect(list('excel')).toEqual(['apricot.csv', 'cherry.xlsx']);
    // Everything not grouped: txt, ppt(x) and files without a known extension.
    expect(list('other')).toEqual(['noext', 'notes.txt', 'slides.pptx']);
  });

  it('filters by source and combines with the group', () => {
    expect(
      names(repos.files.listLibrary({ source: 'whatsapp', sort: 'date', dir: 'desc' })),
    ).toEqual(['apricot.csv', 'cherry.xlsx']);
    expect(
      names(
        repos.files.listLibrary({ extGroup: 'pdf', source: 'downloads', sort: 'name', dir: 'asc' }),
      ),
    ).toEqual(['banana.pdf']);
    expect(repos.files.listLibrary({ source: 'myfiles', sort: 'name', dir: 'asc' })).toEqual([]);
    expect(
      repos.files.listLibrary({ extGroup: 'all', source: 'all', sort: 'name', dir: 'asc' }),
    ).toHaveLength(8);
  });

  it('returns only the columns the list needs', () => {
    const [row] = repos.files.listLibrary({ extGroup: 'pdf', sort: 'name', dir: 'asc' });
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ['ext', 'id', 'isFavorite', 'lastOpenedAt', 'mtime', 'name', 'path', 'size', 'source'].sort(),
    );
    expect(row?.isFavorite).toBe(false);
  });

  it('counts every row', () => {
    expect(repos.files.countAll()).toBe(8);
  });

  it('search results filtered by tab and source keep FTS rank order', () => {
    repos.files.upsertMany([
      file(`${WA}/report final report.pdf`, { source: 'whatsapp' }),
      file(`${DL}/report.docx`),
      file(`${DL}/old report.pdf`),
    ]);
    const ranked = repos.files.search('report', 2000);
    const pdfs = ranked.filter((row) => matchesFilters(row, 'pdf', 'all'));
    expect(names(pdfs)).toEqual(names(ranked).filter((name) => name.endsWith('.pdf')));
    expect(names(pdfs)).toHaveLength(2);
    expect(names(ranked.filter((row) => matchesFilters(row, 'all', 'whatsapp')))).toEqual([
      'report final report.pdf',
    ]);
    expect(ranked.filter((row) => matchesFilters(row, 'word', 'whatsapp'))).toEqual([]);
  });
});

describe('listLibrary name collation', () => {
  it('sorts accented names with their base letter and numbers numerically', () => {
    const { repos } = setup();
    repos.files.upsertMany([
      file(`${DL}/Zebra.pdf`),
      file(`${DL}/Élan.pdf`),
      file(`${DL}/eau.pdf`),
      file(`${DL}/file10.pdf`),
      file(`${DL}/file2.pdf`),
      file(`${DL}/Ångström.pdf`),
    ]);
    expect(names(repos.files.listLibrary({ sort: 'name', dir: 'asc', locale: 'en' }))).toEqual([
      'Ångström.pdf',
      'eau.pdf',
      'Élan.pdf',
      'file2.pdf',
      'file10.pdf',
      'Zebra.pdf',
    ]);
    expect(names(repos.files.listLibrary({ sort: 'name', dir: 'desc', locale: 'fr' }))[0]).toBe(
      'Zebra.pdf',
    );
    // An unknown locale tag falls back to the default collation.
    expect(
      names(repos.files.listLibrary({ sort: 'name', dir: 'asc', locale: 'not a locale!' }))[0],
    ).toBe('Ångström.pdf');
  });
});

describe('mergeContentDuplicates', () => {
  const URI = 'content://com.android.providers.downloads.documents/document/42';

  type Counts = { files: number; bookmarks: number; reading: number; drafts: number };
  function counts(sqlite: ReturnType<typeof setup>['sqlite']): Counts {
    const n = (table: string) =>
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    return {
      files: n('files'),
      bookmarks: n('bookmarks'),
      reading: n('reading_state'),
      drafts: n('annotation_drafts'),
    };
  }

  it('folds a picked row into the scanned row, keeping its URI as the fallback', () => {
    const { repos, sqlite } = setup();
    const picked = repos.files.upsert(
      file(URI, { name: 'cv.pdf', ext: 'pdf', size: 900, mtime: 12_345, source: 'device' }),
    );
    repos.files.setFavorite(picked.id, true);
    repos.files.markOpened(picked.id, 50_000);
    repos.files.setPageCount(picked.id, 3);
    repos.bookmarks.add(picked.id, 1, 'Intro', 1);
    repos.readingState.save({ fileId: picked.id, page: 2, zoom: 1.5, mode: 'vertical' });
    repos.annotationDrafts.save(picked.id, '{"a":1}', 7);
    // Provider reported whole seconds; the file system has milliseconds.
    const scanned = repos.files.upsert(file(`${DL}/cv.pdf`, { size: 900, mtime: 12_999 }));

    expect(repos.files.mergeContentDuplicates()).toEqual({ merged: [URI], release: [] });
    expect(repos.files.getByPath(URI)).toBeUndefined();
    expect(repos.files.getById(scanned.id)).toMatchObject({
      uri: URI,
      isFavorite: true,
      lastOpenedAt: 50_000,
      pageCount: 3,
    });
    expect(repos.files.isGrantInUse(URI)).toBe(true);
    expect(repos.bookmarks.listForFile(scanned.id).map((b) => b.label)).toEqual(['Intro']);
    expect(repos.readingState.get(scanned.id)).toMatchObject({ page: 2, zoom: 1.5 });
    expect(repos.annotationDrafts.get(scanned.id)?.json).toBe('{"a":1}');
    expect(counts(sqlite)).toEqual({ files: 1, bookmarks: 1, reading: 1, drafts: 1 });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(repos.files.mergeContentDuplicates()).toEqual({ merged: [], release: [] });
  });

  it('keeps the path row state when it is newer; leftovers cascade away', () => {
    const { repos, sqlite } = setup();
    const picked = repos.files.upsert(
      file(URI, { name: 'cv.pdf', size: 900, mtime: 5_000, source: 'device' }),
    );
    const scanned = repos.files.upsert(file(`${DL}/cv.pdf`, { size: 900, mtime: 5_000 }));
    repos.files.setFavorite(scanned.id, true);
    repos.files.markOpened(picked.id, 10);
    repos.files.markOpened(scanned.id, 20);
    repos.bookmarks.add(picked.id, 1, 'picked p1', 1);
    repos.bookmarks.add(picked.id, 4, 'picked p4', 1);
    repos.bookmarks.add(scanned.id, 1, 'scanned p1', 1);
    repos.readingState.save({ fileId: picked.id, page: 9, zoom: 1, mode: 'vertical' });
    repos.readingState.save({ fileId: scanned.id, page: 3, zoom: 1, mode: 'vertical' });
    repos.annotationDrafts.save(picked.id, 'newer', 99);
    repos.annotationDrafts.save(scanned.id, 'older', 1);

    expect(repos.files.mergeContentDuplicates().merged).toEqual([URI]);
    expect(repos.files.getById(scanned.id)).toMatchObject({ isFavorite: true, lastOpenedAt: 20 });
    expect(repos.bookmarks.listForFile(scanned.id).map((b) => [b.page, b.label])).toEqual([
      [1, 'scanned p1'],
      [4, 'picked p4'],
    ]);
    // Path row opened later: its reading position wins; the newer draft wins.
    expect(repos.readingState.get(scanned.id)?.page).toBe(3);
    expect(repos.annotationDrafts.get(scanned.id)?.json).toBe('newer');
    // The same-page bookmark, older reading state and older draft are gone.
    expect(counts(sqlite)).toEqual({ files: 1, bookmarks: 2, reading: 1, drafts: 1 });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('takes the picked reading state when the picked row was opened later', () => {
    const { repos, sqlite } = setup();
    const picked = repos.files.upsert(
      file(URI, { name: 'cv.pdf', size: 900, mtime: 5_000, source: 'device' }),
    );
    const scanned = repos.files.upsert(file(`${DL}/cv.pdf`, { size: 900, mtime: 5_000 }));
    repos.files.markOpened(picked.id, 30);
    repos.readingState.save({ fileId: picked.id, page: 9, zoom: 1, mode: 'vertical' });
    repos.readingState.save({ fileId: scanned.id, page: 3, zoom: 1, mode: 'vertical' });

    repos.files.mergeContentDuplicates();
    expect(repos.files.getById(scanned.id)?.lastOpenedAt).toBe(30);
    expect(repos.readingState.get(scanned.id)?.page).toBe(9);
    expect(counts(sqlite)).toEqual({ files: 1, bookmarks: 0, reading: 1, drafts: 0 });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('ignores rows that differ in name, size or second, unknown sizes and other content rows', () => {
    const { repos } = setup();
    repos.files.upsertMany([
      file(`${DL}/cv.pdf`, { size: 900, mtime: 5_000 }),
      file(`${URI}1`, { name: 'CV.pdf', size: 900, mtime: 5_000, source: 'device' }),
      file(`${URI}2`, { name: 'cv.pdf', size: 901, mtime: 5_000, source: 'device' }),
      file(`${URI}3`, { name: 'cv.pdf', size: 900, mtime: 6_000, source: 'device' }),
      file(`${URI}4`, { name: 'zero.pdf', size: 0, mtime: 1, source: 'device' }),
      file(`content://other/zero.pdf`, { name: 'zero.pdf', size: 0, mtime: 1, source: 'device' }),
    ]);
    expect(repos.files.mergeContentDuplicates().merged).toEqual([]);
    expect(repos.files.countAll()).toBe(6);
  });

  it('matches picks without a provider mtime on name and size alone', () => {
    const { repos } = setup();
    const scanned = repos.files.upsert(file(`${DL}/cv.pdf`, { size: 900, mtime: 5_000 }));
    // Stored mtime is the pick time, unrelated to the file's.
    repos.files.upsert(file(URI, { name: 'cv.pdf', size: 900, mtime: 999_999, source: 'device' }));
    repos.files.upsert(file(`${URI}0`, { name: 'zero.pdf', size: 0, mtime: 1, source: 'device' }));
    repos.files.upsert(file(`${DL}/zero.pdf`, { size: 0, mtime: 1 }));

    expect(repos.files.mergeContentDuplicates().merged).toEqual([]);
    expect(repos.files.mergeContentDuplicates({ withoutMtime: [URI, `${URI}0`] }).merged).toEqual([
      URI,
    ]);
    expect(repos.files.getById(scanned.id)?.uri).toBe(URI);
    // Size must still be known.
    expect(repos.files.getByPath(`${URI}0`)).toBeDefined();
  });

  it('merges several picks of one file into the oldest matching path row', () => {
    const { repos } = setup();
    const first = repos.files.upsert(file(`${DL}/cv.pdf`, { size: 900, mtime: 5_000 }));
    const second = repos.files.upsert(
      file(`${WA}/cv.pdf`, { size: 900, mtime: 5_000, source: 'whatsapp' }),
    );
    const a = repos.files.upsert(file(`${URI}a`, { name: 'cv.pdf', size: 900, mtime: 5_000 }));
    const b = repos.files.upsert(file(`${URI}b`, { name: 'cv.pdf', size: 900, mtime: 5_000 }));
    repos.files.markOpened(a.id, 40);
    repos.files.markOpened(b.id, 30);

    // The first pick becomes the fallback; the second grant is no longer used.
    expect(repos.files.mergeContentDuplicates()).toEqual({
      merged: [`${URI}a`, `${URI}b`],
      release: [`${URI}b`],
    });
    expect(repos.files.getById(first.id)).toMatchObject({ lastOpenedAt: 40, uri: `${URI}a` });
    expect(repos.files.getById(second.id)?.lastOpenedAt).toBeNull();
  });

  it('re-picking a merged file folds it back without releasing its grant', () => {
    const { repos } = setup();
    const scanned = repos.files.upsert(file(`${DL}/cv.pdf`, { size: 900, mtime: 5_000, uri: URI }));
    repos.files.upsert(file(URI, { name: 'cv.pdf', size: 900, mtime: 5_000, source: 'device' }));
    expect(repos.files.mergeContentDuplicates()).toEqual({ merged: [URI], release: [] });
    expect(repos.files.getById(scanned.id)?.uri).toBe(URI);
  });

  it('changes nothing when a statement fails', () => {
    const { repos, sqlite } = setup();
    const picked = repos.files.upsert(
      file(URI, { name: 'cv.pdf', size: 900, mtime: 5_000, source: 'device' }),
    );
    repos.files.setFavorite(picked.id, true);
    const scanned = repos.files.upsert(file(`${DL}/cv.pdf`, { size: 900, mtime: 5_000 }));
    sqlite.exec(`CREATE TRIGGER block_delete BEFORE DELETE ON files
      BEGIN SELECT RAISE(ABORT, 'blocked'); END;`);

    expect(() => repos.files.mergeContentDuplicates()).toThrow(/blocked/);
    expect(repos.files.getByPath(URI)).toBeDefined();
    expect(repos.files.getById(scanned.id)).toMatchObject({ isFavorite: false, uri: null });
  });
});
