import {
  IdParams,
  ListChangesetsQuery,
  ListChangesetsResponse,
  SearchQuery,
  SearchResponse,
  UndoChangesetResponse,
} from '@fortnight/shared';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../app.ts';
import { changesets } from '../db/schema.ts';
import { AppError } from '../http/errors.ts';
import { searchWorkspace } from '../services/search.ts';
import { undoChangesets } from '../services/undo.ts';
import { toChangeset } from '../store/mappers.ts';

export function searchAndChangesetRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  const { db } = ctx;
  return async (app) => {
    app.get(
      '/search',
      { schema: { querystring: SearchQuery, response: { 200: SearchResponse } } },
      async (request) => ({
        results: searchWorkspace(db, request.query.q, request.query.limit),
      }),
    );

    app.get(
      '/changesets',
      { schema: { querystring: ListChangesetsQuery, response: { 200: ListChangesetsResponse } } },
      async (request) => {
        const { limit, source, agentRunId } = request.query;
        const filters: SQL[] = [];
        if (source) filters.push(eq(changesets.source, source));
        if (agentRunId) filters.push(eq(changesets.agentRunId, agentRunId));
        const rows = db
          .select()
          .from(changesets)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(desc(changesets.createdAt), desc(changesets.id))
          .limit(limit)
          .all();
        return { changesets: rows.map(toChangeset) };
      },
    );

    app.post(
      '/changesets/:id/undo',
      { schema: { params: IdParams, response: { 200: UndoChangesetResponse } } },
      async (request) => {
        const undoChangesetId = undoChangesets(db, [request.params.id]);
        if (!undoChangesetId) throw new AppError(500, 'internal_error', 'Undo changed nothing');
        return { undoChangesetId };
      },
    );
  };
}
