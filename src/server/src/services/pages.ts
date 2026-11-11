import {
  isValidPosition,
  positionAfterLast,
  positionBetween,
  type CreatePageRequest,
  type UpdatePageRequest,
} from '@fortnight/shared';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { blocks, databases, pages } from '../db/schema.ts';
import { AppError } from '../http/errors.ts';
import { newId, nowIso } from '../ids.ts';
import { ChangeRecorder, inTransaction } from '../store/changes.ts';
import { byPosition, toPage, type PageRow } from '../store/mappers.ts';
import { reindexPages } from './search.ts';

export const SOURCE_USER = { source: 'user' } as const;

function invalid(path: (string | number)[], message: string): AppError {
  return new AppError(400, 'validation_error', message, {
    in: 'body',
    issues: [{ path, message }],
  });
}

/** A sidebar page (`page` or `database`); rows and missing ids are 404. */
export function getPageRow(db: AppDatabase, id: string): PageRow {
  const [row] = db.select().from(pages).where(eq(pages.id, id)).all();
  if (!row || row.kind === 'row') throw new AppError(404, 'not_found', 'Page not found');
  return row;
}

/** All sidebar pages (no rows), including archived ones. */
function allTreePages(db: AppDatabase): PageRow[] {
  return db.select().from(pages).where(ne(pages.kind, 'row')).all();
}

function siblingsOf(db: AppDatabase, parentId: string | null): PageRow[] {
  return db
    .select()
    .from(pages)
    .where(
      and(
        ne(pages.kind, 'row'),
        parentId === null ? isNull(pages.parentId) : eq(pages.parentId, parentId),
      ),
    )
    .all()
    .sort(byPosition);
}

/** Ids of `rootId` and every page below it. */
function subtreeIds(all: PageRow[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const p of all) {
    if (p.parentId) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p.id]);
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

function checkParent(db: AppDatabase, parentId: string, path: string[]): PageRow {
  const [parent] = db.select().from(pages).where(eq(pages.id, parentId)).all();
  if (!parent || parent.kind === 'row') throw invalid(path, 'parent page not found');
  if (parent.archivedAt !== null) throw invalid(path, 'parent page is archived');
  return parent;
}

export function listPages(db: AppDatabase, includeArchived: boolean) {
  const rows = db
    .select()
    .from(pages)
    .where(
      includeArchived
        ? ne(pages.kind, 'row')
        : and(ne(pages.kind, 'row'), isNull(pages.archivedAt)),
    )
    .orderBy(asc(pages.position), asc(pages.id))
    .all();
  return rows.map(toPage);
}

/** Blocks of a page or row, flat, ordered by parent (top level first) then position. */
export function pageBlocks(db: AppDatabase, pageId: string) {
  return db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, pageId))
    .orderBy(
      sql`${blocks.parentId} IS NOT NULL`,
      asc(blocks.parentId),
      asc(blocks.position),
      asc(blocks.id),
    )
    .all();
}

export function createPage(db: AppDatabase, body: CreatePageRequest) {
  return inTransaction(db, () => {
    const parentId = body.parentId ?? null;
    if (parentId) checkParent(db, parentId, ['parentId']);
    const siblings = siblingsOf(db, parentId);
    let position: string;
    if (body.afterId) {
      const i = siblings.findIndex((s) => s.id === body.afterId);
      if (i < 0) throw invalid(['afterId'], 'afterId is not a sibling under this parent');
      position = positionBetween(siblings[i]!.position, siblings[i + 1]?.position ?? null);
    } else {
      position = positionBetween(null, siblings[0]?.position ?? null);
    }
    const now = nowIso();
    const id = newId();
    const rec = new ChangeRecorder(db);
    rec.touch('page', id);
    db.insert(pages)
      .values({
        id,
        parentId,
        kind: 'page',
        title: body.title ?? '',
        icon: body.icon ?? null,
        cover: null,
        position,
        version: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    reindexPages(db, [id]);
    rec.commit({ ...SOURCE_USER, label: 'Create page' });
    return toPage(getPageRow(db, id));
  });
}

export function updatePage(db: AppDatabase, id: string, body: UpdatePageRequest) {
  return inTransaction(db, () => {
    const page = getPageRow(db, id);
    if (body.version !== page.version) {
      throw new AppError(409, 'version_conflict', 'The page changed since you loaded it', {
        entity: 'page',
        current: toPage(page),
      });
    }
    const patch: Partial<PageRow> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.cover !== undefined) patch.cover = body.cover;

    const moving = body.parentId !== undefined && body.parentId !== page.parentId;
    if (moving) {
      const parentId = body.parentId ?? null;
      if (parentId !== null) {
        checkParent(db, parentId, ['parentId']);
        if (subtreeIds(allTreePages(db), id).includes(parentId)) {
          throw invalid(['parentId'], 'cannot move a page under itself or its descendants');
        }
      }
      patch.parentId = parentId;
      if (body.position === undefined) {
        patch.position = positionAfterLast(siblingsOf(db, parentId).map((s) => s.position));
      }
    }
    if (body.position !== undefined) {
      if (!isValidPosition(body.position)) throw invalid(['position'], 'invalid position');
      patch.position = body.position;
    }

    const rec = new ChangeRecorder(db);
    rec.touch('page', id);
    db.update(pages)
      .set({ ...patch, version: page.version + 1, updatedAt: nowIso() })
      .where(eq(pages.id, id))
      .run();
    if (page.kind === 'database' && page.databaseId && body.title !== undefined) {
      rec.touch('database', page.databaseId);
      db.update(databases)
        .set({ title: body.title, updatedAt: nowIso() })
        .where(eq(databases.id, page.databaseId))
        .run();
    }
    reindexPages(db, [id]);
    const label = moving || body.position !== undefined ? 'Move page' : 'Edit page';
    rec.commit({ ...SOURCE_USER, label });
    return toPage(getPageRow(db, id));
  });
}

/**
 * Archives the page and every page below it that is not archived yet, all with the same
 * `archivedAt`, so restore can bring back exactly that set.
 */
export function archivePage(db: AppDatabase, id: string) {
  return inTransaction(db, () => {
    const page = getPageRow(db, id);
    if (page.archivedAt !== null) return toPage(page);
    const all = allTreePages(db);
    const byId = new Map(all.map((p) => [p.id, p]));
    const ids = subtreeIds(all, id).filter((pid) => byId.get(pid)!.archivedAt === null);
    const now = nowIso();
    const rec = new ChangeRecorder(db);
    for (const pid of ids) {
      rec.touch('page', pid);
      db.update(pages)
        .set({ archivedAt: now, version: byId.get(pid)!.version + 1, updatedAt: now })
        .where(eq(pages.id, pid))
        .run();
    }
    reindexPages(db, ids);
    rec.commit({ ...SOURCE_USER, label: 'Archive page' });
    return toPage(getPageRow(db, id));
  });
}

/**
 * Restores the page and the pages that were archived together with it. If its parent is still
 * archived (or gone), the page moves to the top level, at the end.
 */
export function restorePage(db: AppDatabase, id: string) {
  return inTransaction(db, () => {
    const page = getPageRow(db, id);
    if (page.archivedAt === null) return toPage(page);
    const all = allTreePages(db);
    const byId = new Map(all.map((p) => [p.id, p]));
    const ids = subtreeIds(all, id).filter((pid) => byId.get(pid)!.archivedAt === page.archivedAt);
    const parent = page.parentId ? byId.get(page.parentId) : undefined;
    const detach = page.parentId !== null && (!parent || parent.archivedAt !== null);
    const now = nowIso();
    const rec = new ChangeRecorder(db);
    for (const pid of ids) {
      rec.touch('page', pid);
      const extra =
        pid === id && detach
          ? {
              parentId: null,
              position: positionAfterLast(siblingsOf(db, null).map((s) => s.position)),
            }
          : {};
      db.update(pages)
        .set({ archivedAt: null, version: byId.get(pid)!.version + 1, updatedAt: now, ...extra })
        .where(eq(pages.id, pid))
        .run();
    }
    reindexPages(db, ids);
    rec.commit({ ...SOURCE_USER, label: 'Restore page' });
    return toPage(getPageRow(db, id));
  });
}

/** Used by the ops engine to make sure an id is not taken by a block on another page. */
export function blockIdsInUse(db: AppDatabase, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  return new Set(
    db
      .select({ id: blocks.id })
      .from(blocks)
      .where(inArray(blocks.id, ids))
      .all()
      .map((b) => b.id),
  );
}
