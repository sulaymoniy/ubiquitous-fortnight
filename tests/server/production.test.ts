import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp, openDatabase, readConfig, runMigrations } from '@fortnight/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fortnight-web-'));
  mkdirSync(path.join(dir, 'dist', 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'dist', 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(path.join(dir, 'dist', 'assets', 'app.js'), 'console.log(1)');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('production serving', () => {
  it('serves the built web app, falls back to index.html for app routes, keeps API 404s', async () => {
    const config = readConfig({
      DATA_DIR: dir,
      DB_FILE: ':memory:',
      WEB_DIST: path.join(dir, 'dist'),
    });
    const db = openDatabase(':memory:');
    runMigrations(db);
    const app = await buildApp({ db, config });
    const get = (url: string) => app.inject({ method: 'GET', url });
    const root = await get('/');
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('id="root"');
    const route = await get('/pages/abc?x=1');
    expect(route.statusCode).toBe(200);
    expect(route.headers['content-type']).toContain('text/html');
    expect((await get('/assets/app.js')).headers['content-type']).toContain('javascript');
    expect((await get('/missing.js')).statusCode).toBe(404);
    expect((await get('/api/health')).statusCode).toBe(200);
    expect((await get('/api/nope')).statusCode).toBe(401);
    await app.close();
    db.$client.close();
  });
});
