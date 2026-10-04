import { createRepositories } from '@/db/repositories';

import { createTestDatabase } from './testDatabase';

function setup() {
  const { db } = createTestDatabase();
  const repos = createRepositories(db);
  const file = repos.files.upsert({
    path: '/doc.pdf',
    uri: null,
    name: 'doc.pdf',
    ext: 'pdf',
    mime: 'application/pdf',
    size: 1,
    mtime: 1,
    source: 'device',
  });
  return { repos, fileId: file.id };
}

describe('bookmarks repository', () => {
  it('adds, relabels, lists by page and removes', () => {
    const { repos, fileId } = setup();
    repos.bookmarks.add(fileId, 9, 'Chapter 2', 10);
    repos.bookmarks.add(fileId, 2, null, 11);
    const relabelled = repos.bookmarks.add(fileId, 9, 'Chapter two', 12);

    expect(relabelled.label).toBe('Chapter two');
    expect(repos.bookmarks.listForFile(fileId).map((b) => [b.page, b.label])).toEqual([
      [2, null],
      [9, 'Chapter two'],
    ]);

    repos.bookmarks.remove(fileId, 2);
    expect(repos.bookmarks.listForFile(fileId).map((b) => b.page)).toEqual([9]);
  });

  it('rejects bookmarks for unknown files', () => {
    const { repos } = setup();
    expect(() => repos.bookmarks.add(999, 1, null, 1)).toThrow(/FOREIGN KEY/);
  });
});

describe('reading state repository', () => {
  it('saves and overwrites the state for a file', () => {
    const { repos, fileId } = setup();
    expect(repos.readingState.get(fileId)).toBeUndefined();

    repos.readingState.save({ fileId, page: 4, zoom: 1, mode: 'vertical' });
    repos.readingState.save({ fileId, page: 7, zoom: 2.5, mode: 'horizontal' });

    expect(repos.readingState.get(fileId)).toEqual({
      fileId,
      page: 7,
      zoom: 2.5,
      mode: 'horizontal',
    });
  });

  it('rejects out-of-range zoom and negative pages', () => {
    const { repos, fileId } = setup();
    expect(() => repos.readingState.save({ fileId, page: 0, zoom: 6, mode: 'vertical' })).toThrow(
      /CHECK/,
    );
    expect(() => repos.readingState.save({ fileId, page: -1, zoom: 1, mode: 'vertical' })).toThrow(
      /CHECK/,
    );
  });
});

describe('trash repository', () => {
  it('adds, lists newest first, finds expired entries and removes', () => {
    const { repos } = setup();
    const old = repos.trash.add({
      originalPath: '/old.pdf',
      trashedPath: '/trash/1',
      name: 'old.pdf',
      size: 10,
      mime: 'application/pdf',
      deletedAt: 100,
    });
    const recent = repos.trash.add({
      originalPath: '/new.pdf',
      trashedPath: '/trash/2',
      name: 'new.pdf',
      size: 20,
      mime: null,
      deletedAt: 500,
    });

    expect(repos.trash.get(old.id)).toEqual(old);
    expect(old).toMatchObject({ name: 'old.pdf', size: 10, mime: 'application/pdf' });
    expect(repos.trash.list().map((t) => t.id)).toEqual([recent.id, old.id]);
    expect(repos.trash.listDeletedBefore(300).map((t) => t.id)).toEqual([old.id]);

    repos.trash.remove(old.id);
    expect(repos.trash.list().map((t) => t.id)).toEqual([recent.id]);
  });
});

describe('usage repository', () => {
  it('counts per feature per day', () => {
    const { repos } = setup();
    expect(repos.usage.get('compress', '2026-10-03')).toBe(0);

    expect(repos.usage.increment('compress', '2026-10-03')).toBe(1);
    expect(repos.usage.increment('compress', '2026-10-03', 2)).toBe(3);
    repos.usage.increment('compress', '2026-10-04');
    repos.usage.increment('merge', '2026-10-03');

    expect(repos.usage.get('compress', '2026-10-03')).toBe(3);
    expect(repos.usage.get('compress', '2026-10-04')).toBe(1);
    expect(repos.usage.get('merge', '2026-10-03')).toBe(1);
  });
});

describe('annotation drafts repository', () => {
  it('saves, overwrites and removes a draft', () => {
    const { repos, fileId } = setup();
    repos.annotationDrafts.save(fileId, '{"v":1}', 10);
    repos.annotationDrafts.save(fileId, '{"v":2}', 20);

    expect(repos.annotationDrafts.get(fileId)).toEqual({
      fileId,
      json: '{"v":2}',
      updatedAt: 20,
    });

    repos.annotationDrafts.remove(fileId);
    expect(repos.annotationDrafts.get(fileId)).toBeUndefined();
  });
});
