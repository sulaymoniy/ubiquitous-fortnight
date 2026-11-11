import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildApp,
  openDatabase,
  readConfig,
  runMigrations,
  seedDatabase,
  type App,
  type AppDatabase,
  type ServerConfig,
} from '@fortnight/server';

export interface TestContext {
  app: App;
  db: AppDatabase;
  config: ServerConfig;
  dataDir: string;
  close: () => Promise<void>;
}

/** App on a fresh in-memory database, with its own temporary data directory. */
export async function createTestApp(
  options: { apiKey?: string; seed?: boolean; fakeAgent?: boolean } = {},
): Promise<TestContext> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'fortnight-test-'));
  const config = readConfig({
    DATA_DIR: dataDir,
    DB_FILE: ':memory:',
    ANTHROPIC_API_KEY: options.apiKey ?? '',
    AGENT_FAKE: options.fakeAgent ? '1' : '',
    AGENT_PROFILES_FILE: path.join(dataDir, 'no-agent-profiles.json'),
    WEB_DIST: path.join(dataDir, 'no-web-build'),
  });
  const db = openDatabase(':memory:');
  runMigrations(db);
  if (options.seed) seedDatabase(db, { timeZone: 'UTC', uploadsDir: config.uploadsDir });
  const app = await buildApp({ db, config });
  await app.ready();
  return {
    app,
    db,
    config,
    dataDir,
    close: async () => {
      await app.close();
      db.$client.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Logs in and returns the `cookie` header value for later requests. */
export async function login(app: App, name = 'Ada Lovelace'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/session', payload: { name } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'fsid');
  if (!cookie) throw new Error('no fsid cookie');
  return `fsid=${cookie.value}`;
}
