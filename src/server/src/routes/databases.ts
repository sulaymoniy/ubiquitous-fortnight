import {
  ArchiveRowResponse,
  CalendarEventsQuery,
  CalendarEventsResponse,
  CreateDatabaseRequest,
  CreateDatabaseResponse,
  CreatePropertyRequest,
  CreatePropertyResponse,
  CreateRowRequest,
  CreateRowResponse,
  CreateViewRequest,
  CreateViewResponse,
  DeletePropertyResponse,
  DeleteViewResponse,
  GetDatabaseResponse,
  GetRowResponse,
  IdParams,
  ListDatabasesResponse,
  OpsRequest,
  QueryDatabaseRequest,
  QueryDatabaseResponse,
  RowOpsResponse,
  UpdateDatabaseRequest,
  UpdateDatabaseResponse,
  UpdatePropertyRequest,
  UpdatePropertyResponse,
  UpdateRowRequest,
  UpdateRowResponse,
  UpdateViewRequest,
  UpdateViewResponse,
} from '@fortnight/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../app.ts';
import { databases } from '../db/schema.ts';
import { calendarEvents } from '../services/calendar.ts';
import {
  createDatabase,
  createProperty,
  createRow,
  createView,
  databaseProperties,
  databaseViews,
  deleteProperty,
  deleteView,
  getDatabaseRow,
  getRowRow,
  renameDatabase,
  rowById,
  setRowArchived,
  toDatabase,
  updateProperty,
  updateRow,
  updateView,
} from '../services/databases.ts';
import { applyBlockOps } from '../services/ops.ts';
import { pageBlocks } from '../services/pages.ts';
import { queryDatabase } from '../services/query.ts';
import { toBlock } from '../store/mappers.ts';

export function databaseRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  const { db } = ctx;
  return async (app) => {
    app.get('/databases', { schema: { response: { 200: ListDatabasesResponse } } }, async () => ({
      databases: db.select().from(databases).all().map(toDatabase),
    }));

    app.post(
      '/databases',
      { schema: { body: CreateDatabaseRequest, response: { 200: CreateDatabaseResponse } } },
      async (request) => createDatabase(db, request.body),
    );

    app.get(
      '/databases/:id',
      { schema: { params: IdParams, response: { 200: GetDatabaseResponse } } },
      async (request) => {
        const d = getDatabaseRow(db, request.params.id);
        return {
          database: toDatabase(d),
          properties: databaseProperties(db, d.id),
          views: databaseViews(db, d.id),
        };
      },
    );

    app.patch(
      '/databases/:id',
      {
        schema: {
          params: IdParams,
          body: UpdateDatabaseRequest,
          response: { 200: UpdateDatabaseResponse },
        },
      },
      async (request) => renameDatabase(db, request.params.id, request.body.title),
    );

    app.post(
      '/databases/:id/properties',
      {
        schema: {
          params: IdParams,
          body: CreatePropertyRequest,
          response: { 200: CreatePropertyResponse },
        },
      },
      async (request) => createProperty(db, request.params.id, request.body),
    );

    app.patch(
      '/properties/:id',
      {
        schema: {
          params: IdParams,
          body: UpdatePropertyRequest,
          response: { 200: UpdatePropertyResponse },
        },
      },
      async (request) => updateProperty(db, request.params.id, request.body),
    );

    app.delete(
      '/properties/:id',
      { schema: { params: IdParams, response: { 200: DeletePropertyResponse } } },
      async (request) => ({ changesetId: deleteProperty(db, request.params.id) }),
    );

    app.post(
      '/databases/:id/query',
      {
        schema: {
          params: IdParams,
          body: QueryDatabaseRequest,
          response: { 200: QueryDatabaseResponse },
        },
      },
      async (request) => queryDatabase(db, request.params.id, request.body),
    );

    app.post(
      '/databases/:id/rows',
      {
        schema: { params: IdParams, body: CreateRowRequest, response: { 200: CreateRowResponse } },
      },
      async (request) => createRow(db, request.params.id, request.body),
    );

    app.get(
      '/rows/:id',
      { schema: { params: IdParams, response: { 200: GetRowResponse } } },
      async (request) => {
        const row = rowById(db, request.params.id);
        return { row, blocks: pageBlocks(db, row.id).map(toBlock) };
      },
    );

    app.patch(
      '/rows/:id',
      {
        schema: { params: IdParams, body: UpdateRowRequest, response: { 200: UpdateRowResponse } },
      },
      async (request) => updateRow(db, request.params.id, request.body),
    );

    app.post(
      '/rows/:id/archive',
      { schema: { params: IdParams, response: { 200: ArchiveRowResponse } } },
      async (request) => setRowArchived(db, request.params.id, true),
    );

    app.post(
      '/rows/:id/restore',
      { schema: { params: IdParams, response: { 200: ArchiveRowResponse } } },
      async (request) => setRowArchived(db, request.params.id, false),
    );

    app.post(
      '/rows/:id/ops',
      { schema: { params: IdParams, body: OpsRequest, response: { 200: RowOpsResponse } } },
      async (request) => {
        const row = getRowRow(db, request.params.id);
        const result = applyBlockOps(db, row.id, request.body.ops, {
          label: request.body.label ?? 'Edit row page',
        });
        return { ...result, row: rowById(db, row.id) };
      },
    );

    app.post(
      '/databases/:id/views',
      {
        schema: {
          params: IdParams,
          body: CreateViewRequest,
          response: { 200: CreateViewResponse },
        },
      },
      async (request) => createView(db, request.params.id, request.body),
    );

    app.patch(
      '/views/:id',
      {
        schema: {
          params: IdParams,
          body: UpdateViewRequest,
          response: { 200: UpdateViewResponse },
        },
      },
      async (request) => updateView(db, request.params.id, request.body),
    );

    app.delete(
      '/views/:id',
      { schema: { params: IdParams, response: { 200: DeleteViewResponse } } },
      async (request) => deleteView(db, request.params.id),
    );

    app.get(
      '/calendar/events',
      { schema: { querystring: CalendarEventsQuery, response: { 200: CalendarEventsResponse } } },
      async (request) => {
        const ids = request.query.databaseIds
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        return { events: calendarEvents(db, request.query.from, request.query.to, ids) };
      },
    );
  };
}
