import {
  ArchivePageResponse,
  CreatePageRequest,
  CreatePageResponse,
  GetPageResponse,
  GetWorkspaceResponse,
  IdParams,
  ListPagesQuery,
  ListPagesResponse,
  OpsRequest,
  PageOpsResponse,
  UpdatePageRequest,
  UpdatePageResponse,
  UpdateWorkspaceRequest,
  UpdateWorkspaceResponse,
} from '@fortnight/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../app.ts';
import { workspace } from '../db/schema.ts';
import { AppError } from '../http/errors.ts';
import { nowIso } from '../ids.ts';
import { applyBlockOps } from '../services/ops.ts';
import {
  archivePage,
  createPage,
  getPageRow,
  listPages,
  pageBlocks,
  restorePage,
  updatePage,
} from '../services/pages.ts';
import { ChangeRecorder, inTransaction } from '../store/changes.ts';
import { toBlock, toPage, toWorkspace } from '../store/mappers.ts';

export function pageRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  const { db } = ctx;
  return async (app) => {
    const getWorkspaceRow = () => {
      const [row] = db.select().from(workspace).limit(1).all();
      if (!row) throw new AppError(404, 'not_found', 'No workspace yet; run npm run seed');
      return row;
    };

    app.get('/workspace', { schema: { response: { 200: GetWorkspaceResponse } } }, async () =>
      toWorkspace(getWorkspaceRow()),
    );

    app.patch(
      '/workspace',
      { schema: { body: UpdateWorkspaceRequest, response: { 200: UpdateWorkspaceResponse } } },
      async (request) =>
        inTransaction(db, () => {
          const row = getWorkspaceRow();
          const rec = new ChangeRecorder(db);
          rec.touch('workspace', row.id);
          db.update(workspace)
            .set({
              name: request.body.name ?? row.name,
              settings: { ...row.settings, ...request.body.settings },
              updatedAt: nowIso(),
            })
            .where(eq(workspace.id, row.id))
            .run();
          rec.commit({ source: 'user', label: 'Edit workspace' });
          return toWorkspace(getWorkspaceRow());
        }),
    );

    app.get(
      '/pages',
      { schema: { querystring: ListPagesQuery, response: { 200: ListPagesResponse } } },
      async (request) => ({ pages: listPages(db, request.query.includeArchived ?? false) }),
    );

    app.post(
      '/pages',
      { schema: { body: CreatePageRequest, response: { 200: CreatePageResponse } } },
      async (request) => createPage(db, request.body),
    );

    app.get(
      '/pages/:id',
      { schema: { params: IdParams, response: { 200: GetPageResponse } } },
      async (request) => {
        const page = getPageRow(db, request.params.id);
        return { page: toPage(page), blocks: pageBlocks(db, page.id).map(toBlock) };
      },
    );

    app.patch(
      '/pages/:id',
      {
        schema: {
          params: IdParams,
          body: UpdatePageRequest,
          response: { 200: UpdatePageResponse },
        },
      },
      async (request) => updatePage(db, request.params.id, request.body),
    );

    app.post(
      '/pages/:id/archive',
      { schema: { params: IdParams, response: { 200: ArchivePageResponse } } },
      async (request) => archivePage(db, request.params.id),
    );

    app.post(
      '/pages/:id/restore',
      { schema: { params: IdParams, response: { 200: ArchivePageResponse } } },
      async (request) => restorePage(db, request.params.id),
    );

    app.post(
      '/pages/:id/ops',
      { schema: { params: IdParams, body: OpsRequest, response: { 200: PageOpsResponse } } },
      async (request) => {
        const page = getPageRow(db, request.params.id);
        const result = applyBlockOps(db, page.id, request.body.ops, {
          label: request.body.label ?? 'Edit page',
        });
        return { ...result, page: toPage(getPageRow(db, page.id)) };
      },
    );
  };
}
