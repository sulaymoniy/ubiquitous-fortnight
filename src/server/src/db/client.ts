import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Opens (or creates) the SQLite database. Use `':memory:'` for tests. */
export function openDatabase(file: string): AppDatabase {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  if (file !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle({ client: sqlite, schema, casing: 'snake_case' });
}

/** Applies pending migrations from `src/server/drizzle`. Safe to run on every start. */
export function runMigrations(db: AppDatabase): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
