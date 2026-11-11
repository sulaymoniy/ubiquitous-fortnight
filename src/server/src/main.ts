import { buildApp } from './app.ts';
import { loadEnv, readConfig } from './config.ts';
import { openDatabase, runMigrations } from './db/client.ts';
import { workspace } from './db/schema.ts';
import { seedDatabase } from './db/seed.ts';

loadEnv();
const config = readConfig();
const db = openDatabase(config.dbFile);
runMigrations(db);

// A brand-new database gets the sample workspace so `npm run dev` shows something right away.
if (db.select({ id: workspace.id }).from(workspace).limit(1).all().length === 0) {
  seedDatabase(db, { timeZone: config.seedTimeZone, uploadsDir: config.uploadsDir });
}

const app = await buildApp({ db, config, logger: { level: config.logLevel } });

const shutdown = async () => {
  await app.close();
  db.$client.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
