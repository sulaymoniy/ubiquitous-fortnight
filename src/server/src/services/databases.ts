import {
  isValidPosition,
  positionAfterLast,
  positionBetween,
  type CreateDatabaseRequest,
  type CreatePropertyRequest,
  type CreateRowRequest,
  type CreateViewRequest,
  type Property,
  type PropertyValue,
  type Row,
  type UpdatePropertyRequest,
  type UpdateRowRequest,
  type UpdateViewRequest,
  type View,
} from '@fortnight/shared';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { databases, pages, properties, views } from '../db/schema.ts';
import { AppError } from '../http/errors.ts';
import { newId, nowIso } from '../ids.ts';
import { ChangeRecorder, inTransaction } from '../store/changes.ts';
import { byPosition, toPage, type PageRow } from '../store/mappers.ts';
import { getPageRow, SOURCE_USER } from './pages.ts';
import { reindexPages } from './search.ts';

type DatabaseRow = typeof databases.$inferSelect;
type PropertyRow = typeof properties.$inferSelect;
type ViewRow = typeof views.$inferSelect;

export const invalid = (path: (string | number)[], message: string, where = 'body' as const) =>
  new AppError(400, 'validation_error', message, { in: where, issues: [{ path, message }] });

/* ------------------------------------------------------------------ mappers and loaders */

export const toDatabase = (d: DatabaseRow) => ({
  id: d.id,
  pageId: d.pageId,
  title: d.title,
  titlePropertyId: d.titlePropertyId,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

export const toProperty = (p: PropertyRow): Property =>
  ({
    id: p.id,
    databaseId: p.databaseId,
    name: p.name,
    position: p.position,
    type: p.type,
    config: p.config,
  }) as Property;

export const toView = (v: ViewRow): View => ({
  id: v.id,
  databaseId: v.databaseId,
  name: v.name,
  position: v.position,
  type: v.type,
  config: v.config,
});

export function getDatabaseRow(db: AppDatabase, id: string): DatabaseRow {
  const [row] = db.select().from(databases).where(eq(databases.id, id)).all();
  if (!row) throw new AppError(404, 'not_found', 'Database not found');
  return row;
}

export function databaseProperties(db: AppDatabase, databaseId: string): Property[] {
  return db
    .select()
    .from(properties)
    .where(eq(properties.databaseId, databaseId))
    .all()
    .sort(byPosition)
    .map(toProperty);
}

export function databaseViews(db: AppDatabase, databaseId: string): View[] {
  return db
    .select()
    .from(views)
    .where(eq(views.databaseId, databaseId))
    .all()
    .sort(byPosition)
    .map(toView);
}

export function getRowRow(db: AppDatabase, id: string): PageRow {
  const [row] = db.select().from(pages).where(eq(pages.id, id)).all();
  if (!row || row.kind !== 'row') throw new AppError(404, 'not_found', 'Row not found');
  return row;
}

/**
 * Stored row → contract `Row`. Values are cleaned on read: keys of deleted properties are dropped,
 * select/multi-select values keep only existing options, relations drop archived or missing rows.
 */
export function toRows(db: AppDatabase, rows: PageRow[], props: Property[]): Row[] {
  const byId = new Map(props.map((p) => [p.id, p]));
  const relationIds = new Set<string>();
  for (const r of rows) {
    for (const [pid, v] of Object.entries(r.properties ?? {})) {
      if (byId.get(pid)?.type === 'relation' && Array.isArray(v))
        v.forEach((x) => relationIds.add(x));
    }
  }
  const liveTargets = new Set(
    relationIds.size
      ? db
          .select({ id: pages.id })
          .from(pages)
          .where(and(inArray(pages.id, [...relationIds]), isNull(pages.archivedAt)))
          .all()
          .map((p) => p.id)
      : [],
  );
  return rows.map((r) => {
    const out: Record<string, PropertyValue> = {};
    for (const [pid, v] of Object.entries(r.properties ?? {})) {
      const p = byId.get(pid);
      if (!p || p.type === 'title') continue;
      if (p.type === 'select' && typeof v === 'string') {
        out[pid] = p.config.options.some((o) => o.id === v) ? v : null;
      } else if (p.type === 'multi_select' && Array.isArray(v)) {
        out[pid] = v.filter((x) => p.config.options.some((o) => o.id === x));
      } else if (p.type === 'relation' && Array.isArray(v)) {
        out[pid] = v.filter((x) => liveTargets.has(x));
      } else {
        out[pid] = v;
      }
    }
    return {
      id: r.id,
      databaseId: r.databaseId!,
      position: r.position,
      title: r.title,
      properties: out,
      archivedAt: r.archivedAt,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

export function rowById(db: AppDatabase, id: string): Row {
  const row = getRowRow(db, id);
  return toRows(db, [row], databaseProperties(db, row.databaseId!))[0]!;
}

/** Non-archived rows of a database (stored form), ordered by position. */
export function liveRows(db: AppDatabase, databaseId: string): PageRow[] {
  return db
    .select()
    .from(pages)
    .where(and(eq(pages.databaseId, databaseId), eq(pages.kind, 'row'), isNull(pages.archivedAt)))
    .orderBy(asc(pages.position), asc(pages.id))
    .all();
}

/* ------------------------------------------------------------------ value validation */

/**
 * Checks a value for a property; returns the value to store. Errors name the property, the
 * expected type and what was sent.
 */
function checkValue(
  db: AppDatabase,
  p: Property,
  value: PropertyValue,
  path: (string | number)[],
): PropertyValue {
  const fail = (expected: string) =>
    invalid(path, `"${p.name}" (${p.type}) expects ${expected}, got ${JSON.stringify(value)}`);
  switch (p.type) {
    case 'title':
      throw invalid(path, `"${p.name}" is the title; set it with "title"`);
    case 'text':
      if (value !== null && typeof value !== 'string') throw fail('a string or null');
      return value;
    case 'url':
      if (value === null) return null;
      if (typeof value !== 'string' || !/^(https?:\/\/|mailto:)\S+$/i.test(value)) {
        throw fail('an http(s) or mailto URL or null');
      }
      return value;
    case 'number':
      if (value !== null && typeof value !== 'number') throw fail('a number or null');
      return value;
    case 'checkbox':
      if (typeof value !== 'boolean') throw fail('true or false');
      return value;
    case 'select':
      if (value === null) return null;
      if (typeof value !== 'string' || !p.config.options.some((o) => o.id === value)) {
        throw fail(`one of the option ids ${JSON.stringify(p.config.options.map((o) => o.id))}`);
      }
      return value;
    case 'multi_select':
      if (
        !Array.isArray(value) ||
        new Set(value).size !== value.length ||
        !value.every((x) => p.config.options.some((o) => o.id === x))
      ) {
        throw fail('a list of distinct option ids');
      }
      return value;
    case 'date':
      if (value === null) return null;
      if (typeof value !== 'object' || Array.isArray(value)) throw fail('a date value or null');
      return value;
    case 'relation': {
      if (!Array.isArray(value) || new Set(value).size !== value.length) {
        throw fail('a list of distinct row ids');
      }
      if (value.length) {
        const found = db
          .select({ id: pages.id })
          .from(pages)
          .where(
            and(
              inArray(pages.id, value),
              eq(pages.kind, 'row'),
              eq(pages.databaseId, p.config.targetDatabaseId),
            ),
          )
          .all();
        if (found.length !== value.length) {
          throw fail(`row ids of database ${p.config.targetDatabaseId}`);
        }
      }
      return value;
    }
  }
}

function checkValues(
  db: AppDatabase,
  props: Property[],
  values: Record<string, PropertyValue>,
): Record<string, PropertyValue> {
  const byId = new Map(props.map((p) => [p.id, p]));
  const out: Record<string, PropertyValue> = {};
  for (const [pid, v] of Object.entries(values)) {
    const p = byId.get(pid);
    if (!p) throw invalid(['properties', pid], `unknown property id ${pid}`);
    out[pid] = checkValue(db, p, v, ['properties', pid]);
  }
  return out;
}

function checkConfig(db: AppDatabase, type: Property['type'], config: unknown, path: string[]) {
  const c = (config ?? {}) as Record<string, unknown>;
  const keys = Object.keys(c);
  switch (type) {
    case 'number':
      if (!('format' in c)) throw invalid(path, 'number properties need config.format');
      return;
    case 'select':
    case 'multi_select': {
      if (!Array.isArray(c.options)) throw invalid(path, `${type} properties need config.options`);
      const ids = (c.options as { id: string }[]).map((o) => o.id);
      if (new Set(ids).size !== ids.length) throw invalid(path, 'option ids must be unique');
      return;
    }
    case 'relation': {
      if (typeof c.targetDatabaseId !== 'string') {
        throw invalid(path, 'relation properties need config.targetDatabaseId');
      }
      const [t] = db.select().from(databases).where(eq(databases.id, c.targetDatabaseId)).all();
      if (!t) throw invalid(path, 'relation target database not found');
      return;
    }
    default:
      if (keys.length) throw invalid(path, `${type} properties take an empty config`);
  }
}

/* ------------------------------------------------------------------ databases */

export function createDatabase(db: AppDatabase, body: CreateDatabaseRequest) {
  return inTransaction(db, () => {
    const parentId = body.parentId ?? null;
    if (parentId) {
      const parent = getPageRow(db, parentId);
      if (parent.archivedAt) throw invalid(['parentId'], 'parent page is archived');
    }
    const siblings = db
      .select({ position: pages.position })
      .from(pages)
      .where(
        and(
          ne(pages.kind, 'row'),
          parentId === null ? isNull(pages.parentId) : eq(pages.parentId, parentId),
        ),
      )
      .all();
    const now = nowIso();
    const pageId = newId();
    const databaseId = newId();
    const titleId = newId();
    const rec = new ChangeRecorder(db);
    rec.touch('page', pageId);
    rec.touch('database', databaseId);
    db.insert(pages)
      .values({
        id: pageId,
        parentId,
        kind: 'database',
        databaseId,
        title: body.title,
        position: positionAfterLast(siblings.map((s) => s.position)),
        version: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(databases)
      .values({
        id: databaseId,
        pageId,
        title: body.title,
        titlePropertyId: titleId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const defs = [
      { name: 'Name', type: 'title' as const, config: {} },
      ...(body.properties ?? []).map((p, i) => {
        if (p.type === 'title') throw invalid(['properties', i, 'type'], 'only one title property');
        checkConfig(db, p.type, p.config, ['properties', String(i), 'config']);
        return p;
      }),
    ];
    let pos: string | null = null;
    defs.forEach((d, i) => {
      const id = i === 0 ? titleId : newId();
      pos = positionBetween(pos, null);
      rec.touch('property', id);
      db.insert(properties)
        .values({
          id,
          databaseId,
          name: d.name,
          type: d.type,
          config: d.config,
          position: pos,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
    const viewId = newId();
    rec.touch('view', viewId);
    db.insert(views)
      .values({
        id: viewId,
        databaseId,
        name: 'Table',
        type: 'table',
        position: 'a0',
        config: {},
        createdAt: now,
        updatedAt: now,
      })
      .run();
    reindexPages(db, [pageId]);
    rec.commit({ ...SOURCE_USER, label: 'Create database' });
    return {
      database: toDatabase(getDatabaseRow(db, databaseId)),
      page: toPage(getPageRow(db, pageId)),
      properties: databaseProperties(db, databaseId),
      views: databaseViews(db, databaseId),
    };
  });
}

export function renameDatabase(db: AppDatabase, id: string, title: string | undefined) {
  return inTransaction(db, () => {
    const d = getDatabaseRow(db, id);
    if (title === undefined || title === d.title) return toDatabase(d);
    const rec = new ChangeRecorder(db);
    rec.touch('database', id);
    rec.touch('page', d.pageId);
    const now = nowIso();
    const page = getPageRow(db, d.pageId);
    db.update(databases).set({ title, updatedAt: now }).where(eq(databases.id, id)).run();
    db.update(pages)
      .set({ title, version: page.version + 1, updatedAt: now })
      .where(eq(pages.id, d.pageId))
      .run();
    reindexPages(db, [d.pageId]);
    rec.commit({ ...SOURCE_USER, label: 'Rename database' });
    return toDatabase(getDatabaseRow(db, id));
  });
}

/* ------------------------------------------------------------------ properties */

function getPropertyRow(db: AppDatabase, id: string): PropertyRow {
  const [row] = db.select().from(properties).where(eq(properties.id, id)).all();
  if (!row) throw new AppError(404, 'not_found', 'Property not found');
  return row;
}

function afterPosition(
  list: { id: string; position: string }[],
  afterId: string | null | undefined,
) {
  const sorted = [...list].sort(byPosition);
  if (afterId === undefined) return positionAfterLast(sorted.map((x) => x.position));
  if (afterId === null) return positionBetween(null, sorted[0]?.position ?? null);
  const i = sorted.findIndex((x) => x.id === afterId);
  if (i < 0) throw invalid(['afterId'], 'afterId is not in this list');
  return positionBetween(sorted[i]!.position, sorted[i + 1]?.position ?? null);
}

export function createProperty(db: AppDatabase, databaseId: string, body: CreatePropertyRequest) {
  return inTransaction(db, () => {
    getDatabaseRow(db, databaseId);
    if (body.type === 'title') throw invalid(['type'], 'a database has exactly one title property');
    checkConfig(db, body.type, body.config, ['config']);
    const existing = db
      .select()
      .from(properties)
      .where(eq(properties.databaseId, databaseId))
      .all();
    const id = newId();
    const now = nowIso();
    const rec = new ChangeRecorder(db);
    rec.touch('property', id);
    db.insert(properties)
      .values({
        id,
        databaseId,
        name: body.name,
        type: body.type,
        config: body.config,
        position: afterPosition(existing, body.afterId),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    rec.commit({ ...SOURCE_USER, label: 'Add property' });
    return toProperty(getPropertyRow(db, id));
  });
}

/** Rename, reconfigure (same type) or reorder. Option ids are stable, so renames keep values. */
export function updateProperty(db: AppDatabase, id: string, body: UpdatePropertyRequest) {
  return inTransaction(db, () => {
    const p = getPropertyRow(db, id);
    if (body.config !== undefined) checkConfig(db, p.type, body.config, ['config']);
    if (body.position !== undefined && !isValidPosition(body.position)) {
      throw invalid(['position'], 'invalid position');
    }
    const rec = new ChangeRecorder(db);
    rec.touch('property', id);
    db.update(properties)
      .set({
        name: body.name ?? p.name,
        config: (body.config ?? p.config) as Record<string, unknown>,
        position: body.position ?? p.position,
        updatedAt: nowIso(),
      })
      .where(eq(properties.id, id))
      .run();
    rec.commit({ ...SOURCE_USER, label: 'Edit property' });
    return toProperty(getPropertyRow(db, id));
  });
}

/** Deletes a property and its values on every row, in one undoable changeset. */
export function deleteProperty(db: AppDatabase, id: string): string {
  return inTransaction(db, () => {
    const p = getPropertyRow(db, id);
    const d = getDatabaseRow(db, p.databaseId);
    if (d.titlePropertyId === id)
      throw invalid(['id'], 'the title property cannot be deleted', 'params' as 'body');
    const rec = new ChangeRecorder(db);
    rec.touch('property', id);
    const rows = db
      .select()
      .from(pages)
      .where(and(eq(pages.databaseId, p.databaseId), eq(pages.kind, 'row')))
      .all();
    for (const r of rows) {
      if (!r.properties || !(id in r.properties)) continue;
      rec.touch('row', r.id);
      const { [id]: _dropped, ...rest } = r.properties;
      db.update(pages).set({ properties: rest }).where(eq(pages.id, r.id)).run();
    }
    db.delete(properties).where(eq(properties.id, id)).run();
    return rec.commit({ ...SOURCE_USER, label: `Delete property "${p.name}"` })!;
  });
}

/* ------------------------------------------------------------------ rows */

export function createRow(db: AppDatabase, databaseId: string, body: CreateRowRequest) {
  return inTransaction(db, () => {
    getDatabaseRow(db, databaseId);
    const props = databaseProperties(db, databaseId);
    const values = checkValues(db, props, body.properties ?? {});
    const siblings = db
      .select({ id: pages.id, position: pages.position })
      .from(pages)
      .where(and(eq(pages.databaseId, databaseId), eq(pages.kind, 'row')))
      .all();
    const id = newId();
    const now = nowIso();
    const rec = new ChangeRecorder(db);
    rec.touch('row', id);
    db.insert(pages)
      .values({
        id,
        parentId: null,
        kind: 'row',
        databaseId,
        title: body.title ?? '',
        properties: values,
        position: afterPosition(siblings, body.afterId ?? undefined),
        version: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    reindexPages(db, [id]);
    rec.commit({ ...SOURCE_USER, label: 'Add row' });
    return rowById(db, id);
  });
}

export function updateRow(db: AppDatabase, id: string, body: UpdateRowRequest, label = 'Edit row') {
  return inTransaction(db, () => {
    const row = getRowRow(db, id);
    if (body.version !== row.version) {
      throw new AppError(409, 'version_conflict', 'The row changed since you loaded it', {
        entity: 'row',
        current: rowById(db, id),
      });
    }
    const props = databaseProperties(db, row.databaseId!);
    const values = checkValues(db, props, body.properties ?? {});
    if (body.position !== undefined && !isValidPosition(body.position)) {
      throw invalid(['position'], 'invalid position');
    }
    const rec = new ChangeRecorder(db);
    rec.touch('row', id);
    db.update(pages)
      .set({
        title: body.title ?? row.title,
        properties: { ...(row.properties ?? {}), ...values },
        position: body.position ?? row.position,
        version: row.version + 1,
        updatedAt: nowIso(),
      })
      .where(eq(pages.id, id))
      .run();
    reindexPages(db, [id]);
    rec.commit({ ...SOURCE_USER, label });
    return rowById(db, id);
  });
}

export function setRowArchived(db: AppDatabase, id: string, archived: boolean) {
  return inTransaction(db, () => {
    const row = getRowRow(db, id);
    if ((row.archivedAt !== null) === archived) return rowById(db, id);
    const rec = new ChangeRecorder(db);
    rec.touch('row', id);
    const now = nowIso();
    db.update(pages)
      .set({ archivedAt: archived ? now : null, version: row.version + 1, updatedAt: now })
      .where(eq(pages.id, id))
      .run();
    reindexPages(db, [id]);
    rec.commit({ ...SOURCE_USER, label: archived ? 'Archive row' : 'Restore row' });
    return rowById(db, id);
  });
}

/* ------------------------------------------------------------------ views */

function getViewRow(db: AppDatabase, id: string): ViewRow {
  const [row] = db.select().from(views).where(eq(views.id, id)).all();
  if (!row) throw new AppError(404, 'not_found', 'View not found');
  return row;
}

export function createView(db: AppDatabase, databaseId: string, body: CreateViewRequest) {
  return inTransaction(db, () => {
    getDatabaseRow(db, databaseId);
    const existing = db.select().from(views).where(eq(views.databaseId, databaseId)).all();
    const id = newId();
    const now = nowIso();
    const rec = new ChangeRecorder(db);
    rec.touch('view', id);
    db.insert(views)
      .values({
        id,
        databaseId,
        name: body.name,
        type: body.type,
        config: body.config ?? {},
        position: positionAfterLast(existing.map((v) => v.position)),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    rec.commit({ ...SOURCE_USER, label: 'Add view' });
    return toView(getViewRow(db, id));
  });
}

export function updateView(db: AppDatabase, id: string, body: UpdateViewRequest) {
  return inTransaction(db, () => {
    const v = getViewRow(db, id);
    if (body.position !== undefined && !isValidPosition(body.position)) {
      throw invalid(['position'], 'invalid position');
    }
    const rec = new ChangeRecorder(db);
    rec.touch('view', id);
    db.update(views)
      .set({
        name: body.name ?? v.name,
        config: body.config ?? v.config,
        position: body.position ?? v.position,
        updatedAt: nowIso(),
      })
      .where(eq(views.id, id))
      .run();
    rec.commit({ ...SOURCE_USER, label: 'Edit view' });
    return toView(getViewRow(db, id));
  });
}

export function deleteView(db: AppDatabase, id: string) {
  inTransaction(db, () => {
    getViewRow(db, id);
    const rec = new ChangeRecorder(db);
    rec.touch('view', id);
    db.delete(views).where(eq(views.id, id)).run();
    rec.commit({ ...SOURCE_USER, label: 'Delete view' });
  });
  return {};
}
