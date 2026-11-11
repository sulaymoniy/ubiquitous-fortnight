import {
  AGENT_TOOL_INPUTS,
  MUTATING_AGENT_TOOLS,
  positionAfterLast,
  positionBetween,
  type AffectedEntities,
  type AgentFilter,
  type AgentPropertyValue,
  type AgentToolName,
  type BlockOp,
  type DateValue,
  type Filter,
  type Property,
  type PropertyValue,
  type Row,
} from '@fortnight/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { v7 } from 'uuid';
import { z } from 'zod';
import type { AppDatabase } from '../db/client.ts';
import { blocks, databases, pages, properties } from '../db/schema.ts';
import { AppError } from '../http/errors.ts';
import { blocksToMarkdown, markdownToNodes, type BlockNode } from '../markdown/markdown.ts';
import { calendarEvents } from '../services/calendar.ts';
import {
  createRow,
  databaseProperties,
  databaseViews,
  getDatabaseRow,
  getRowRow,
  rowById,
  setRowArchived,
  updateProperty,
  updateRow,
} from '../services/databases.ts';
import { applyBlockOps } from '../services/ops.ts';
import {
  archivePage,
  createPage,
  getPageRow,
  listPages,
  pageBlocks,
  updatePage,
} from '../services/pages.ts';
import { queryDatabase } from '../services/query.ts';
import { searchWorkspace } from '../services/search.ts';
import { withGroupedChangeset } from '../store/changes.ts';
import { toBlock } from '../store/mappers.ts';

/**
 * The agent's tools (plan 4.6). Properties are referenced by name (case-insensitive), page
 * content goes in and out as Markdown, and every mutating tool call is ONE changeset tagged with
 * the run and tool-use id. Errors become `is_error` tool results; they never end the run.
 */

export interface ToolOutcome {
  ok: boolean;
  /** Short line for the tool card in the UI. */
  summary: string;
  /** What the model receives (JSON text). */
  content: string;
  changesetId: string | null;
  affected: AffectedEntities;
}

export const TOOL_DESCRIPTIONS: Record<AgentToolName, string> = {
  search_workspace:
    'Full-text search over page titles, page text and database rows. Returns ids, titles and snippets.',
  list_pages:
    'List sidebar pages as a tree (ids, titles, kinds). parentId null or omitted = top level.',
  get_page:
    'Read a page or database row: title, path, Markdown body, and its blocks with ids (for update_block / delete_blocks).',
  create_page: 'Create a page, optionally under a parent and with a Markdown body.',
  update_page: 'Rename a page, change its icon, or move it (parentId null = top level).',
  archive_page: 'Archive (soft-delete) a page and its sub-pages. Undoable.',
  append_blocks:
    'Add Markdown content to a page or row body: at the end, after a block, or inside a parent block.',
  update_block:
    'Replace one block with Markdown (the block type may change). Extra Markdown blocks are inserted after it.',
  delete_blocks: 'Delete blocks (and their children) by id. Undoable.',
  list_databases: 'List databases with their property names and types.',
  get_database: 'Read a database: properties (with select options) and views.',
  query_database:
    'Query rows with a filter and sorts that use property NAMES. Values come back by property name.',
  create_row:
    'Add a row. `properties` maps property names to values (select: option name, created if missing).',
  update_row: 'Change a row title or property values (by property name). null clears a value.',
  archive_row: 'Archive (soft-delete) a database row. Undoable.',
  list_events: 'List calendar events between two ISO date-times (recurring events are expanded).',
  create_event:
    'Create a calendar event (a row in the Calendar database by default). Times are ISO 8601 with an offset; all-day events use YYYY-MM-DD. Recurrence: RRULE subset, e.g. FREQ=WEEKLY;BYDAY=FR.',
  move_event:
    'Reschedule an event (the whole series for recurring events). Keeps the duration when end is omitted.',
  delete_event: 'Archive an event row. Undoable.',
};

/** JSON schemas for the API, generated from the shared Zod schemas. */
export function toolDefinitions(names: readonly AgentToolName[]) {
  return names.map((name) => {
    const { $schema: _s, ...schema } = z.toJSONSchema(AGENT_TOOL_INPUTS[name]) as Record<
      string,
      unknown
    >;
    return {
      name,
      description: TOOL_DESCRIPTIONS[name],
      input_schema: { type: 'object' as const, ...schema },
      eager_input_streaming: true,
    };
  });
}

export function toolsForProfile(access: 'all' | 'read_only'): AgentToolName[] {
  const all = Object.keys(AGENT_TOOL_INPUTS) as AgentToolName[];
  return access === 'all'
    ? all
    : all.filter((n) => !(MUTATING_AGENT_TOOLS as readonly string[]).includes(n));
}

export const isMutating = (name: string) =>
  (MUTATING_AGENT_TOOLS as readonly string[]).includes(name);

/* ------------------------------------------------------------------ helpers */

const noneAffected = (): AffectedEntities => ({ pageIds: [], rowIds: [], databaseIds: [] });
class ToolError extends Error {}
const fail = (msg: string): never => {
  throw new ToolError(msg);
};

function anyPage(db: AppDatabase, id: string) {
  const [p] = db.select().from(pages).where(eq(pages.id, id)).all();
  if (!p) fail(`No page or row with id ${id}`);
  return p!;
}

/** Turns Markdown into insert ops (with fresh ids) under `parentId`, between two positions. */
function insertOps(
  nodes: BlockNode[],
  parentId: string | null,
  before: string | null,
  after: string | null,
): BlockOp[] {
  const ops: BlockOp[] = [];
  const positions = nodes.length ? positionsBetweenSafe(before, after, nodes.length) : [];
  nodes.forEach((n, i) => {
    const id = v7();
    ops.push({
      op: 'insert',
      block: { id, parentId, position: positions[i]!, type: n.type, content: n.content } as Extract<
        BlockOp,
        { op: 'insert' }
      >['block'],
    });
    ops.push(...insertOps(n.children, id, null, null));
  });
  return ops;
}

function positionsBetweenSafe(before: string | null, after: string | null, n: number): string[] {
  const out: string[] = [];
  let prev = before;
  for (let i = 0; i < n; i++) {
    prev = positionBetween(prev, after);
    out.push(prev);
  }
  return out;
}

function pagePath(db: AppDatabase, id: string): string {
  const titles: string[] = [];
  let cur: string | null = id;
  for (let i = 0; cur && i < 20; i++) {
    const [p] = db.select().from(pages).where(eq(pages.id, cur)).all();
    if (!p) break;
    titles.unshift(p.title || 'Untitled');
    cur = p.kind === 'row' ? (getDatabaseRow(db, p.databaseId!).pageId ?? null) : p.parentId;
  }
  return titles.join(' / ');
}

function propertyByName(props: Property[], name: string): Property {
  const p = props.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!p) fail(`Unknown property "${name}". Valid names: ${props.map((x) => x.name).join(', ')}`);
  return p!;
}

function toDateValue(v: {
  start: string;
  end?: string;
  allDay?: boolean;
  recurrence?: string;
}): DateValue {
  const allDay = v.allDay ?? /^\d{4}-\d{2}-\d{2}$/.test(v.start);
  return { start: v.start, end: v.end ?? null, allDay, recurrence: v.recurrence ?? null };
}

/** Converts name-keyed agent values to id-keyed stored values; may add select options. */
function resolveValues(
  db: AppDatabase,
  databaseId: string,
  values: Record<string, AgentPropertyValue>,
  notes: string[],
): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const [name, raw] of Object.entries(values)) {
    let props = databaseProperties(db, databaseId);
    const p = propertyByName(props, name);
    if (p.type === 'title') fail(`"${p.name}" is the title; set it with "title"`);
    if (raw === null) {
      out[p.id] =
        p.type === 'multi_select' || p.type === 'relation'
          ? []
          : p.type === 'checkbox'
            ? false
            : null;
      continue;
    }
    switch (p.type) {
      case 'select':
      case 'multi_select': {
        const names = Array.isArray(raw) ? raw : [raw];
        const ids: string[] = [];
        for (const n of names) {
          if (typeof n !== 'string') fail(`"${p.name}" takes option names`);
          let opt = p.config.options.find(
            (o) => o.name.toLowerCase() === (n as string).toLowerCase(),
          );
          if (!opt) {
            opt = { id: v7(), name: n as string, color: 'default' };
            updateProperty(db, p.id, { config: { options: [...p.config.options, opt] } });
            notes.push(`Created option "${n}" in "${p.name}".`);
            props = databaseProperties(db, databaseId);
            Object.assign(p, propertyByName(props, p.name));
          }
          ids.push(opt.id);
        }
        out[p.id] = p.type === 'select' ? (ids[0] ?? null) : ids;
        break;
      }
      case 'date':
        if (typeof raw !== 'object' || Array.isArray(raw))
          fail(`"${p.name}" takes { start, end?, allDay?, recurrence? }`);
        out[p.id] = toDateValue(raw as { start: string });
        break;
      case 'relation': {
        const refs = Array.isArray(raw) ? raw : [raw];
        const target = p.config.targetDatabaseId;
        out[p.id] = refs.map((r) => {
          const ref = String(r);
          const [byId] = db
            .select()
            .from(pages)
            .where(and(eq(pages.id, ref), eq(pages.databaseId, target)))
            .all();
          if (byId) return byId.id;
          const byTitle = db
            .select()
            .from(pages)
            .where(
              and(eq(pages.databaseId, target), eq(pages.kind, 'row'), isNull(pages.archivedAt)),
            )
            .all()
            .find((x) => x.title.toLowerCase() === ref.toLowerCase());
          if (!byTitle) fail(`No row "${ref}" in the related database`);
          return byTitle!.id;
        });
        break;
      }
      default:
        out[p.id] = raw as PropertyValue;
    }
  }
  return out;
}

/** Row → readable object with values keyed by property name (options by name). */
function readableRow(row: Row, props: Property[]) {
  const values: Record<string, unknown> = {};
  for (const p of props) {
    if (p.type === 'title') continue;
    const v = row.properties[p.id];
    if (v === undefined) continue;
    if (p.type === 'select')
      values[p.name] = p.config.options.find((o) => o.id === v)?.name ?? null;
    else if (p.type === 'multi_select')
      values[p.name] = (v as string[]).map(
        (id) => p.config.options.find((o) => o.id === id)?.name ?? id,
      );
    else values[p.name] = v;
  }
  return { id: row.id, title: row.title, properties: values };
}

function agentFilterToFilter(f: AgentFilter, props: Property[]): Filter {
  if ('and' in f) return { and: f.and.map((x) => agentFilterToFilter(x, props)) };
  if ('or' in f) return { or: f.or.map((x) => agentFilterToFilter(x, props)) };
  const p = propertyByName(props, f.property);
  let value = f.value;
  if ((p.type === 'select' || p.type === 'multi_select') && typeof value === 'string') {
    const opt = p.config.options.find(
      (o) => o.name.toLowerCase() === (value as string).toLowerCase(),
    );
    value = opt?.id ?? value;
  }
  return value === undefined
    ? { propertyId: p.id, op: f.op }
    : { propertyId: p.id, op: f.op, value };
}

function defaultCalendarDatabase(db: AppDatabase): string {
  const all = db.select().from(databases).all();
  const withDate = all.filter(
    (d) =>
      db
        .select()
        .from(properties)
        .where(and(eq(properties.databaseId, d.id), eq(properties.type, 'date')))
        .all().length > 0,
  );
  const named = withDate.find((d) => d.title.toLowerCase() === 'calendar');
  const pick = named ?? withDate[0];
  if (!pick) fail('No database with a date property; create one first');
  return pick!.id;
}

function dateProperty(db: AppDatabase, databaseId: string): Property {
  const p = databaseProperties(db, databaseId).find((x) => x.type === 'date');
  if (!p) fail('This database has no date property');
  return p!;
}

const json = (v: unknown) => JSON.stringify(v);

/* ------------------------------------------------------------------ dispatch */

type Ctx = { db: AppDatabase; affected: AffectedEntities; notes: string[] };
type Handler = (ctx: Ctx, input: never) => { summary: string; data: unknown };

const H: Record<AgentToolName, Handler> = {
  search_workspace: ({ db }, i: { query: string; limit?: number }) => {
    const results = searchWorkspace(db, i.query, i.limit ?? 10);
    return { summary: `Found ${results.length} result(s) for "${i.query}"`, data: results };
  },
  list_pages: ({ db }, i: { parentId?: string | null; depth?: number }) => {
    const all = listPages(db, false);
    const depth = i.depth ?? 2;
    const build = (parentId: string | null, d: number): unknown[] =>
      all
        .filter((p) => p.parentId === parentId)
        .sort((a, b) => (a.position < b.position ? -1 : 1))
        .map((p) => ({
          id: p.id,
          title: p.title,
          kind: p.kind,
          ...(p.databaseId ? { databaseId: p.databaseId } : {}),
          ...(d > 1 ? { children: build(p.id, d - 1) } : {}),
        }));
    const tree = build(i.parentId ?? null, depth);
    return { summary: `Listed ${tree.length} page(s)`, data: tree };
  },
  get_page: ({ db }, i: { pageId: string }) => {
    const p = anyPage(db, i.pageId);
    const list = pageBlocks(db, p.id).map(toBlock);
    const extra = p.kind === 'row' ? { databaseId: p.databaseId, row: rowById(db, p.id) } : {};
    return {
      summary: `Read "${p.title || 'Untitled'}"`,
      data: {
        id: p.id,
        kind: p.kind,
        title: p.title,
        path: pagePath(db, p.id),
        ...extra,
        markdown: blocksToMarkdown(list),
        blocks: list.map((b) => ({
          id: b.id,
          parentId: b.parentId,
          type: b.type,
          text:
            'rich' in b.content
              ? b.content.rich
                  .map((r) => r.text)
                  .join('')
                  .slice(0, 120)
              : undefined,
        })),
      },
    };
  },
  create_page: (
    { db, affected },
    i: { title: string; parentId?: string; icon?: string; markdown?: string },
  ) => {
    const parentId = i.parentId ?? null;
    const siblings = listPages(db, true).filter((p) => p.parentId === parentId);
    const last = [...siblings].sort((a, b) => (a.position < b.position ? -1 : 1)).at(-1);
    const page = createPage(db, {
      title: i.title,
      parentId,
      icon: i.icon ?? null,
      ...(last ? { afterId: last.id } : {}),
    });
    if (i.markdown)
      applyBlockOps(db, page.id, insertOps(markdownToNodes(i.markdown), null, null, null));
    affected.pageIds.push(page.id);
    return { summary: `Created page "${i.title}"`, data: { id: page.id, title: page.title } };
  },
  update_page: (
    { db, affected },
    i: { pageId: string; title?: string; icon?: string; parentId?: string | null },
  ) => {
    const p = getPageRow(db, i.pageId);
    const page = updatePage(db, p.id, {
      version: p.version,
      ...(i.title !== undefined ? { title: i.title } : {}),
      ...(i.icon !== undefined ? { icon: i.icon } : {}),
      ...(i.parentId !== undefined ? { parentId: i.parentId } : {}),
    });
    affected.pageIds.push(p.id);
    return {
      summary: `Updated page "${page.title}"`,
      data: { id: page.id, title: page.title, parentId: page.parentId },
    };
  },
  archive_page: ({ db, affected }, i: { pageId: string }) => {
    const page = archivePage(db, i.pageId);
    affected.pageIds.push(page.id);
    return { summary: `Archived page "${page.title}"`, data: { id: page.id, archived: true } };
  },
  append_blocks: (
    { db, affected },
    i: { pageId: string; markdown: string; afterBlockId?: string; parentBlockId?: string },
  ) => {
    const p = anyPage(db, i.pageId);
    const existing = db.select().from(blocks).where(eq(blocks.pageId, p.id)).all();
    let parentId: string | null = i.parentBlockId ?? null;
    if (parentId && !existing.some((b) => b.id === parentId))
      fail('parentBlockId is not on this page');
    let before: string | null;
    let after: string | null = null;
    if (i.afterBlockId) {
      const anchor = existing.find((b) => b.id === i.afterBlockId);
      if (!anchor) fail('afterBlockId is not on this page');
      parentId = anchor!.parentId;
      const sibs = existing
        .filter((b) => b.parentId === parentId)
        .sort((a, b) => (a.position < b.position ? -1 : 1));
      before = anchor!.position;
      after = sibs[sibs.findIndex((b) => b.id === anchor!.id) + 1]?.position ?? null;
    } else {
      before =
        existing
          .filter((b) => b.parentId === parentId)
          .map((b) => b.position)
          .sort()
          .at(-1) ?? null;
    }
    const ops = insertOps(markdownToNodes(i.markdown), parentId, before, after);
    if (!ops.length) fail('The Markdown produced no blocks');
    applyBlockOps(db, p.id, ops);
    (p.kind === 'row' ? affected.rowIds : affected.pageIds).push(p.id);
    return {
      summary: `Added ${ops.length} block(s) to "${p.title || 'Untitled'}"`,
      data: { added: ops.length },
    };
  },
  update_block: ({ db, affected }, i: { blockId: string; markdown: string }) => {
    const [b] = db.select().from(blocks).where(eq(blocks.id, i.blockId)).all();
    if (!b) fail(`No block ${i.blockId}`);
    const nodes = markdownToNodes(i.markdown);
    const first = nodes[0];
    const ops: BlockOp[] = first
      ? [{ op: 'update', id: b!.id, type: first.type, content: first.content } as BlockOp]
      : [{ op: 'delete', id: b!.id }];
    if (first) {
      ops.push(...insertOps(first.children, b!.id, positionAfterLastChild(db, b!.id), null));
      const sibs = db
        .select()
        .from(blocks)
        .where(and(eq(blocks.pageId, b!.pageId)))
        .all()
        .filter((x) => x.parentId === b!.parentId)
        .sort((x, y) => (x.position < y.position ? -1 : 1));
      const next = sibs[sibs.findIndex((x) => x.id === b!.id) + 1]?.position ?? null;
      ops.push(...insertOps(nodes.slice(1), b!.parentId, b!.position, next));
    }
    applyBlockOps(db, b!.pageId, ops);
    const p = anyPage(db, b!.pageId);
    (p.kind === 'row' ? affected.rowIds : affected.pageIds).push(p.id);
    return {
      summary: first ? 'Updated a block' : 'Removed an empty block',
      data: { blockId: b!.id },
    };
  },
  delete_blocks: ({ db, affected }, i: { blockIds: string[] }) => {
    const found = db.select().from(blocks).where(inArray(blocks.id, i.blockIds)).all();
    const missing = i.blockIds.filter((id) => !found.some((b) => b.id === id));
    if (missing.length) fail(`Unknown block ids: ${missing.join(', ')}`);
    const byPage = new Map<string, string[]>();
    for (const b of found) byPage.set(b.pageId, [...(byPage.get(b.pageId) ?? []), b.id]);
    for (const [pageId, ids] of byPage) {
      // Skip ids already removed with an ancestor in the same call.
      const live = new Set(
        db
          .select({ id: blocks.id })
          .from(blocks)
          .where(eq(blocks.pageId, pageId))
          .all()
          .map((x) => x.id),
      );
      const ops: BlockOp[] = [];
      const gone = new Set<string>();
      for (const id of ids) {
        if (!live.has(id) || gone.has(id)) continue;
        ops.push({ op: 'delete', id });
        const stack = [id];
        const all = db.select().from(blocks).where(eq(blocks.pageId, pageId)).all();
        while (stack.length) {
          const cur = stack.pop()!;
          gone.add(cur);
          for (const c of all) if (c.parentId === cur) stack.push(c.id);
        }
      }
      if (ops.length) applyBlockOps(db, pageId, ops);
      const p = anyPage(db, pageId);
      (p.kind === 'row' ? affected.rowIds : affected.pageIds).push(pageId);
    }
    return {
      summary: `Deleted ${i.blockIds.length} block(s)`,
      data: { deleted: i.blockIds.length },
    };
  },
  list_databases: ({ db }) => {
    const list = db
      .select()
      .from(databases)
      .all()
      .map((d) => ({
        id: d.id,
        title: d.title,
        properties: databaseProperties(db, d.id).map((p) => ({ name: p.name, type: p.type })),
      }));
    return { summary: `Listed ${list.length} database(s)`, data: list };
  },
  get_database: ({ db }, i: { databaseId: string }) => {
    const d = getDatabaseRow(db, i.databaseId);
    const props = databaseProperties(db, d.id).map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      ...('options' in p.config ? { options: p.config.options.map((o) => o.name) } : {}),
    }));
    const views = databaseViews(db, d.id).map((v) => ({ id: v.id, name: v.name, type: v.type }));
    return {
      summary: `Read database "${d.title}"`,
      data: { id: d.id, title: d.title, properties: props, views },
    };
  },
  query_database: (
    { db },
    i: {
      databaseId: string;
      filter?: AgentFilter;
      sorts?: { property: string; direction: 'asc' | 'desc' }[];
      limit?: number;
    },
  ) => {
    const d = getDatabaseRow(db, i.databaseId);
    const props = databaseProperties(db, d.id);
    const sorts = (i.sorts ?? []).map((s) => ({
      propertyId:
        s.property === 'created_time' || s.property === 'updated_time'
          ? s.property
          : propertyByName(props, s.property).id,
      direction: s.direction,
    }));
    const res = queryDatabase(db, d.id, {
      ...(i.filter ? { filter: agentFilterToFilter(i.filter, props) } : {}),
      sorts,
      limit: i.limit ?? 50,
    });
    return {
      summary: `Found ${res.rows.length} row(s) in "${d.title}"`,
      data: { rows: res.rows.map((r) => readableRow(r, props)), more: res.nextCursor !== null },
    };
  },
  create_row: (
    { db, affected, notes },
    i: { databaseId: string; title: string; properties?: Record<string, AgentPropertyValue> },
  ) => {
    getDatabaseRow(db, i.databaseId);
    const row = createRow(db, i.databaseId, {
      title: i.title,
      properties: resolveValues(db, i.databaseId, i.properties ?? {}, notes),
    });
    affected.rowIds.push(row.id);
    affected.databaseIds.push(i.databaseId);
    return { summary: `Added row "${row.title}"`, data: { id: row.id, title: row.title } };
  },
  update_row: (
    { db, affected, notes },
    i: { rowId: string; title?: string; properties?: Record<string, AgentPropertyValue> },
  ) => {
    const r = getRowRow(db, i.rowId);
    const row = updateRow(db, r.id, {
      version: r.version,
      ...(i.title !== undefined ? { title: i.title } : {}),
      properties: resolveValues(db, r.databaseId!, i.properties ?? {}, notes),
    });
    affected.rowIds.push(row.id);
    affected.databaseIds.push(row.databaseId);
    return { summary: `Updated row "${row.title}"`, data: { id: row.id, title: row.title } };
  },
  archive_row: ({ db, affected }, i: { rowId: string }) => {
    const row = setRowArchived(db, i.rowId, true);
    affected.rowIds.push(row.id);
    affected.databaseIds.push(row.databaseId);
    return { summary: `Archived row "${row.title}"`, data: { id: row.id, archived: true } };
  },
  list_events: ({ db }, i: { from: string; to: string; databaseIds?: string[] }) => {
    const events = calendarEvents(db, i.from, i.to, i.databaseIds).map((e) => ({
      rowId: e.rowId,
      title: e.title,
      start: e.occurrenceStart,
      end: e.occurrenceEnd,
      allDay: e.allDay,
      recurrence: e.recurrence,
    }));
    return { summary: `Found ${events.length} event(s)`, data: events };
  },
  create_event: (
    { db, affected, notes },
    i: {
      title: string;
      start: string;
      end?: string;
      allDay?: boolean;
      recurrence?: string;
      databaseId?: string;
      properties?: Record<string, AgentPropertyValue>;
      notes?: string;
    },
  ) => {
    const databaseId = i.databaseId ?? defaultCalendarDatabase(db);
    const dateProp = dateProperty(db, databaseId);
    const values = resolveValues(db, databaseId, i.properties ?? {}, notes);
    values[dateProp.id] = toDateValue({
      start: i.start,
      ...(i.end ? { end: i.end } : {}),
      ...(i.allDay !== undefined ? { allDay: i.allDay } : {}),
      ...(i.recurrence ? { recurrence: i.recurrence } : {}),
    });
    const notesProp = databaseProperties(db, databaseId).find(
      (p) => p.type === 'text' && p.name.toLowerCase() === 'notes',
    );
    if (i.notes && notesProp) values[notesProp.id] = i.notes;
    const row = createRow(db, databaseId, { title: i.title, properties: values });
    if (i.notes && !notesProp)
      applyBlockOps(db, row.id, insertOps(markdownToNodes(i.notes), null, null, null));
    affected.rowIds.push(row.id);
    affected.databaseIds.push(databaseId);
    return {
      summary: `Created event "${i.title}"`,
      data: { rowId: row.id, title: row.title, date: values[dateProp.id] },
    };
  },
  move_event: (
    { db, affected },
    i: { rowId: string; start: string; end?: string; allDay?: boolean },
  ) => {
    const r = getRowRow(db, i.rowId);
    const dateProp = dateProperty(db, r.databaseId!);
    const current = (r.properties?.[dateProp.id] ?? null) as DateValue | null;
    const allDay = i.allDay ?? /^\d{4}-\d{2}-\d{2}$/.test(i.start);
    let end = i.end ?? null;
    if (!end && current?.end && current.allDay === allDay) {
      const shift = Date.parse(i.start) - Date.parse(current.start);
      const shifted = new Date(Date.parse(current.end) + shift);
      end = allDay ? shifted.toISOString().slice(0, 10) : shifted.toISOString();
    }
    const value: DateValue = {
      start: i.start,
      end,
      allDay,
      recurrence: current?.recurrence ?? null,
    };
    const row = updateRow(
      db,
      r.id,
      { version: r.version, properties: { [dateProp.id]: value } },
      'Move event',
    );
    affected.rowIds.push(row.id);
    affected.databaseIds.push(row.databaseId);
    return { summary: `Moved "${row.title}"`, data: { rowId: row.id, date: value } };
  },
  delete_event: ({ db, affected }, i: { rowId: string }) => {
    const row = setRowArchived(db, i.rowId, true);
    affected.rowIds.push(row.id);
    affected.databaseIds.push(row.databaseId);
    return { summary: `Deleted event "${row.title}"`, data: { rowId: row.id, archived: true } };
  },
};

function positionAfterLastChild(db: AppDatabase, parentId: string): string | null {
  const kids = db
    .select({ position: blocks.position })
    .from(blocks)
    .where(eq(blocks.parentId, parentId))
    .all();
  return kids.length ? positionAfterLast(kids.map((k) => k.position)) : null;
}

export interface RunToolOptions {
  access: 'all' | 'read_only';
  agentRunId: string;
  toolUseId: string;
}

/**
 * Validates and runs one tool call. Mutating tools run in one transaction recorded as ONE
 * changeset (`source: 'agent'`, tagged with run and tool-use id); any error rolls it back and is
 * returned as an `is_error` result.
 */
export function runTool(
  db: AppDatabase,
  name: string,
  input: unknown,
  opts: RunToolOptions,
): ToolOutcome {
  const affected = noneAffected();
  const errorOut = (message: string): ToolOutcome => ({
    ok: false,
    summary: message,
    content: json({ error: message }),
    changesetId: null,
    affected: noneAffected(),
  });
  if (!(name in AGENT_TOOL_INPUTS)) return errorOut(`Unknown tool ${name}`);
  const tool = name as AgentToolName;
  if (opts.access === 'read_only' && isMutating(tool)) {
    return errorOut(`${tool} is not available: this agent profile is read-only`);
  }
  const parsed = AGENT_TOOL_INPUTS[tool].safeParse(input);
  if (!parsed.success) {
    return errorOut(
      `Invalid input for ${tool}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
    );
  }
  const ctx: Ctx = { db, affected, notes: [] };
  try {
    const exec = () =>
      (H[tool] as (c: Ctx, i: unknown) => { summary: string; data: unknown })(ctx, parsed.data);
    if (!isMutating(tool)) {
      const r = exec();
      return { ok: true, summary: r.summary, content: json(r.data), changesetId: null, affected };
    }
    const { result, changesetId } = withGroupedChangeset(
      db,
      {
        source: 'agent',
        label: `Agent: ${tool}`,
        agentRunId: opts.agentRunId,
        toolUseId: opts.toolUseId,
      },
      exec,
    );
    const dedupe = (xs: string[]) => [...new Set(xs)];
    const content = ctx.notes.length
      ? { ...(result.data as object), notes: ctx.notes }
      : result.data;
    return {
      ok: true,
      summary: result.summary,
      content: json(content),
      changesetId,
      affected: {
        pageIds: dedupe(affected.pageIds),
        rowIds: dedupe(affected.rowIds),
        databaseIds: dedupe(affected.databaseIds),
      },
    };
  } catch (err) {
    if (err instanceof ToolError || err instanceof AppError) return errorOut(err.message);
    throw err;
  }
}
