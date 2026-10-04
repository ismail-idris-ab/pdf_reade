import fs from 'node:fs';
import path from 'node:path';

import { en } from '@/i18n/locales/en';
import { fr } from '@/i18n/locales/fr';
import { ha } from '@/i18n/locales/ha';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') entries.set(prefix + key, value);
    else for (const [k, v] of flatten(value, `${prefix}${key}.`)) entries.set(k, v);
  }
  return entries;
}

const catalogs = {
  en: flatten(en as unknown as Tree),
  ha: flatten(ha as unknown as Tree),
  fr: flatten(fr as unknown as Tree),
};

describe('catalogs', () => {
  it('have exactly the same keys', () => {
    const keys = [...catalogs.en.keys()].sort();
    expect([...catalogs.ha.keys()].sort()).toEqual(keys);
    expect([...catalogs.fr.keys()].sort()).toEqual(keys);
  });

  it('have no empty strings', () => {
    for (const [locale, entries] of Object.entries(catalogs)) {
      for (const [key, value] of entries) {
        if (value.trim() === '') throw new Error(`${locale}:${key} is empty`);
      }
    }
  });

  it('keep the same interpolation placeholders as English', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
    for (const [key, value] of catalogs.en) {
      expect(placeholders(catalogs.ha.get(key) ?? '')).toEqual(placeholders(value));
      expect(placeholders(catalogs.fr.get(key) ?? '')).toEqual(placeholders(value));
    }
  });
});

describe('docs/TRANSLATIONS_TO_REVIEW.md', () => {
  // Rows: | `key` | en | ha (draft) | fr (draft) | task |
  const doc = fs.readFileSync(path.join(__dirname, '../../docs/TRANSLATIONS_TO_REVIEW.md'), 'utf8');
  const rows = new Map(
    [...doc.matchAll(/^\| `([^`]+)` \| (.*?) \| (.*?) \| (.*?) \| [^|]+ \|$/gm)].map(
      (m) => [m[1] ?? '', { en: m[2], ha: m[3], fr: m[4] }] as const,
    ),
  );
  const unescape = (cell: string | undefined) => cell?.replace(/\\\|/g, '|');

  it('lists every ha/fr string with its current draft text', () => {
    for (const [key, value] of catalogs.en) {
      const row = rows.get(key);
      if (!row) throw new Error(`${key} is missing from TRANSLATIONS_TO_REVIEW.md`);
      expect(unescape(row.en)).toBe(value);
      expect(unescape(row.ha)).toBe(catalogs.ha.get(key));
      expect(unescape(row.fr)).toBe(catalogs.fr.get(key));
    }
  });

  it('has no rows for keys that no longer exist', () => {
    for (const key of rows.keys()) expect(catalogs.en.has(key)).toBe(true);
  });
});
