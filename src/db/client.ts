import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { createRepositories, type Repositories } from './repositories';
import * as schema from './schema';

const DATABASE_NAME = 'pdfreader.db';

let connection: SQLiteDatabase | null = null;
let database: ExpoSQLiteDatabase<typeof schema> | null = null;
let repositories: Repositories | null = null;

/**
 * The app's single database connection, opened on first use. Foreign keys are
 * still OFF here on purpose: drizzle runs migrations inside one transaction,
 * where `PRAGMA foreign_keys` cannot be changed, so a table-recreating
 * migration with foreign keys ON would cascade-delete child rows. They are
 * switched on in getRepositories(), which runs only after migrations.
 */
export function getDatabase(): ExpoSQLiteDatabase<typeof schema> {
  if (database === null) {
    connection = openDatabaseSync(DATABASE_NAME);
    connection.execSync('PRAGMA journal_mode = WAL;');
    database = drizzle(connection, { schema });
  }
  return database;
}

/**
 * Repositories bound to the app database. Call only after migrations have
 * succeeded (app/_layout.tsx renders nothing until then).
 */
export function getRepositories(): Repositories {
  if (repositories === null) {
    const db = getDatabase();
    connection?.execSync('PRAGMA foreign_keys = ON;');
    repositories = createRepositories(db);
  }
  return repositories;
}
