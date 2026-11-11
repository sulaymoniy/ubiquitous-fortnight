import { LoginRequest, LogoutResponse, SESSION_COOKIE, SessionResponse } from '@fortnight/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../app.ts';
import { AppError } from '../http/errors.ts';

const COOKIE_OPTIONS = { path: '/', httpOnly: true, sameSite: 'lax', secure: false } as const;

/** Mock login (decision D2): any non-empty name and any password; sessions live in memory. */
export function sessionRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/session',
      { schema: { body: LoginRequest, response: { 200: SessionResponse } } },
      async (request, reply) => {
        ctx.sessions.delete(request.cookies[SESSION_COOKIE]);
        const { sid, user } = ctx.sessions.create(request.body.name);
        reply.setCookie(SESSION_COOKIE, sid, COOKIE_OPTIONS);
        return { user };
      },
    );

    app.get('/session', { schema: { response: { 200: SessionResponse } } }, async (request) => {
      if (!request.user) throw new AppError(401, 'unauthorized', 'Not logged in');
      return { user: request.user };
    });

    app.delete(
      '/session',
      { schema: { response: { 200: LogoutResponse } } },
      async (request, reply) => {
        ctx.sessions.delete(request.cookies[SESSION_COOKIE]);
        reply.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
        return {};
      },
    );
  };
}
