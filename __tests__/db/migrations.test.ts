import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { createRepositories } from '@/db/repositories';
import * as schema from '@/db/schema';

import { createTestDatabase, MIGRATIONS_FOLDER } from './testDatabase';

type Journal = { entries: { tag: string }[] };

/** Copy of the migrations folder holding only the first `count` migrations. */
function partialMigrationsFolder(count: number): string {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as Journal & Record<string, unknown>;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const entries = journal.entries.slice(0, count);
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const { tag } of entries) {
    fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), path.join(dir, `${tag}.sql`));
  }
  return dir;
}

describe('0002_files_myfiles_source', () => {
  it('keeps rows, ids, children and the FTS index when rebuilding files', () => {
    // A database as shipped before this migration (0000 + 0001), with data.
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema });
    const before = partialMigrationsFolder(2);
    try {
      migrate(db, { migrationsFolder: before });
    } finally {
      fs.rmSync(before, { recursive: true, force: true });
    }
    sqlite.pragma('foreign_keys = ON');
    const insert = sqlite.prepare(
      `INSERT INTO files (path, name, ext, size, mtime, source, is_favorite, last_opened_at)
       VALUES (?, ?, 'pdf', 10, 1, ?, ?, ?)`,
    );
    const cv = Number(
      insert.run('/d/Résumé cv.pdf', 'Résumé cv.pdf', 'downloads', 1, 77).lastInsertRowid,
    );
    const scan = Number(insert.run('/s/scan.pdf', 'scan.pdf', 'scans', 0, null).lastInsertRowid);
    sqlite.prepare('INSERT INTO bookmarks (file_id, page, created_at) VALUES (?, 3, 1)').run(cv);
    sqlite.prepare('INSERT INTO reading_state (file_id, page) VALUES (?, 4)').run(cv);
    sqlite
      .prepare("INSERT INTO annotation_drafts (file_id, json, updated_at) VALUES (?, '{}', 1)")
      .run(scan);

    // The app migrates with foreign keys off (src/db/client.ts).
    sqlite.pragma('foreign_keys = OFF');
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    const repos = createRepositories(db);
    expect(repos.files.getById(cv)).toMatchObject({
      path: '/d/Résumé cv.pdf',
      isFavorite: true,
      lastOpenedAt: 77,
      source: 'downloads',
    });
    expect(repos.files.getById(scan)?.source).toBe('scans');
    expect(repos.bookmarks.listForFile(cv).map((b) => b.page)).toEqual([3]);
    expect(repos.readingState.get(cv)?.page).toBe(4);
    expect(repos.annotationDrafts.get(scan)?.json).toBe('{}');
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);

    // The new source is accepted, unknown ones still rejected.
    const mine = repos.files.upsert({
      path: '/data/user/0/x/files/MyFiles/mine.pdf',
      uri: null,
      name: 'mine.pdf',
      ext: 'pdf',
      mime: null,
      size: 1,
      mtime: 1,
      source: 'myfiles',
    });
    expect(() => sqlite.prepare("UPDATE files SET source = 'cloud'").run()).toThrow(/CHECK/);

    // Old rows are searchable, and the recreated triggers index new rows,
    // renames and deletes.
    expect(repos.files.search('resume').map((f) => f.id)).toEqual([cv]);
    expect(repos.files.search('mine').map((f) => f.id)).toEqual([mine.id]);
    sqlite.prepare("UPDATE files SET name = 'renamed.pdf' WHERE id = ?").run(scan);
    expect(repos.files.search('scan')).toEqual([]);
    expect(repos.files.search('renamed').map((f) => f.id)).toEqual([scan]);
    repos.files.remove(cv);
    expect(repos.files.search('resume')).toEqual([]);
    expect(repos.bookmarks.listForFile(cv)).toEqual([]);

    // Indexes and the CHECK survive the rename.
    const indexes = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'files'")
        .all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'files_path_unique',
        'files_last_opened_idx',
        'files_favorite_idx',
        'files_mtime_idx',
        'files_source_mtime_idx',
      ]),
    );
    const { sql: ddl } = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'files'")
      .get() as { sql: string };
    expect(ddl).toContain("'myfiles'");
    expect(ddl).not.toContain('__new_files');
  });
});

describe('migrations', () => {
  it('migrates an empty database to the full schema', () => {
    const { sqlite } = createTestDatabase();
    const objects = sqlite
      .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { type: string; name: string }[];
    const names = objects.map((o) => o.name);

    for (const table of [
      'files',
      'bookmarks',
      'reading_state',
      'trash',
      'usage',
      'annotation_drafts',
      'files_fts',
    ]) {
      expect(names).toContain(table);
    }
    for (const trigger of [
      'files_fts_after_insert',
      'files_fts_after_delete',
      'files_fts_after_update_name',
    ]) {
      expect(objects).toContainEqual({ type: 'trigger', name: trigger });
    }
  });

  it('records every journal entry as applied', () => {
    const { sqlite } = createTestDatabase();
    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    ) as Journal;
    const applied = sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as {
      n: number;
    };
    expect(applied.n).toBe(journal.entries.length);
  });

  it('keeps migrations.js in sync with the journal', () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    ) as Journal & { entries: { idx: number }[] };
    const bundle = fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'migrations.js'), 'utf8');
    for (const { idx, tag } of journal.entries) {
      // The expo migrator looks each migration up as `m` + idx padded to 4.
      const key = `m${String(idx).padStart(4, '0')}`;
      expect(bundle).toContain(`import ${key} from './${tag}.sql';`);
      expect(bundle).toMatch(new RegExp(`migrations:\\s*{[^}]*\\b${key}\\b`));
    }
  });
});
