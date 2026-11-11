import type { App, AppDatabase } from '@fortnight/server';
import { expect } from 'vitest';
import type { z } from 'zod';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Small JSON client over `app.inject` with a session cookie. */
export function client(app: App, cookie: string) {
  async function call(method: Method, url: string, payload?: unknown) {
    const res = await app.inject({
      method,
      url,
      headers: { cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: res.statusCode, body: res.body ? (res.json() as unknown) : undefined, res };
  }
  /** Calls and asserts a 200 that parses with `schema`. */
  async function ok<S extends z.ZodType>(
    schema: S,
    method: Method,
    url: string,
    payload?: unknown,
  ): Promise<z.infer<S>> {
    const r = await call(method, url, payload);
    if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status}: ${r.res.body}`);
    const parsed = schema.safeParse(r.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    return parsed.data as z.infer<S>;
  }
  return { call, ok };
}

/** Every row of the content tables, for exact before/after comparisons. */
export function contentSnapshot(db: AppDatabase, options: { ignorePageVersion?: boolean } = {}) {
  const q = (sql: string) => db.$client.prepare(sql).all();
  const pages = q('SELECT * FROM pages ORDER BY id').map((p) =>
    options.ignorePageVersion ? { ...p, version: undefined } : p,
  );
  return {
    workspace: q('SELECT * FROM workspace ORDER BY id'),
    pages,
    blocks: q('SELECT * FROM blocks ORDER BY id'),
    search: q('SELECT * FROM search_index ORDER BY page_id, block_id'),
  };
}
