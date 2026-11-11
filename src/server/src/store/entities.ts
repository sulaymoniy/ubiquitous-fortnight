import type { EntityKind } from '@fortnight/shared';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import * as t from '../db/schema.ts';

/**
 * Generic access to an entity's stored row by kind and id. The changeset log records these stored
 * rows (`ChangeOp.value`), and undo writes them back, so they must round-trip exactly.
 */
export type StoredRow = Record<string, unknown>;

const TABLES = {
  workspace: t.workspace,
  page: t.pages,
  row: t.pages,
  block: t.blocks,
  database: t.databases,
  property: t.properties,
  view: t.views,
} as const;

export function getStored(db: AppDatabase, entity: EntityKind, id: string): StoredRow | null {
  const table = TABLES[entity];
  const [row] = db.select().from(table).where(eq(table.id, id)).limit(1).all();
  return (row as StoredRow | undefined) ?? null;
}

/** Inserts or fully replaces the stored row. */
export function putStored(db: AppDatabase, entity: EntityKind, value: StoredRow): void {
  const table = TABLES[entity];
  // The value is a complete stored row of this table, as returned by `getStored`.
  const row = value as typeof table.$inferInsert;
  db.insert(table).values(row).onConflictDoUpdate({ target: table.id, set: row }).run();
}

export function removeStored(db: AppDatabase, entity: EntityKind, id: string): void {
  const table = TABLES[entity];
  db.delete(table).where(eq(table.id, id)).run();
}

/** Stable comparison of two stored rows (or absence). */
export function sameStored(a: StoredRow | null, b: StoredRow | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
