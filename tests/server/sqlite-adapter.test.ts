import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openDatabase, runMigrations, schema, type AppDatabase } from '@fortnight/server';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const T = '2026-01-01T00:00:00.000Z';
let db: AppDatabase;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});
afterEach(() => {
  db.$client.close();
});

const page = (id: string) => ({
  id,
  kind: 'page' as const,
  title: id,
  position: 'a0',
  createdAt: T,
  updatedAt: T,
});
const count = () => db.select().from(schema.pages).all().length;

describe('node:sqlite adapter (SqliteClient)', () => {
  it('commits a Drizzle transaction', () => {
    db.transaction((tx) => {
      tx.insert(schema.pages).values(page('a')).run();
      tx.insert(schema.pages).values(page('b')).run();
    });
    expect(count()).toBe(2);
  });

  it('rolls back a Drizzle transaction that throws', () => {
    expect(() =>
      db.transaction((tx) => {
        tx.insert(schema.pages).values(page('a')).run();
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(count()).toBe(0);
    expect(db.$client.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
  });

  it('rolls back only the inner part of a nested transaction (savepoint)', () => {
    db.transaction((tx) => {
      tx.insert(schema.pages).values(page('outer')).run();
      expect(() =>
        tx.transaction((inner) => {
          inner.insert(schema.pages).values(page('inner')).run();
          throw new Error('inner');
        }),
      ).toThrow('inner');
    });
    expect(
      db
        .select()
        .from(schema.pages)
        .all()
        .map((p) => p.id),
    ).toEqual(['outer']);
  });

  it('nests client-level transactions with savepoints', () => {
    const c = db.$client;
    c.exec('CREATE TABLE t (v INTEGER)');
    const insert = (v: number) => c.prepare('INSERT INTO t VALUES (?)').run(v);
    const outer = c.transaction(() => {
      insert(1);
      expect(() =>
        c.transaction(() => {
          insert(2);
          throw new Error('x');
        })(),
      ).toThrow('x');
      insert(3);
    });
    outer();
    expect(c.prepare('SELECT v FROM t ORDER BY v').all()).toEqual([{ v: 1 }, { v: 3 }]);
  });

  it('rejects async transaction functions and leaves no open transaction', () => {
    expect(() => db.$client.transaction(async () => 1)()).toThrow('synchronous');
    expect(() => db.$client.exec('BEGIN; COMMIT;')).not.toThrow();
  });

  it('returns arrays from raw(), plain objects otherwise, and run() counts', () => {
    const c = db.$client;
    expect(c.prepare('SELECT 1 AS a, 2 AS b').raw().all()).toEqual([[1, 2]]);
    expect(c.prepare('SELECT 1 AS a, 2 AS b').raw().get()).toEqual([1, 2]);
    const row = c.prepare('SELECT 1 AS a').get();
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    db.insert(schema.pages).values(page('a')).run();
    const r = c.prepare('UPDATE pages SET title = ? WHERE id = ?').run('x', 'a');
    expect(r).toEqual({ changes: 1, lastInsertRowid: expect.any(Number) });
  });

  it('maps JSON columns and selected fields through Drizzle', () => {
    db.insert(schema.pages)
      .values({ ...page('r'), kind: 'row', properties: { p: ['x'], d: null } })
      .run();
    const [r] = db
      .select({ id: schema.pages.id, properties: schema.pages.properties })
      .from(schema.pages)
      .where(eq(schema.pages.id, 'r'))
      .all();
    expect(r).toEqual({ id: 'r', properties: { p: ['x'], d: null } });
  });

  it('enforces foreign keys', () => {
    expect(() =>
      db
        .insert(schema.blocks)
        .values({
          id: 'b',
          pageId: 'missing',
          type: 'paragraph',
          position: 'a0',
          content: { rich: [] },
          createdAt: T,
          updatedAt: T,
        })
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('prints no SQLite ExperimentalWarning when the server loads', () => {
    const require = createRequire(import.meta.url);
    const tsx = require.resolve('tsx/cli');
    const out = execFileSync(
      process.execPath,
      [tsx, '-e', "import('@fortnight/server').then(m => m.openDatabase(':memory:'))"],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out).not.toContain('ExperimentalWarning');
  });

  it('does not depend on the native better-sqlite3 package', () => {
    const require = createRequire(import.meta.url);
    const pkg = JSON.parse(
      readFileSync(require.resolve('@fortnight/server/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).not.toContain('better-sqlite3');
    expect(() => require.resolve('better-sqlite3')).toThrow();
  });
});
