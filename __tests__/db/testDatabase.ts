import path from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from '@/db/schema';

export const MIGRATIONS_FOLDER = path.join(__dirname, '../../src/db/migrations');

/**
 * Fresh in-memory database with every checked-in migration applied, in the
 * same order as the app (src/db/client.ts): migrate with foreign keys off,
 * then switch them on.
 */
export function createTestDatabase() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  sqlite.pragma('foreign_keys = ON');
  return { db, sqlite };
}
