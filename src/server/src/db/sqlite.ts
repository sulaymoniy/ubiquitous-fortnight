import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import type { DatabaseSync, StatementSync, SQLInputValue } from 'node:sqlite';

/**
 * SQLite through Node's built-in `node:sqlite` (Node >= 22.16), wrapped in the small subset of the
 * better-sqlite3 API that Drizzle's `better-sqlite3` driver uses (`prepare`, `run`/`all`/`get`,
 * `raw()`, `transaction()`), plus `pragma`, `exec` and `close`.
 *
 * Why: better-sqlite3 needs a native addon, and `npm ci` on Windows runs `node-gyp rebuild` for it
 * even though it ships prebuilt binaries, which fails without Visual Studio build tools (C-001
 * review, revision 2). `node:sqlite` is part of Node, so installing needs no native build at all.
 * It includes FTS5 and runs on one synchronous connection, like better-sqlite3.
 */

// Node prints "SQLite is an experimental feature" once when the module loads; the API we use is
// stable in practice and covered by our tests, so that one warning is filtered out.
const loadSqlite = (): typeof NodeSqlite => {
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (text.startsWith('SQLite is an experimental feature')) return;
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)('node:sqlite') as typeof NodeSqlite;
  } finally {
    process.emitWarning = original;
  }
};
const sqlite = loadSqlite();

type Params = unknown[];
type Row = Record<string, unknown>;

const bind = (params: Params) => params as SQLInputValue[];
/** node:sqlite returns null-prototype objects; give callers plain objects. */
const plain = (row: unknown): Row | undefined =>
  row === undefined ? undefined : { ...(row as Row) };

export class SqliteStatement {
  private readonly stmt: StatementSync;

  constructor(stmt: StatementSync) {
    this.stmt = stmt;
  }

  run(...params: Params): { changes: number; lastInsertRowid: number } {
    const r = this.stmt.run(...bind(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  all(...params: Params): Row[] {
    return this.stmt.all(...bind(params)).map((r) => plain(r)!);
  }

  get(...params: Params): Row | undefined {
    return plain(this.stmt.get(...bind(params)));
  }

  /** Array-mode rows, as better-sqlite3's `stmt.raw()`. */
  raw(): { all: (...p: Params) => unknown[][]; get: (...p: Params) => unknown[] | undefined } {
    const withArrays = <T>(fn: () => T): T => {
      this.stmt.setReturnArrays(true);
      try {
        return fn();
      } finally {
        this.stmt.setReturnArrays(false);
      }
    };
    return {
      all: (...p) => withArrays(() => this.stmt.all(...bind(p)) as unknown as unknown[][]),
      get: (...p) =>
        withArrays(() => this.stmt.get(...bind(p)) as unknown as unknown[] | undefined),
    };
  }
}

type TxFn<A extends unknown[], R> = ((...args: A) => R) & {
  deferred: (...args: A) => R;
  immediate: (...args: A) => R;
  exclusive: (...args: A) => R;
};

export class SqliteClient {
  private readonly db: DatabaseSync;
  private depth = 0;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (typeof sqlite.StatementSync.prototype.setReturnArrays !== 'function') {
      throw new Error('Node 22.16 or newer is required (node:sqlite setReturnArrays)');
    }
    this.db = new sqlite.DatabaseSync(path);
  }

  get open(): boolean {
    return this.db.isOpen;
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** `pragma('foreign_keys = ON')`; with `{ simple: true }` returns the first value. */
  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.prepare(`PRAGMA ${source}`).all();
    if (!options.simple) return rows;
    const first = rows[0];
    return first === undefined ? undefined : Object.values(first)[0];
  }

  /**
   * better-sqlite3-style transaction: returns a function that runs `fn` in BEGIN/COMMIT, rolling
   * back on throw. Nested calls use savepoints. `fn` must be synchronous.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): TxFn<A, R> {
    const run =
      (begin: string) =>
      (...args: A): R => {
        const nested = this.depth > 0;
        const sp = `fn_sp_${this.depth}`;
        this.db.exec(nested ? `SAVEPOINT ${sp}` : begin);
        this.depth++;
        try {
          const result = fn(...args);
          if (result instanceof Promise) {
            throw new Error('transaction function must be synchronous');
          }
          this.depth--;
          this.db.exec(nested ? `RELEASE ${sp}` : 'COMMIT');
          return result;
        } catch (err) {
          if (this.depth > 0 && this.db.isTransaction) {
            this.depth--;
            this.db.exec(nested ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
          }
          throw err;
        }
      };
    const tx = run('BEGIN') as TxFn<A, R>;
    tx.deferred = run('BEGIN DEFERRED');
    tx.immediate = run('BEGIN IMMEDIATE');
    tx.exclusive = run('BEGIN EXCLUSIVE');
    return tx;
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
