import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTableRelationsHelpers, extractTablesRelationalConfig } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.ts';
import { SqliteClient } from './sqlite.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Drizzle over `node:sqlite`. We use Drizzle's synchronous better-sqlite3 session with
 * `SqliteClient`, which implements the part of the better-sqlite3 API that session calls
 * (`sqlite.ts`). The database object is assembled here the same way `drizzle-orm/better-sqlite3`
 * does it, because that module imports the native `better-sqlite3` package at load time; the
 * session and migrator modules do not. Only better-sqlite3's TypeScript types are installed.
 */
export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: SqliteClient };

function createDrizzle(client: SqliteClient): AppDatabase {
  const dialect = new SQLiteSyncDialect({ casing: 'snake_case' });
  const tables = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
  const relational = {
    fullSchema: schema,
    schema: tables.tables,
    tableNamesMap: tables.tableNamesMap,
  };
  const session = new BetterSQLiteSession(
    client as unknown as ConstructorParameters<typeof BetterSQLiteSession>[0],
    dialect,
    relational,
  );
  const db = new BaseSQLiteDatabase('sync', dialect, session, relational) as unknown as AppDatabase;
  db.$client = client;
  return db;
}

/** Opens (or creates) the SQLite database. Use `':memory:'` for tests. */
export function openDatabase(file: string): AppDatabase {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const client = new SqliteClient(file);
  if (file !== ':memory:') client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  client.pragma('busy_timeout = 5000');
  return createDrizzle(client);
}

/** Applies pending migrations from `src/server/drizzle`. Safe to run on every start. */
export function runMigrations(db: AppDatabase): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
