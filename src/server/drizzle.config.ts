import { defineConfig } from 'drizzle-kit';

// `npm run db:generate -w @fortnight/server` writes SQL migrations to ./drizzle from the schema.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
