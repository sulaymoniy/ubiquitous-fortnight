import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (three levels up from src/server/src). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface ServerConfig {
  host: string;
  port: number;
  /** Runtime data: SQLite file and uploads. Gitignored. */
  dataDir: string;
  dbFile: string;
  uploadsDir: string;
  logLevel: string;
  /** Whether ANTHROPIC_API_KEY is non-empty. The key itself is never stored in the config. */
  agentKeyConfigured: boolean;
  /** Time zone for a newly seeded workspace. */
  seedTimeZone: string;
  /** `AGENT_FAKE=1`: scripted model turns, no API calls (tests, e2e, development). */
  agentFake: boolean;
  /** Built web app to serve (production); served only when the folder exists. */
  webDist: string;
  /** Optional extra agent profiles. */
  agentProfilesFile: string;
}

/**
 * Loads the root `.env` into `process.env` if it exists. Variables already set in the environment
 * win. Never logs anything from the file.
 */
export function loadEnv(file = path.join(REPO_ROOT, '.env')): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = path.resolve(REPO_ROOT, env.DATA_DIR ?? 'data');
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('PORT is invalid');
  return {
    host: env.HOST ?? '127.0.0.1',
    port,
    dataDir,
    dbFile: env.DB_FILE ?? path.join(dataDir, 'fortnight.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    logLevel: env.LOG_LEVEL ?? 'info',
    agentKeyConfigured: (env.ANTHROPIC_API_KEY ?? '').trim().length > 0,
    seedTimeZone: env.FORTNIGHT_TIME_ZONE ?? 'UTC',
    agentFake: env.AGENT_FAKE === '1' || env.AGENT_FAKE === 'true',
    webDist: path.resolve(REPO_ROOT, env.WEB_DIST ?? 'src/web/dist'),
    agentProfilesFile: path.resolve(REPO_ROOT, env.AGENT_PROFILES_FILE ?? 'agent-profiles.json'),
  };
}
