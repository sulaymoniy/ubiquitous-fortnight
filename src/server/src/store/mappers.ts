import type { Block, Changeset, Page, Workspace } from '@fortnight/shared';
import type * as t from '../db/schema.ts';

export type PageRow = typeof t.pages.$inferSelect;
export type BlockRow = typeof t.blocks.$inferSelect;

/** Stored page (kind `page` or `database`) → contract `Page`. Rows never map to `Page`. */
export function toPage(row: PageRow): Page {
  if (row.kind === 'row') throw new Error(`row ${row.id} is not a page`);
  return {
    id: row.id,
    parentId: row.parentId,
    kind: row.kind,
    databaseId: row.kind === 'database' ? row.databaseId : null,
    title: row.title,
    icon: row.icon,
    cover: row.cover,
    position: row.position,
    archivedAt: row.archivedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toBlock(row: BlockRow): Block {
  // Content is validated against the block type on every write.
  return {
    id: row.id,
    pageId: row.pageId,
    parentId: row.parentId,
    type: row.type,
    position: row.position,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as Block;
}

export function toWorkspace(row: typeof t.workspace.$inferSelect): Workspace {
  return {
    id: row.id,
    name: row.name,
    settings: row.settings,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toChangeset(row: typeof t.changesets.$inferSelect): Changeset {
  return {
    id: row.id,
    source: row.source,
    label: row.label,
    agentRunId: row.agentRunId,
    toolUseId: row.toolUseId,
    ops: row.ops,
    inverse: row.inverse,
    createdAt: row.createdAt,
    undoneAt: row.undoneAt,
  };
}

/** Sort by sibling position, then id, the order used everywhere for siblings. */
export function byPosition<T extends { position: string; id: string }>(a: T, b: T): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
