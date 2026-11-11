/**
 * @fortnight/shared: the API contract between `@fortnight/server` and `@fortnight/web`.
 * Zod schemas are the source of truth; TypeScript types are inferred from them.
 * Owner: claude. Changes need acceptance in both task records and bump CONTRACT_VERSION.
 */
export const CONTRACT_VERSION = '1.0.0';

export * from './common.ts';
export * from './recurrence.ts';
export * from './positions.ts';
export * from './filters.ts';
export * from './model.ts';
export * from './ops.ts';
export * from './api.ts';
export * from './agent.ts';
