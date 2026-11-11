import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { MAX_UPLOAD_BYTES, SESSION_COOKIE, type MockUser } from '@fortnight/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { ServerConfig } from './config.ts';
import type { AppDatabase } from './db/client.ts';
import { errorBody, errorHandler, notFoundHandler } from './http/errors.ts';
import { databaseRoutes } from './routes/databases.ts';
import { healthRoutes } from './routes/health.ts';
import { pageRoutes } from './routes/pages.ts';
import { searchAndChangesetRoutes } from './routes/search-changesets.ts';
import { sessionRoutes } from './routes/session.ts';
import { uploadRoutes } from './routes/uploads.ts';
import { SessionStore } from './session.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** The mock user of the request's session; set by the auth guard on protected routes. */
    user: MockUser | null;
  }
}

export interface BuildAppOptions {
  db: AppDatabase;
  config: ServerConfig;
  sessions?: SessionStore;
  logger?: FastifyServerOptions['logger'];
}

export interface AppContext {
  db: AppDatabase;
  config: ServerConfig;
  sessions: SessionStore;
}

/** Routes under `/api` that work without a session. */
function isPublicApiRoute(method: string, path: string): boolean {
  if (path === '/api/health') return method === 'GET' || method === 'HEAD';
  return path === '/api/session';
}

export async function buildApp(options: BuildAppOptions) {
  const ctx: AppContext = {
    db: options.db,
    config: options.config,
    sessions: options.sessions ?? new SessionStore(),
  };

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);
  app.decorateRequest('user', null);
  // The API speaks JSON, plus multipart for POST /api/uploads; anything else is 415.
  app.removeContentTypeParser('text/plain');

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } });

  // 401 guard: every /api route except health and session, and /uploads, need a valid session
  // cookie. Runs before routing, so unknown /api paths also answer 401 without a session.
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const guarded = path === '/api' || path.startsWith('/api/') || path.startsWith('/uploads/');
    if (!guarded) return;
    const user = ctx.sessions.get(request.cookies[SESSION_COOKIE]);
    if (user) request.user = user;
    if (isPublicApiRoute(request.method, path)) return;
    if (!user) {
      return reply.status(401).send(errorBody('unauthorized', 'Log in first'));
    }
  });

  await app.register(healthRoutes(ctx), { prefix: '/api' });
  await app.register(sessionRoutes(ctx), { prefix: '/api' });
  await app.register(pageRoutes(ctx), { prefix: '/api' });
  await app.register(searchAndChangesetRoutes(ctx), { prefix: '/api' });
  await app.register(databaseRoutes(ctx), { prefix: '/api' });
  await app.register(uploadRoutes(ctx));

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
