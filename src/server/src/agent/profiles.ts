import { existsSync, readFileSync } from 'node:fs';
import { AgentProfile } from '@fortnight/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDatabase } from '../db/client.ts';
import { appSettings } from '../db/schema.ts';

/**
 * Built-in agent profiles (decision D5). Model ids checked against Anthropic's current model list
 * (Claude Opus 5.5, Sonnet 5.5, Haiku 5.5). Effort is always explicit: Opus 5.5 and Haiku 5.5
 * default to `medium`, so the defaults here are chosen per profile.
 */
export const BUILT_IN_PROFILES: AgentProfile[] = [
  {
    id: 'opus-full',
    name: 'Opus 5.5, full access',
    description: 'Most capable. Reads and edits pages, databases and the calendar.',
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    effort: 'high',
    instructions: null,
    tools: 'all',
  },
  {
    id: 'sonnet-full',
    name: 'Sonnet 5.5, full access',
    description: 'Fast and capable for everyday edits.',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    instructions: null,
    tools: 'all',
  },
  {
    id: 'haiku-read',
    name: 'Haiku 5.5, read only',
    description: 'Cheapest. Answers questions about the workspace; cannot change anything.',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    effort: 'low',
    instructions: null,
    tools: 'read_only',
  },
];

const DEFAULT_KEY = 'defaultAgentProfileId';

/** Built-ins plus `agent-profiles.json` (same id overrides a built-in). Bad files are ignored. */
export function loadProfiles(file: string): AgentProfile[] {
  const byId = new Map(BUILT_IN_PROFILES.map((p) => [p.id, p]));
  if (existsSync(file)) {
    try {
      const extra = z.array(AgentProfile).parse(JSON.parse(readFileSync(file, 'utf8')));
      for (const p of extra) byId.set(p.id, p);
    } catch (err) {
      console.warn(`Ignoring ${file}: ${(err as Error).message}`);
    }
  }
  return [...byId.values()];
}

export function getDefaultProfileId(db: AppDatabase, profiles: AgentProfile[]): string {
  const [row] = db.select().from(appSettings).where(eq(appSettings.key, DEFAULT_KEY)).all();
  const id = typeof row?.value === 'string' ? row.value : null;
  return id && profiles.some((p) => p.id === id) ? id : profiles[0]!.id;
}

export function setDefaultProfileId(db: AppDatabase, id: string): void {
  db.insert(appSettings)
    .values({ key: DEFAULT_KEY, value: id })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: id } })
    .run();
}
