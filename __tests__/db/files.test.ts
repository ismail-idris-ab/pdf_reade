import { createRepositories, toFtsQuery } from '@/db/repositories';
import type { NewFile } from '@/db/types';

import { createTestDatabase } from './testDatabase';

function newFile(overrides: Partial<NewFile> = {}): NewFile {
  return {
    path: '/storage/emulated/0/Download/report.pdf',
    uri: null,
    name: 'report.pdf',
    ext: 'pdf',
    mime: 'application/pdf',
    size: 1024,
    mtime: 1_000,
    source: 'downloads',
    ...overrides,
  };
}

function setup() {
  const { db } = createTestDatabase();
  return createRepositories(db);
}

describe('files repository', () => {
  it('inserts a file with defaults and reads it back by id and path', () => {
    const repos = setup();
    const created = repos.files.upsert(newFile());

    expect(created).toMatchObject({
      path: '/storage/emulated/0/Download/report.pdf',
      isFavorite: false,
      pageCount: null,
      lastOpenedAt: null,
    });
    expect(repos.files.getById(created.id)).toEqual(created);
    expect(repos.files.getByPath(created.path)).toEqual(created);
  });

  it('upsert by path refreshes metadata but keeps user state', () => {
    const repos = setup();
    const first = repos.files.upsert(newFile());
    repos.files.setFavorite(first.id, true);
    repos.files.markOpened(first.id, 5_000);
    repos.files.setPageCount(first.id, 12);

    const unchanged = repos.files.upsert(newFile({ uri: 'content://x' }));
    expect(unchanged).toMatchObject({ id: first.id, uri: 'content://x', pageCount: 12 });

    const changed = repos.files.upsert(newFile({ size: 2048, mtime: 2_000 }));
    expect(changed).toMatchObject({
      id: first.id,
      size: 2048,
      mtime: 2_000,
      isFavorite: true,
      lastOpenedAt: 5_000,
      // The file changed on disk, so the cached page count is stale.
      pageCount: null,
    });
  });

  it('rejects unknown sources at the database level', () => {
    const { db, sqlite } = createTestDatabase();
    createRepositories(db).files.upsert(newFile());
    expect(() => sqlite.prepare("UPDATE files SET source = 'cloud'").run()).toThrow(/CHECK/);
  });

  it('lists by source newest first, with paging', () => {
    const repos = setup();
    repos.files.upsert(newFile({ path: '/a.pdf', name: 'a.pdf', mtime: 1, source: 'whatsapp' }));
    repos.files.upsert(newFile({ path: '/b.pdf', name: 'b.pdf', mtime: 3, source: 'whatsapp' }));
    repos.files.upsert(newFile({ path: '/c.pdf', name: 'c.pdf', mtime: 2, source: 'downloads' }));

    expect(repos.files.list({ source: 'whatsapp' }).map((f) => f.name)).toEqual(['b.pdf', 'a.pdf']);
    expect(repos.files.list().map((f) => f.name)).toEqual(['b.pdf', 'c.pdf', 'a.pdf']);
    expect(repos.files.list({ limit: 1, offset: 1 }).map((f) => f.name)).toEqual(['c.pdf']);
  });

  it('lists recent files by last opened and favorites by name', () => {
    const repos = setup();
    const a = repos.files.upsert(newFile({ path: '/a.pdf', name: 'b-second.pdf' }));
    const b = repos.files.upsert(newFile({ path: '/b.pdf', name: 'a-first.pdf' }));
    repos.files.upsert(newFile({ path: '/c.pdf', name: 'never-opened.pdf' }));
    repos.files.markOpened(a.id, 100);
    repos.files.markOpened(b.id, 200);
    repos.files.setFavorite(a.id, true);
    repos.files.setFavorite(b.id, true);

    expect(repos.files.listRecent().map((f) => f.id)).toEqual([b.id, a.id]);
    expect(repos.files.listFavorites().map((f) => f.name)).toEqual(['a-first.pdf', 'b-second.pdf']);

    repos.files.setFavorite(a.id, false);
    expect(repos.files.listFavorites().map((f) => f.id)).toEqual([b.id]);
  });

  it('removing a file cascades to bookmarks, reading state and drafts', () => {
    const repos = setup();
    const file = repos.files.upsert(newFile());
    repos.bookmarks.add(file.id, 3, null, 1);
    repos.readingState.save({ fileId: file.id, page: 3, zoom: 1.5, mode: 'vertical' });
    repos.annotationDrafts.save(file.id, '{}', 1);

    repos.files.remove(file.id);

    expect(repos.files.getById(file.id)).toBeUndefined();
    expect(repos.bookmarks.listForFile(file.id)).toEqual([]);
    expect(repos.readingState.get(file.id)).toBeUndefined();
    expect(repos.annotationDrafts.get(file.id)).toBeUndefined();
  });

  describe('search', () => {
    it('matches word prefixes, ignores accents and ranks results', () => {
      const repos = setup();
      repos.files.upsert(newFile({ path: '/1.pdf', name: 'Résumé Ismail 2026.pdf' }));
      repos.files.upsert(
        newFile({ path: '/2.pdf', name: 'WhatsApp Image 2024-05-01 at 10.30.22.pdf' }),
      );
      repos.files.upsert(newFile({ path: '/3.pdf', name: 'JAMB result slip.pdf' }));

      expect(repos.files.search('resume').map((f) => f.path)).toEqual(['/1.pdf']);
      expect(repos.files.search('whats').map((f) => f.path)).toEqual(['/2.pdf']);
      expect(repos.files.search('jamb slip').map((f) => f.path)).toEqual(['/3.pdf']);
      expect(repos.files.search('jamb whatsapp')).toEqual([]);
    });

    it('follows renames and deletes', () => {
      const repos = setup();
      repos.files.upsert(newFile({ path: '/x.pdf', name: 'old name.pdf' }));
      repos.files.upsert(newFile({ path: '/x.pdf', name: 'invoice march.pdf' }));
      expect(repos.files.search('old')).toEqual([]);
      const [hit] = repos.files.search('invoice');
      expect(hit?.name).toBe('invoice march.pdf');

      repos.files.remove(hit!.id);
      expect(repos.files.search('invoice')).toEqual([]);
    });

    it('treats FTS syntax in user input as plain text', () => {
      const repos = setup();
      repos.files.upsert(newFile({ path: '/q.pdf', name: 'contract final.pdf' }));

      expect(() => repos.files.search('contract" OR name:*')).not.toThrow();
      expect(repos.files.search('"contract*').map((f) => f.path)).toEqual(['/q.pdf']);
      expect(repos.files.search('   ')).toEqual([]);
      expect(repos.files.search('***')).toEqual([]);
    });

    it('matches decomposed (NFD) input', () => {
      const repos = setup();
      repos.files.upsert(newFile({ path: '/r.pdf', name: 'Résumé.pdf' }));
      expect(repos.files.search('Résumé'.normalize('NFD')).map((f) => f.path)).toEqual(['/r.pdf']);
    });
  });
});

describe('toFtsQuery', () => {
  it('turns words into quoted prefix terms', () => {
    expect(toFtsQuery('JAMB  result')).toBe('"JAMB"* "result"*');
    expect(toFtsQuery('a"b*c')).toBe('"a"* "b"* "c"*');
    expect(toFtsQuery('Résumé')).toBe('"Résumé"*');
    expect(toFtsQuery('Résumé'.normalize('NFD'))).toBe('"Résumé"*');
    expect(toFtsQuery('-- ()')).toBeNull();
  });
});

describe('files repository batch writes', () => {
  const at = (name: string, overrides: Partial<NewFile> = {}) =>
    newFile({ path: `/storage/emulated/0/Download/${name}`, name, ...overrides });

  it('upsertMany writes every row and returns them in order', () => {
    const repos = setup();
    repos.files.upsert(at('b.pdf', { size: 1 }));
    const rows = repos.files.upsertMany([at('a.pdf'), at('b.pdf', { size: 2 })]);
    expect(rows.map((row) => row.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(repos.files.getByPath(at('b.pdf').path)?.size).toBe(2);
    expect(repos.files.upsertMany([])).toEqual([]);
  });

  it('upsertMany is atomic: one bad row writes nothing', () => {
    const repos = setup();
    const bad = at('bad.pdf', { source: 'bogus' as NewFile['source'] });
    expect(() => repos.files.upsertMany([at('a.pdf'), bad, at('c.pdf')])).toThrow();
    expect(repos.files.listIndexEntries()).toEqual([]);
  });

  it('removeByPaths deletes known paths, ignores unknown ones and cascades', () => {
    const repos = setup();
    const a = repos.files.upsert(at('a.pdf'));
    repos.files.upsert(at('b.pdf'));
    repos.bookmarks.add(a.id, 1, null, 1);
    expect(repos.files.removeByPaths([a.path, '/nope.pdf'])).toBe(1);
    expect(repos.files.getByPath(a.path)).toBeUndefined();
    expect(repos.files.getByPath(at('b.pdf').path)).toBeDefined();
    expect(repos.bookmarks.listForFile(a.id)).toEqual([]);
    expect(repos.files.removeByPaths([])).toBe(0);
  });

  it('removeByPaths handles more paths than one SQL statement can bind', () => {
    const repos = setup();
    const rows = Array.from({ length: 1_200 }, (_, i) => at(`f${i}.pdf`));
    repos.files.upsertMany(rows);
    expect(repos.files.removeByPaths(rows.map((row) => row.path))).toBe(1_200);
    expect(repos.files.listIndexEntries()).toEqual([]);
  });

  it('lists content:// rows least recently used first', () => {
    const repos = setup();
    const uri = (id: string, mtime: number) =>
      newFile({ path: `content://p/${id}`, uri: `content://p/${id}`, mtime, source: 'device' });
    const openedLate = repos.files.upsert(uri('opened-late', 1));
    const openedEarly = repos.files.upsert(uri('opened-early', 1));
    repos.files.upsert(uri('never-new', 50));
    repos.files.upsert(uri('never-old', 10));
    repos.files.upsert(at('a.pdf'));
    repos.files.markOpened(openedLate.id, 2_000);
    repos.files.markOpened(openedEarly.id, 1_000);
    expect(repos.files.listContentUrisByAge().map((row) => row.path)).toEqual([
      'content://p/never-old',
      'content://p/never-new',
      'content://p/opened-early',
      'content://p/opened-late',
    ]);
  });
});
