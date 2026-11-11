import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openDatabase,
  runMigrations,
  schema,
  seedDatabase,
  SEED_IDS,
  type AppDatabase,
} from '@fortnight/server';
import {
  BLOCK_TYPES,
  BlockTypeContent,
  DateValue,
  parseRecurrence,
  Property,
  PropertyValue,
  View,
  WorkspaceSettings,
} from '@fortnight/shared';
import { asc } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const EXPECTED_TABLES = [
  'agent_conversations',
  'agent_items',
  'agent_runs',
  'app_settings',
  'blocks',
  'changesets',
  'databases',
  'pages',
  'properties',
  'search_index',
  'uploads',
  'views',
  'workspace',
];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fortnight-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tables(db: AppDatabase): string[] {
  return db.$client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'search_index_%' ORDER BY name",
    )
    .all()
    .map((r) => (r as { name: string }).name);
}

/** Every row of every table, for exact before/after comparison. */
function snapshot(db: AppDatabase): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const name of tables(db)) {
    out[name] = db.$client.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
  }
  return out;
}

describe('migrations', () => {
  it('create the whole data model on an empty file database', () => {
    const file = path.join(dir, 'nested', 'fortnight.db');
    const db = openDatabase(file);
    runMigrations(db);
    expect(tables(db)).toEqual(EXPECTED_TABLES);
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
    db.$client.close();
    expect(existsSync(file)).toBe(true);
  });

  it('are safe to run again', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    runMigrations(db);
    expect(tables(db)).toEqual(EXPECTED_TABLES);
    db.$client.close();
  });

  it('create a working FTS5 search table', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    db.$client
      .prepare(
        'INSERT INTO search_index (page_id, block_id, kind, database_id, title, body) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('p1', null, 'page', null, 'Café notes', 'quarterly planning');
    const hit = db.$client
      .prepare("SELECT page_id FROM search_index WHERE search_index MATCH 'cafe'")
      .all();
    expect(hit).toEqual([{ page_id: 'p1' }]);
    db.$client.close();
  });
});

describe('seed', () => {
  function seeded(): AppDatabase {
    const db = openDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db, { timeZone: 'Asia/Tashkent', uploadsDir: path.join(dir, 'uploads') });
    return db;
  }

  it('is idempotent: a second run changes nothing', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const opts = { timeZone: 'UTC', uploadsDir: path.join(dir, 'uploads') };
    expect(seedDatabase(db, opts).createdWorkspace).toBe(true);
    const first = snapshot(db);
    expect(seedDatabase(db, opts).createdWorkspace).toBe(false);
    expect(snapshot(db)).toEqual(first);
    db.$client.close();
  });

  it('is deterministic across databases', () => {
    const a = seeded();
    const b = seeded();
    expect(snapshot(a)).toEqual(snapshot(b));
    a.$client.close();
    b.$client.close();
  });

  it('does not overwrite edits to seeded entities', () => {
    const db = seeded();
    db.$client.prepare('UPDATE pages SET title = ? WHERE id = ?').run('Renamed', SEED_IDS.ideas);
    seedDatabase(db, { timeZone: 'UTC', uploadsDir: path.join(dir, 'uploads') });
    const row = db.$client.prepare('SELECT title FROM pages WHERE id = ?').get(SEED_IDS.ideas);
    expect(row).toEqual({ title: 'Renamed' });
    db.$client.close();
  });

  it('creates the workspace with the given time zone', () => {
    const db = seeded();
    const [ws] = db.select().from(schema.workspace).all();
    expect(ws?.id).toBe(SEED_IDS.workspace);
    expect(WorkspaceSettings.parse(ws?.settings)).toEqual({
      timeZone: 'Asia/Tashkent',
      weekStartsOn: 1,
    });
    db.$client.close();
  });

  it('creates nested sample pages and a sample page with every block type', () => {
    const db = seeded();
    const pages = db.select().from(schema.pages).all();
    const byId = new Map(pages.map((p) => [p.id, p]));
    expect(byId.get(SEED_IDS.fortnightApp)?.parentId).toBe(SEED_IDS.projects);
    expect(byId.get(SEED_IDS.ideas)?.parentId).toBe(SEED_IDS.fortnightApp);

    const blocks = db.select().from(schema.blocks).orderBy(asc(schema.blocks.position)).all();
    const gs = blocks.filter((b) => b.pageId === SEED_IDS.gettingStarted);
    expect(new Set(gs.map((b) => b.type))).toEqual(new Set(BLOCK_TYPES));
    for (const b of blocks) BlockTypeContent.parse({ type: b.type, content: b.content });
    // Nested blocks: a nested bullet and a toggle child.
    const nested = gs.filter((b) => b.parentId !== null);
    expect(nested.map((b) => gs.find((p) => p.id === b.parentId)?.type).sort()).toEqual([
      'bulleted_list_item',
      'toggle',
    ]);
    db.$client.close();
  });

  it('writes the seeded image upload', () => {
    const db = seeded();
    const file = path.join(dir, 'uploads', SEED_IDS.upload);
    expect(readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
    db.$client.close();
  });

  it('creates the Calendar database with Name, Date, Tags, Notes and valid events', () => {
    const db = seeded();
    const props = db
      .select()
      .from(schema.properties)
      .orderBy(asc(schema.properties.position))
      .all();
    expect(props.map((p) => [p.name, p.type])).toEqual([
      ['Name', 'title'],
      ['Date', 'date'],
      ['Tags', 'multi_select'],
      ['Notes', 'text'],
    ]);
    for (const p of props) Property.parse(p);
    for (const v of db.select().from(schema.views).all()) View.parse(v);

    const rows = db
      .select()
      .from(schema.pages)
      .all()
      .filter((p) => p.kind === 'row');
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const dates = rows.map((r) => DateValue.parse(r.properties?.[SEED_IDS.propDate]));
    for (const r of rows) {
      for (const v of Object.values(r.properties ?? {})) PropertyValue.parse(v);
    }
    expect(dates.some((d) => d.allDay && d.end !== null)).toBe(true); // multi-day all-day
    expect(dates.some((d) => d.allDay && d.end === null)).toBe(true); // single all-day
    expect(dates.some((d) => !d.allDay && d.recurrence === null)).toBe(true); // timed
    const recurring = dates.filter((d) => d.recurrence !== null);
    expect(recurring.length).toBeGreaterThanOrEqual(1);
    for (const d of recurring) expect(parseRecurrence(d.recurrence!).ok).toBe(true);
    db.$client.close();
  });
});
