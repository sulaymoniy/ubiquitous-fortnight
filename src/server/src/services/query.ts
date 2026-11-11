import {
  MAX_FILTER_DEPTH,
  type DateValue,
  type Filter,
  type FilterCondition,
  type Property,
  type QueryDatabaseRequest,
  type Row,
  type Sort,
} from '@fortnight/shared';
import type { AppDatabase } from '../db/client.ts';
import { workspace } from '../db/schema.ts';
import { AppError } from '../http/errors.ts';
import {
  databaseProperties,
  databaseViews,
  getDatabaseRow,
  liveRows,
  toRows,
} from './databases.ts';
import { addDays, fromLocal, localDateOf, startOfWeek, today } from './tz.ts';

const OPS_BY_TYPE: Record<Property['type'], readonly string[]> = {
  title: ['contains', 'not_contains', 'equals', 'starts_with', 'is_empty', 'is_not_empty'],
  text: ['contains', 'not_contains', 'equals', 'starts_with', 'is_empty', 'is_not_empty'],
  url: ['contains', 'not_contains', 'equals', 'starts_with', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  select: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  multi_select: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  date: [
    'on',
    'before',
    'after',
    'on_or_before',
    'on_or_after',
    'between',
    'past_week',
    'next_week',
    'this_week',
    'this_month',
    'is_empty',
    'is_not_empty',
  ],
  checkbox: ['is'],
  relation: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
};
const NO_VALUE = new Set([
  'is_empty',
  'is_not_empty',
  'past_week',
  'next_week',
  'this_week',
  'this_month',
]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface QueryContext {
  props: Map<string, Property>;
  titlePropertyId: string;
  timeZone: string;
  weekStartsOn: 0 | 1;
  /** Local "today" in the workspace zone. */
  today: string;
}

const bad = (message: string) =>
  new AppError(400, 'validation_error', message, {
    in: 'body',
    issues: [{ path: ['filter'], message }],
  });

/**
 * Checks a filter against the database's properties: known property, op allowed for its type,
 * value of the right shape, nesting depth. With `lenient` (saved view filters), conditions on
 * deleted properties are dropped instead of rejected.
 */
export function checkFilter(
  filter: Filter,
  ctx: QueryContext,
  lenient = false,
  depth = 0,
): Filter | null {
  if ('and' in filter || 'or' in filter) {
    if (depth >= MAX_FILTER_DEPTH) throw bad(`filters nest at most ${MAX_FILTER_DEPTH} levels`);
    const list = 'and' in filter ? filter.and : filter.or;
    const kept = list
      .map((f) => checkFilter(f, ctx, lenient, depth + 1))
      .filter((f): f is Filter => f !== null);
    return 'and' in filter ? { and: kept } : { or: kept };
  }
  const p = ctx.props.get(filter.propertyId);
  if (!p) {
    if (lenient) return null;
    throw bad(`unknown property ${filter.propertyId}`);
  }
  if (!OPS_BY_TYPE[p.type].includes(filter.op)) {
    throw bad(
      `"${p.name}" (${p.type}) does not support "${filter.op}"; use one of ${OPS_BY_TYPE[p.type].join(', ')}`,
    );
  }
  const v = filter.value;
  const need = (ok: boolean, what: string) => {
    if (!ok) throw bad(`"${filter.op}" on "${p.name}" needs ${what}`);
  };
  if (NO_VALUE.has(filter.op)) return filter;
  switch (p.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'select':
    case 'multi_select':
    case 'relation':
      need(typeof v === 'string', 'a string value');
      break;
    case 'number':
      need(typeof v === 'number', 'a number value');
      break;
    case 'checkbox':
      need(typeof v === 'boolean', 'true or false');
      break;
    case 'date':
      if (filter.op === 'between') {
        need(
          typeof v === 'object' && v !== null && v.start <= v.end,
          '{ start, end } dates with start <= end',
        );
      } else {
        need(typeof v === 'string' && DATE.test(v), 'a YYYY-MM-DD date');
      }
  }
  return filter;
}

function valueOf(row: Row, p: Property, ctx: QueryContext): unknown {
  return p.id === ctx.titlePropertyId ? row.title : row.properties[p.id];
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function matchCondition(row: Row, c: FilterCondition, ctx: QueryContext): boolean {
  const p = ctx.props.get(c.propertyId)!;
  const v = valueOf(row, p, ctx);
  if (c.op === 'is_empty') return p.type === 'checkbox' ? v !== true : isEmpty(v);
  if (c.op === 'is_not_empty') return p.type === 'checkbox' ? v === true : !isEmpty(v);
  switch (p.type) {
    case 'title':
    case 'text':
    case 'url': {
      const s = typeof v === 'string' ? v.toLowerCase() : '';
      const q = String(c.value).toLowerCase();
      if (c.op === 'contains') return s.includes(q);
      if (c.op === 'not_contains') return !s.includes(q);
      if (c.op === 'equals') return s === q;
      return s.startsWith(q);
    }
    case 'number': {
      if (typeof v !== 'number') return c.op === 'neq';
      const q = c.value as number;
      return { eq: v === q, neq: v !== q, gt: v > q, gte: v >= q, lt: v < q, lte: v <= q }[
        c.op as 'eq'
      ];
    }
    case 'select':
      return c.op === 'is' ? v === c.value : v !== c.value;
    case 'multi_select':
    case 'relation': {
      const has = Array.isArray(v) && v.includes(c.value as string);
      return c.op === 'contains' ? has : !has;
    }
    case 'checkbox':
      return (v === true) === c.value;
    case 'date': {
      if (!v) return false;
      const d = localDateOf((v as DateValue).start, ctx.timeZone);
      const t = ctx.today;
      switch (c.op) {
        case 'on':
          return d === c.value;
        case 'before':
          return d < (c.value as string);
        case 'after':
          return d > (c.value as string);
        case 'on_or_before':
          return d <= (c.value as string);
        case 'on_or_after':
          return d >= (c.value as string);
        case 'between': {
          const r = c.value as { start: string; end: string };
          return d >= r.start && d <= r.end;
        }
        case 'past_week':
          return d >= addDays(t, -7) && d <= t;
        case 'next_week':
          return d >= t && d <= addDays(t, 7);
        case 'this_week': {
          const s = startOfWeek(t, ctx.weekStartsOn);
          return d >= s && d <= addDays(s, 6);
        }
        case 'this_month':
          return d.slice(0, 7) === t.slice(0, 7);
      }
    }
  }
  return false;
}

export function matches(row: Row, filter: Filter, ctx: QueryContext): boolean {
  if ('and' in filter) return filter.and.every((f) => matches(row, f, ctx));
  if ('or' in filter) return filter.or.length === 0 || filter.or.some((f) => matches(row, f, ctx));
  return matchCondition(row, filter, ctx);
}

/** Sort key; null sorts last in both directions. */
function sortKey(row: Row, s: Sort, ctx: QueryContext): string | number | null {
  if (s.propertyId === 'created_time') return row.createdAt;
  if (s.propertyId === 'updated_time') return row.updatedAt;
  const p = ctx.props.get(s.propertyId);
  if (!p) return null;
  const v = valueOf(row, p, ctx);
  if (isEmpty(v)) return null;
  switch (p.type) {
    case 'number':
      return v as number;
    case 'checkbox':
      return v ? 1 : 0;
    case 'date': {
      const dv = v as DateValue;
      return dv.allDay
        ? fromLocal({ date: dv.start, hour: 0, minute: 0, second: 0 }, ctx.timeZone)
        : Date.parse(dv.start);
    }
    case 'select': {
      const i = p.config.options.findIndex((o) => o.id === v);
      return i;
    }
    case 'multi_select':
    case 'relation':
      return (v as string[]).length;
    default:
      return String(v).toLowerCase();
  }
}

export function sortRows(rows: Row[], sorts: Sort[], ctx: QueryContext): Row[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const s of sorts) {
      const ka = sortKey(a, s, ctx);
      const kb = sortKey(b, s, ctx);
      if (ka === kb) continue;
      if (ka === null) return 1;
      if (kb === null) return -1;
      const cmp = ka < kb ? -1 : 1;
      return s.direction === 'asc' ? cmp : -cmp;
    }
    if (a.position !== b.position) return a.position < b.position ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return sorted;
}

export function queryContext(db: AppDatabase, databaseId: string, now = Date.now()): QueryContext {
  const d = getDatabaseRow(db, databaseId);
  const props = databaseProperties(db, databaseId);
  const [ws] = db.select().from(workspace).limit(1).all();
  const timeZone = ws?.settings.timeZone ?? 'UTC';
  return {
    props: new Map(props.map((p) => [p.id, p])),
    titlePropertyId: d.titlePropertyId,
    timeZone,
    weekStartsOn: ws?.settings.weekStartsOn ?? 1,
    today: today(timeZone, now),
  };
}

/**
 * POST /api/databases/:id/query. A view's saved filter is combined (AND) with the request filter;
 * request sorts replace the view's sorts. Default order: row position. The cursor is an opaque
 * offset into the sorted result.
 */
export function queryDatabase(db: AppDatabase, databaseId: string, req: QueryDatabaseRequest) {
  const ctx = queryContext(db, databaseId);
  const filters: Filter[] = [];
  let sorts: Sort[] = req.sorts ?? [];
  if (req.viewId) {
    const view = databaseViews(db, databaseId).find((v) => v.id === req.viewId);
    if (!view) throw bad(`view ${req.viewId} is not in this database`);
    if (view.config.filter) {
      const f = checkFilter(view.config.filter, ctx, true);
      if (f) filters.push(f);
    }
    if (!req.sorts)
      sorts = (view.config.sorts ?? []).filter(
        (s) => ctx.props.has(s.propertyId) || s.propertyId.endsWith('_time'),
      );
  }
  if (req.filter) filters.push(checkFilter(req.filter, ctx)!);
  for (const s of sorts) {
    if (
      !ctx.props.has(s.propertyId) &&
      s.propertyId !== 'created_time' &&
      s.propertyId !== 'updated_time'
    ) {
      throw bad(`unknown sort property ${s.propertyId}`);
    }
  }
  const all = toRows(db, liveRows(db, databaseId), [...ctx.props.values()]);
  const filtered = all.filter((r) => filters.every((f) => matches(r, f, ctx)));
  const sorted = sortRows(filtered, sorts, ctx);

  const limit = req.limit ?? 100;
  let offset = 0;
  if (req.cursor) {
    const n = Number(Buffer.from(req.cursor, 'base64url').toString('utf8'));
    if (!Number.isInteger(n) || n < 0) throw bad('invalid cursor');
    offset = n;
  }
  const page = sorted.slice(offset, offset + limit);
  const next =
    offset + limit < sorted.length
      ? Buffer.from(String(offset + limit)).toString('base64url')
      : null;
  return { rows: page, nextCursor: next };
}
