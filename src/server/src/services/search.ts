import type { BlockTypeContent, RichText, SearchResult } from '@fortnight/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { blocks, pages } from '../db/schema.ts';

/**
 * Full-text search over page and row titles and block text, using the FTS5 table `search_index`
 * (migration 0002). Rows: one per page/row title (`block_id` NULL) and one per block with text.
 * The index is updated in the same transaction as every change, so a word is findable as soon as
 * it is saved. Archived pages and rows are not indexed.
 */

const plain = (rich: RichText[]) => rich.map((r) => r.text).join('');

/** Plain text of a block, for search and snippets. */
export function blockPlainText(block: BlockTypeContent): string {
  switch (block.type) {
    case 'code':
      return block.content.text;
    case 'image':
      return plain(block.content.caption);
    case 'divider':
    case 'database_view':
      return '';
    default:
      return plain(block.content.rich);
  }
}

/** Rebuilds the index rows of one page or row (removes them if it is archived or gone). */
export function reindexPage(db: AppDatabase, pageId: string): void {
  const client = db.$client;
  client.prepare('DELETE FROM search_index WHERE page_id = ?').run(pageId);
  const [page] = db.select().from(pages).where(eq(pages.id, pageId)).all();
  if (!page || page.archivedAt !== null) return;
  const kind = page.kind === 'row' ? 'row' : 'page';
  const databaseId = page.kind === 'row' ? page.databaseId : null;
  const insert = client.prepare(
    'INSERT INTO search_index (page_id, block_id, kind, database_id, title, body) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insert.run(pageId, null, kind, databaseId, page.title, '');
  const rows = db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, pageId))
    .orderBy(asc(blocks.position))
    .all();
  for (const b of rows) {
    const text = blockPlainText({ type: b.type, content: b.content } as BlockTypeContent);
    if (text.trim() !== '') insert.run(pageId, b.id, kind, databaseId, '', text);
  }
}

export function reindexPages(db: AppDatabase, pageIds: Iterable<string>): void {
  for (const id of new Set(pageIds)) reindexPage(db, id);
}

/** Rebuilds the whole index. */
export function rebuildSearchIndex(db: AppDatabase): void {
  db.$client.exec('DELETE FROM search_index');
  for (const { id } of db.select({ id: pages.id }).from(pages).orderBy(asc(pages.id)).all()) {
    reindexPage(db, id);
  }
}

/** Rebuilds the index if it is empty while pages exist (first start after migration 0002). */
export function ensureSearchIndex(db: AppDatabase): void {
  const indexed = db.$client.prepare('SELECT 1 AS x FROM search_index LIMIT 1').get();
  const anyPage = db.select({ id: pages.id }).from(pages).limit(1).all();
  if (!indexed && anyPage.length > 0) rebuildSearchIndex(db);
}

/**
 * Turns user input into an FTS5 query: every word must match, the last ones as prefixes so results
 * appear while typing. Words are quoted, so FTS5 syntax in the input has no effect.
 */
export function toFtsQuery(q: string): string | null {
  const words = q.match(/[\p{L}\p{N}]+/gu);
  if (!words || words.length === 0) return null;
  return words
    .slice(0, 12)
    .map((w) => `"${w}"*`)
    .join(' ');
}

interface Hit {
  page_id: string;
  block_id: string | null;
  kind: 'page' | 'row';
  database_id: string | null;
  snippet: string;
}

/** Title matches first, then by relevance (bm25); one result per page or row. */
export function searchWorkspace(db: AppDatabase, q: string, limit: number): SearchResult[] {
  const fts = toFtsQuery(q);
  if (!fts) return [];
  const hits = db.$client
    .prepare(
      `SELECT page_id, block_id, kind, database_id,
              snippet(search_index, -1, '', '', '…', 16) AS snippet
         FROM search_index
        WHERE search_index MATCH ?
        ORDER BY (block_id IS NULL) DESC, bm25(search_index, 0, 0, 0, 0, 10.0, 1.0)
        LIMIT 1000`,
    )
    .all(fts) as unknown as Hit[];

  const best = new Map<string, Hit>();
  for (const h of hits) {
    if (!best.has(h.page_id)) best.set(h.page_id, h);
    if (best.size >= limit) break;
  }
  if (best.size === 0) return [];
  const titles = new Map(
    db
      .select({ id: pages.id, title: pages.title })
      .from(pages)
      .where(inArray(pages.id, [...best.keys()]))
      .all()
      .map((p) => [p.id, p.title]),
  );
  return [...best.values()].map((h) => ({
    kind: h.kind,
    id: h.page_id,
    pageId: h.page_id,
    databaseId: h.database_id,
    title: titles.get(h.page_id) ?? '',
    snippet: h.snippet,
    blockId: h.block_id,
  }));
}
