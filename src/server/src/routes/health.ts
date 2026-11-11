import { CONTRACT_VERSION, HealthResponse } from '@fortnight/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../app.ts';

export function healthRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.get('/health', { schema: { response: { 200: HealthResponse } } }, async () => ({
      ok: true as const,
      contractVersion: CONTRACT_VERSION,
      // Only whether a key is set; the key itself never leaves process.env.
      agentKeyConfigured: ctx.config.agentKeyConfigured,
    }));
  };
}
