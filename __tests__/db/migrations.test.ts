import fs from 'node:fs';
import path from 'node:path';

import { createTestDatabase, MIGRATIONS_FOLDER } from './testDatabase';

type Journal = { entries: { tag: string }[] };

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
