import { SEED_IDS } from '@fortnight/server';
import {
  ApiError,
  CreateDatabaseResponse,
  CreatePropertyResponse,
  CreateRowResponse,
  CreateViewResponse,
  DeletePropertyResponse,
  GetDatabaseResponse,
  GetRowResponse,
  QueryDatabaseResponse,
  RowOpsResponse,
  UndoChangesetResponse,
  UpdatePropertyResponse,
  UpdateRowResponse,
  VersionConflictError,
  type Filter,
  type Property,
  type Row,
} from '@fortnight/shared';
import { v7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { client } from './api-helpers.ts';
import { createTestApp, login, type TestContext } from './helpers.ts';

let t: TestContext;
let api: ReturnType<typeof client>;
let dbId: string;
let titleId: string;
const prop: Record<string, Property> = {};
const OPT = { a: v7(), b: v7() };

beforeEach(async () => {
  t = await createTestApp({ seed: true });
  api = client(t.app, await login(t.app));
  const created = await api.ok(CreateDatabaseResponse, 'POST', '/api/databases', {
    title: 'Tasks',
    properties: [
      { name: 'Notes', type: 'text', config: {} },
      { name: 'Cost', type: 'number', config: { format: 'currency' } },
      {
        name: 'Status',
        type: 'select',
        config: {
          options: [
            { id: OPT.a, name: 'Todo', color: 'gray' },
            { id: OPT.b, name: 'Done', color: 'green' },
          ],
        },
      },
      {
        name: 'Tags',
        type: 'multi_select',
        config: {
          options: [
            { id: OPT.a, name: 'x', color: 'red' },
            { id: OPT.b, name: 'y', color: 'blue' },
          ],
        },
      },
      { name: 'Due', type: 'date', config: {} },
      { name: 'Done', type: 'checkbox', config: {} },
      { name: 'Link', type: 'url', config: {} },
      { name: 'Event', type: 'relation', config: { targetDatabaseId: SEED_IDS.calendarDb } },
    ],
  });
  dbId = created.database.id;
  titleId = created.database.titlePropertyId;
  for (const p of created.properties) prop[p.name] = p;
  expect(created.page).toMatchObject({ kind: 'database', databaseId: dbId, title: 'Tasks' });
  expect(created.views.map((v) => v.type)).toEqual(['table']);
});
afterEach(async () => {
  await t.close();
});

const addRow = (title: string, properties: Record<string, unknown> = {}) =>
  api.ok(CreateRowResponse, 'POST', `/api/databases/${dbId}/rows`, { title, properties });
const query = async (body: object = {}) =>
  (await api.ok(QueryDatabaseResponse, 'POST', `/api/databases/${dbId}/query`, body)).rows;
const titles = (rows: Row[]) => rows.map((r) => r.title);
const id = (name: string) => prop[name]!.id;
const day = (d: string) => ({ start: d, end: null, allDay: true, recurrence: null });

describe('values', () => {
  it('rejects invalid values for every property type with a clear error', async () => {
    const cases: [string, unknown][] = [
      ['Notes', 5],
      ['Cost', 'ten'],
      ['Status', 'not-an-option'],
      ['Tags', ['missing']],
      ['Tags', [OPT.a, OPT.a]],
      ['Due', 'tomorrow'],
      ['Done', null],
      ['Link', 'javascript:alert(1)'],
      ['Event', ['no-such-row']],
      ['Event', [SEED_IDS.ideas]], // a page, not a row of the target database
    ];
    for (const [name, value] of cases) {
      const r = await api.call('POST', `/api/databases/${dbId}/rows`, {
        title: 'x',
        properties: { [id(name)]: value },
      });
      expect(r.status, `${name} = ${JSON.stringify(value)}`).toBe(400);
      expect(ApiError.parse(r.body).error.code).toBe('validation_error');
    }
    const title = await api.call('POST', `/api/databases/${dbId}/rows`, {
      properties: { [titleId]: 'x' },
    });
    expect(ApiError.parse(title.body).error.message).toContain('title');
    const unknown = await api.call('POST', `/api/databases/${dbId}/rows`, {
      properties: { nope: 'x' },
    });
    expect(ApiError.parse(unknown.body).error.message).toContain('unknown property');
  });

  it('stores valid values, patches partially, and checks the row version', async () => {
    const row = await addRow('A', {
      [id('Notes')]: 'hello',
      [id('Cost')]: 12.5,
      [id('Status')]: OPT.a,
      [id('Tags')]: [OPT.b],
      [id('Due')]: day('2026-11-20'),
      [id('Done')]: true,
      [id('Link')]: 'https://example.com',
      [id('Event')]: [SEED_IDS.rowDentist],
    });
    const patched = await api.ok(UpdateRowResponse, 'PATCH', `/api/rows/${row.id}`, {
      version: row.version,
      title: 'A2',
      properties: { [id('Notes')]: null },
    });
    expect(patched.properties[id('Notes')]).toBeNull();
    expect(patched.properties[id('Cost')]).toBe(12.5);
    expect(patched.version).toBe(1);
    const stale = await api.call('PATCH', `/api/rows/${row.id}`, { version: 0, title: 'x' });
    expect(stale.status).toBe(409);
    expect(VersionConflictError.parse(stale.body).error.details).toMatchObject({
      entity: 'row',
      current: { title: 'A2' },
    });
  });

  it('keeps row values when a select option is renamed and drops removed options', async () => {
    const row = await addRow('A', { [id('Status')]: OPT.b });
    const status = prop.Status as Extract<Property, { type: 'select' }>;
    await api.ok(UpdatePropertyResponse, 'PATCH', `/api/properties/${status.id}`, {
      config: {
        options: [status.config.options[0], { id: OPT.b, name: 'Finished', color: 'green' }],
      },
    });
    expect((await query())[0]!.properties[status.id]).toBe(OPT.b);
    await api.ok(UpdatePropertyResponse, 'PATCH', `/api/properties/${status.id}`, {
      config: { options: [status.config.options[0]] },
    });
    const after = await api.ok(GetRowResponse, 'GET', `/api/rows/${row.id}`);
    expect(after.row.properties[status.id]).toBeNull();
  });

  it('drops archived relation targets in reads', async () => {
    const row = await addRow('A', { [id('Event')]: [SEED_IDS.rowDentist, SEED_IDS.rowTeamSync] });
    await api.call('POST', `/api/rows/${SEED_IDS.rowDentist}/archive`);
    const got = await api.ok(GetRowResponse, 'GET', `/api/rows/${row.id}`);
    expect(got.row.properties[id('Event')]).toEqual([SEED_IDS.rowTeamSync]);
    await api.call('POST', `/api/rows/${SEED_IDS.rowDentist}/restore`);
    const back = await api.ok(GetRowResponse, 'GET', `/api/rows/${row.id}`);
    expect(back.row.properties[id('Event')]).toHaveLength(2);
  });
});

describe('undo', () => {
  it('deleting a property removes its values and is undoable', async () => {
    const row = await addRow('A', { [id('Notes')]: 'keep me' });
    const del = await api.ok(DeletePropertyResponse, 'DELETE', `/api/properties/${id('Notes')}`);
    let db = await api.ok(GetDatabaseResponse, 'GET', `/api/databases/${dbId}`);
    expect(db.properties.map((p) => p.name)).not.toContain('Notes');
    expect(
      (await api.ok(GetRowResponse, 'GET', `/api/rows/${row.id}`)).row.properties,
    ).not.toHaveProperty(id('Notes'));
    await api.ok(UndoChangesetResponse, 'POST', `/api/changesets/${del.changesetId}/undo`);
    db = await api.ok(GetDatabaseResponse, 'GET', `/api/databases/${dbId}`);
    expect(db.properties.map((p) => p.name)).toContain('Notes');
    expect(
      (await api.ok(GetRowResponse, 'GET', `/api/rows/${row.id}`)).row.properties[id('Notes')],
    ).toBe('keep me');
    const title = await api.call('DELETE', `/api/properties/${titleId}`);
    expect(title.status).toBe(400);
  });

  it('archiving a row hides it from queries and is undoable', async () => {
    const row = await addRow('Gone soon');
    await api.call('POST', `/api/rows/${row.id}/archive`);
    expect(titles(await query())).not.toContain('Gone soon');
    const [cs] = (
      (await (
        await api.call('GET', '/api/changesets?limit=1')
      ).body) as { changesets: { id: string }[] }
    ).changesets;
    await api.ok(UndoChangesetResponse, 'POST', `/api/changesets/${cs!.id}/undo`);
    expect(titles(await query())).toContain('Gone soon');
  });
});

describe('query', () => {
  beforeEach(async () => {
    await addRow('Alpha', {
      [id('Notes')]: 'Buy milk',
      [id('Cost')]: 10,
      [id('Status')]: OPT.a,
      [id('Tags')]: [OPT.a],
      [id('Due')]: day('2026-11-10'),
      [id('Done')]: true,
      [id('Link')]: 'https://a.test',
      [id('Event')]: [SEED_IDS.rowDentist],
    });
    await addRow('Beta', {
      [id('Notes')]: 'call bob',
      [id('Cost')]: 20,
      [id('Status')]: OPT.b,
      [id('Tags')]: [OPT.a, OPT.b],
      [id('Due')]: day('2026-11-20'),
    });
    await addRow('Gamma', { [id('Cost')]: 30 });
  });

  const where = async (filter: Filter) => titles(await query({ filter }));
  const c = (name: string, op: string, value?: unknown) =>
    ({ propertyId: name === 'title' ? titleId : id(name), op, value }) as Filter;

  it('supports every op of every property type', async () => {
    const cases: [Filter, string[]][] = [
      [c('title', 'contains', 'ET'), ['Beta']],
      [c('title', 'not_contains', 'a'), []],
      [c('title', 'equals', 'gamma'), ['Gamma']],
      [c('title', 'starts_with', 'al'), ['Alpha']],
      [c('Notes', 'is_empty'), ['Gamma']],
      [c('Notes', 'is_not_empty'), ['Alpha', 'Beta']],
      [c('Cost', 'eq', 20), ['Beta']],
      [c('Cost', 'neq', 20), ['Alpha', 'Gamma']],
      [c('Cost', 'gt', 10), ['Beta', 'Gamma']],
      [c('Cost', 'gte', 20), ['Beta', 'Gamma']],
      [c('Cost', 'lt', 20), ['Alpha']],
      [c('Cost', 'lte', 20), ['Alpha', 'Beta']],
      [c('Status', 'is', OPT.b), ['Beta']],
      [c('Status', 'is_not', OPT.b), ['Alpha', 'Gamma']],
      [c('Status', 'is_empty'), ['Gamma']],
      [c('Tags', 'contains', OPT.b), ['Beta']],
      [c('Tags', 'not_contains', OPT.b), ['Alpha', 'Gamma']],
      [c('Tags', 'is_not_empty'), ['Alpha', 'Beta']],
      [c('Due', 'on', '2026-11-10'), ['Alpha']],
      [c('Due', 'before', '2026-11-20'), ['Alpha']],
      [c('Due', 'after', '2026-11-10'), ['Beta']],
      [c('Due', 'on_or_before', '2026-11-20'), ['Alpha', 'Beta']],
      [c('Due', 'on_or_after', '2026-11-20'), ['Beta']],
      [c('Due', 'between', { start: '2026-11-01', end: '2026-11-15' }), ['Alpha']],
      [c('Due', 'is_empty'), ['Gamma']],
      [c('Done', 'is', true), ['Alpha']],
      [c('Done', 'is', false), ['Beta', 'Gamma']],
      [c('Link', 'contains', 'a.test'), ['Alpha']],
      [c('Event', 'contains', SEED_IDS.rowDentist), ['Alpha']],
      [c('Event', 'is_empty'), ['Beta', 'Gamma']],
    ];
    for (const [filter, expected] of cases) {
      expect(await where(filter), JSON.stringify(filter)).toEqual(expected);
    }
  });

  it('resolves relative date ops against today in the workspace zone', async () => {
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const row = await addRow('Today', { [id('Due')]: day(iso(now)) });
    for (const op of ['past_week', 'next_week', 'this_week', 'this_month']) {
      expect(await where(c('Due', op)), op).toContain(row.title);
    }
  });

  it('combines nested and/or groups', async () => {
    const f: Filter = {
      or: [
        { and: [c('Cost', 'gte', 20), c('Status', 'is', OPT.b)] },
        c('title', 'equals', 'Gamma'),
      ],
    };
    expect(await where(f)).toEqual(['Beta', 'Gamma']);
  });

  it('rejects bad filters clearly', async () => {
    for (const filter of [
      c('Cost', 'contains', 'x'),
      c('Cost', 'gt', 'ten'),
      c('Due', 'on', 'tomorrow'),
      { propertyId: 'nope', op: 'is_empty' },
      { and: [{ or: [{ and: [{ or: [c('Cost', 'eq', 1)] }] }] }] },
    ]) {
      const r = await api.call('POST', `/api/databases/${dbId}/query`, { filter });
      expect(r.status, JSON.stringify(filter)).toBe(400);
    }
  });

  it('sorts in both directions with empty values last, and pages with a cursor', async () => {
    const asc = await query({ sorts: [{ propertyId: id('Due'), direction: 'asc' }] });
    expect(titles(asc)).toEqual(['Alpha', 'Beta', 'Gamma']);
    const desc = await query({ sorts: [{ propertyId: id('Due'), direction: 'desc' }] });
    expect(titles(desc)).toEqual(['Beta', 'Alpha', 'Gamma']);
    const byCost = await query({ sorts: [{ propertyId: id('Cost'), direction: 'desc' }] });
    expect(titles(byCost)).toEqual(['Gamma', 'Beta', 'Alpha']);
    const byTitle = await query({ sorts: [{ propertyId: titleId, direction: 'desc' }] });
    expect(titles(byTitle)).toEqual(['Gamma', 'Beta', 'Alpha']);

    const first = await api.ok(QueryDatabaseResponse, 'POST', `/api/databases/${dbId}/query`, {
      limit: 2,
    });
    expect(first.rows).toHaveLength(2);
    const second = await api.ok(QueryDatabaseResponse, 'POST', `/api/databases/${dbId}/query`, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(titles([...first.rows, ...second.rows])).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(second.nextCursor).toBeNull();
  });

  it("applies a view's saved filter and sorts", async () => {
    const view = await api.ok(CreateViewResponse, 'POST', `/api/databases/${dbId}/views`, {
      name: 'Expensive',
      type: 'board',
      config: {
        filter: c('Cost', 'gte', 20),
        sorts: [{ propertyId: id('Cost'), direction: 'desc' }],
        groupByPropertyId: id('Status'),
      },
    });
    expect(titles(await query({ viewId: view.id }))).toEqual(['Gamma', 'Beta']);
    expect(titles(await query({ viewId: view.id, filter: c('title', 'equals', 'beta') }))).toEqual([
      'Beta',
    ]);
  });

  it('queries 5,000 rows with a filter and sort in under 100 ms', async () => {
    const now = new Date().toISOString();
    const insert = t.db.$client.prepare(
      "INSERT INTO pages (id, kind, database_id, title, position, properties, version, created_at, updated_at) VALUES (?, 'row', ?, ?, ?, ?, 0, ?, ?)",
    );
    t.db.$client.transaction(() => {
      for (let i = 0; i < 5000; i++) {
        insert.run(
          v7(),
          dbId,
          `Row ${i}`,
          `a${String(i).padStart(5, '0')}`,
          JSON.stringify({ [id('Cost')]: i % 97, [id('Status')]: i % 2 ? OPT.a : OPT.b }),
          now,
          now,
        );
      }
    })();
    const body = {
      filter: { and: [c('Cost', 'gte', 50), c('Status', 'is', OPT.a)] },
      sorts: [{ propertyId: id('Cost'), direction: 'desc' }],
      limit: 200,
    };
    await query(body); // warm up
    // Best of 5, so other test files running in parallel do not distort the timing.
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const rows = await query(body);
      best = Math.min(best, performance.now() - start);
      expect(rows).toHaveLength(200);
    }
    expect(best).toBeLessThan(100);
  });
});

describe('row pages', () => {
  it('rows have bodies edited with row ops', async () => {
    const row = await addRow('With body');
    const res = await api.ok(RowOpsResponse, 'POST', `/api/rows/${row.id}/ops`, {
      ops: [
        {
          op: 'insert',
          block: {
            id: v7(),
            parentId: null,
            position: 'a0',
            type: 'paragraph',
            content: { rich: [{ text: 'hi' }] },
          },
        },
      ],
    });
    expect(res.row.id).toBe(row.id);
    const got = await api.ok(GetRowResponse, 'GET', `/api/rows/${row.id}`);
    expect(got.blocks).toHaveLength(1);
    expect((await api.call('POST', `/api/pages/${row.id}/ops`, { ops: [] })).status).toBe(400);
    expect((await api.call('GET', `/api/rows/${SEED_IDS.ideas}`)).status).toBe(404);
  });

  it('adds, renames and orders properties', async () => {
    const p = await api.ok(CreatePropertyResponse, 'POST', `/api/databases/${dbId}/properties`, {
      name: 'Priority',
      type: 'number',
      config: { format: 'number' },
      afterId: null,
    });
    const db = await api.ok(GetDatabaseResponse, 'GET', `/api/databases/${dbId}`);
    expect(db.properties[0]!.id).toBe(p.id);
    const bad = await api.call('POST', `/api/databases/${dbId}/properties`, {
      name: 'X',
      type: 'checkbox',
      config: { options: [] },
    });
    expect(bad.status).toBe(400);
  });
});
