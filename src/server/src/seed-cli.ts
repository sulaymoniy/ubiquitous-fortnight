// `npm run seed`: apply migrations and insert the sample workspace (idempotent).
import { loadEnv, readConfig } from './config.ts';
import { openDatabase, runMigrations } from './db/client.ts';
import { seedDatabase } from './db/seed.ts';

loadEnv();
const config = readConfig();
const db = openDatabase(config.dbFile);
runMigrations(db);
const result = seedDatabase(db, { timeZone: config.seedTimeZone, uploadsDir: config.uploadsDir });
db.$client.close();
console.log(
  result.createdWorkspace
    ? `Seeded a new workspace in ${config.dbFile}`
    : `Seed data already present in ${config.dbFile}; nothing changed`,
);
