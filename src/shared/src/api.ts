import { z } from 'zod';
import { EmptyResponse, Id, IsoDateTime, Position, TimeZone } from './common.ts';
import { Filter, Sort } from './filters.ts';
import {
  Block,
  Changeset,
  ChangesetSource,
  Database,
  EntityKind,
  EventOccurrence,
  MockUser,
  Page,
  Property,
  PropertyConfig,
  PropertyDefinition,
  PropertyValue,
  Row,
  View,
  ViewConfig,
  ViewType,
  Workspace,
} from './model.ts';
import { BlockOp, MAX_OPS_PER_BATCH } from './ops.ts';

/**
 * REST request and response schemas, one group per route (plan section 4.3).
 * All routes are under `/api`, JSON in and out. Every `/api` route except `GET /api/health` and
 * `/api/session` returns 401 `unauthorized` without a valid `fsid` session cookie.
 * Errors use `ApiError` (`common.ts`).
 */

/** Name of the HttpOnly session cookie set by `POST /api/session`. */
export const SESSION_COOKIE = 'fsid';

/* ------------------------------------------------------------------ health and session */

/** GET /api/health (no session needed). */
export const HealthResponse = z.object({
  ok: z.literal(true),
  contractVersion: z.string(),
  /** False when ANTHROPIC_API_KEY is empty; the agent panel then shows "Add your key to .env". */
  agentKeyConfigured: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** POST /api/session: mock login. Any non-empty name and any password are accepted. */
export const LoginRequest = z.object({
  name: z.string().trim().min(1).max(80),
  password: z.string().max(200).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** POST /api/session and GET /api/session. */
export const SessionResponse = z.object({ user: MockUser });
export type SessionResponse = z.infer<typeof SessionResponse>;

/** DELETE /api/session: always 200 `{}`, clears the cookie. */
export const LogoutResponse = EmptyResponse;
export type LogoutResponse = z.infer<typeof LogoutResponse>;

/* ------------------------------------------------------------------ workspace */

export const GetWorkspaceResponse = Workspace;
export type GetWorkspaceResponse = z.infer<typeof GetWorkspaceResponse>;

export const UpdateWorkspaceRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  settings: z
    .object({
      timeZone: TimeZone.optional(),
      weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
    })
    .optional(),
});
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequest>;
export const UpdateWorkspaceResponse = Workspace;

/* ------------------------------------------------------------------ pages */

export const IdParams = z.object({ id: Id });
export type IdParams = z.infer<typeof IdParams>;

/** GET /api/pages?includeArchived=true|false (default false). Rows are never included. */
export const ListPagesQuery = z.object({ includeArchived: z.stringbool().optional() });
export type ListPagesQuery = z.infer<typeof ListPagesQuery>;
/** Flat list; the client builds the tree from `parentId` and `position`. */
export const ListPagesResponse = z.object({ pages: z.array(Page) });
export type ListPagesResponse = z.infer<typeof ListPagesResponse>;

/** POST /api/pages. `afterId` = sibling to insert after (null or missing = first). */
export const CreatePageRequest = z.object({
  title: z.string().max(2000).optional(),
  parentId: Id.nullable().optional(),
  afterId: Id.nullable().optional(),
  icon: z.string().max(2048).nullable().optional(),
});
export type CreatePageRequest = z.infer<typeof CreatePageRequest>;
export const CreatePageResponse = Page;

/** GET /api/pages/:id. Blocks are flat, ordered by parent then position. */
export const GetPageResponse = z.object({ page: Page, blocks: z.array(Block) });
export type GetPageResponse = z.infer<typeof GetPageResponse>;

/** PATCH /api/pages/:id. Stale `version` → 409 `version_conflict` with the current page. */
export const UpdatePageRequest = z.object({
  version: z.number().int().nonnegative(),
  title: z.string().max(2000).optional(),
  icon: z.string().max(2048).nullable().optional(),
  cover: z.string().max(2048).nullable().optional(),
  parentId: Id.nullable().optional(),
  position: Position.optional(),
});
export type UpdatePageRequest = z.infer<typeof UpdatePageRequest>;
export const UpdatePageResponse = Page;

/** POST /api/pages/:id/archive and /restore (both cascade to child pages). */
export const ArchivePageResponse = Page;

/** POST /api/pages/:id/ops and POST /api/rows/:id/ops. */
export const OpsRequest = z.object({
  ops: z.array(BlockOp).min(1).max(MAX_OPS_PER_BATCH),
  /** Changeset label; default "Edit page". Inline AI uses `AI: <action>`. */
  label: z.string().max(200).optional(),
});
export type OpsRequest = z.infer<typeof OpsRequest>;

/**
 * Response of POST /api/pages/:id/ops.
 * `blocks` = every block the batch inserted, updated or moved, in its final state.
 * `deletedBlockIds` = every block removed, including descendants of deleted blocks.
 */
export const PageOpsResponse = z.object({
  changesetId: Id,
  page: Page,
  blocks: z.array(Block),
  deletedBlockIds: z.array(Id),
});
export type PageOpsResponse = z.infer<typeof PageOpsResponse>;

/** Response of POST /api/rows/:id/ops: same as PageOpsResponse but with the `Row`, not a Page. */
export const RowOpsResponse = z.object({
  changesetId: Id,
  row: Row,
  blocks: z.array(Block),
  deletedBlockIds: z.array(Id),
});
export type RowOpsResponse = z.infer<typeof RowOpsResponse>;

/* ------------------------------------------------------------------ conflicts */

/** `details` of a 409 `version_conflict`: the entity's current state. */
export const VersionConflictDetails = z.discriminatedUnion('entity', [
  z.object({ entity: z.literal('page'), current: Page }),
  z.object({ entity: z.literal('row'), current: Row }),
]);
export type VersionConflictDetails = z.infer<typeof VersionConflictDetails>;

export const VersionConflictError = z.object({
  error: z.object({
    code: z.literal('version_conflict'),
    message: z.string(),
    details: VersionConflictDetails,
  }),
});
export type VersionConflictError = z.infer<typeof VersionConflictError>;

/** `details` of a 409 `undo_conflict`: entities changed after the changeset. Nothing was undone. */
export const UndoConflictDetails = z.object({
  conflicts: z.array(z.object({ entity: EntityKind, id: Id })),
});
export type UndoConflictDetails = z.infer<typeof UndoConflictDetails>;

export const UndoConflictError = z.object({
  error: z.object({
    code: z.literal('undo_conflict'),
    message: z.string(),
    details: UndoConflictDetails,
  }),
});
export type UndoConflictError = z.infer<typeof UndoConflictError>;

/* ------------------------------------------------------------------ search and uploads */

/** GET /api/search?q=&limit= (limit 1..50, default 20). */
export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchResult = z.object({
  kind: z.enum(['page', 'row']),
  /** Page or row id. */
  id: Id,
  /** Id to open: the page id, or the row id for rows (rows open as pages). */
  pageId: Id,
  /** Database of a row; null for pages. */
  databaseId: Id.nullable(),
  title: z.string(),
  /** Plain-text excerpt around the match. */
  snippet: z.string(),
  /** Block that matched, or null when the title matched. */
  blockId: Id.nullable(),
});
export type SearchResult = z.infer<typeof SearchResult>;
/** Title matches rank first. */
export const SearchResponse = z.object({ results: z.array(SearchResult) });
export type SearchResponse = z.infer<typeof SearchResponse>;

/** POST /api/uploads: multipart form field `file`. Served at GET /uploads/:id. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const UploadResponse = z.object({ id: Id, url: z.string().startsWith('/uploads/') });
export type UploadResponse = z.infer<typeof UploadResponse>;

/* ------------------------------------------------------------------ databases */

/** POST /api/databases. A `title` property named "Name" is always created; do not include one. */
export const CreateDatabaseRequest = z.object({
  title: z.string().max(2000),
  parentId: Id.nullable().optional(),
  properties: z.array(PropertyDefinition).max(100).optional(),
});
export type CreateDatabaseRequest = z.infer<typeof CreateDatabaseRequest>;
/** Also creates a default table view. */
export const CreateDatabaseResponse = z.object({
  database: Database,
  page: Page,
  properties: z.array(Property),
  views: z.array(View),
});
export type CreateDatabaseResponse = z.infer<typeof CreateDatabaseResponse>;

export const ListDatabasesResponse = z.object({ databases: z.array(Database) });
export type ListDatabasesResponse = z.infer<typeof ListDatabasesResponse>;

export const GetDatabaseResponse = z.object({
  database: Database,
  properties: z.array(Property),
  views: z.array(View),
});
export type GetDatabaseResponse = z.infer<typeof GetDatabaseResponse>;

export const UpdateDatabaseRequest = z.object({ title: z.string().max(2000).optional() });
export type UpdateDatabaseRequest = z.infer<typeof UpdateDatabaseRequest>;
export const UpdateDatabaseResponse = Database;

/** POST /api/databases/:id/properties. */
export const CreatePropertyRequest = z.intersection(
  PropertyDefinition,
  z.object({ afterId: Id.nullable().optional() }),
);
export type CreatePropertyRequest = z.infer<typeof CreatePropertyRequest>;
export const CreatePropertyResponse = Property;

/** PATCH /api/properties/:id. `config` must fit the property's type. Type changes are not in v1. */
export const UpdatePropertyRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  config: PropertyConfig.optional(),
  position: Position.optional(),
});
export type UpdatePropertyRequest = z.infer<typeof UpdatePropertyRequest>;
export const UpdatePropertyResponse = Property;

/** DELETE /api/properties/:id (undoable). */
export const DeletePropertyResponse = z.object({ changesetId: Id });
export type DeletePropertyResponse = z.infer<typeof DeletePropertyResponse>;

/** POST /api/databases/:id/query. With `viewId`, the view's filter and sorts apply first. */
export const QueryDatabaseRequest = z.object({
  filter: Filter.optional(),
  sorts: z.array(Sort).max(20).optional(),
  /** Opaque cursor from a previous response. */
  cursor: z.string().max(500).nullable().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  viewId: Id.optional(),
});
export type QueryDatabaseRequest = z.infer<typeof QueryDatabaseRequest>;
export const QueryDatabaseResponse = z.object({
  rows: z.array(Row),
  nextCursor: z.string().nullable(),
});
export type QueryDatabaseResponse = z.infer<typeof QueryDatabaseResponse>;

/* ------------------------------------------------------------------ rows */

/** POST /api/databases/:id/rows. `properties` keyed by property id. */
export const CreateRowRequest = z.object({
  title: z.string().max(2000).optional(),
  properties: z.record(Id, PropertyValue).optional(),
  afterId: Id.nullable().optional(),
});
export type CreateRowRequest = z.infer<typeof CreateRowRequest>;
export const CreateRowResponse = Row;

/** GET /api/rows/:id: the row and its body blocks. */
export const GetRowResponse = z.object({ row: Row, blocks: z.array(Block) });
export type GetRowResponse = z.infer<typeof GetRowResponse>;

/**
 * PATCH /api/rows/:id. `properties` is a partial update keyed by property id (`null` clears).
 * Stale `version` → 409 `version_conflict` with the current row.
 */
export const UpdateRowRequest = z.object({
  version: z.number().int().nonnegative(),
  title: z.string().max(2000).optional(),
  properties: z.record(Id, PropertyValue).optional(),
  position: Position.optional(),
});
export type UpdateRowRequest = z.infer<typeof UpdateRowRequest>;
export const UpdateRowResponse = Row;
export const ArchiveRowResponse = Row;

/* ------------------------------------------------------------------ views */

export const CreateViewRequest = z.object({
  name: z.string().min(1).max(200),
  type: ViewType,
  config: ViewConfig.optional(),
});
export type CreateViewRequest = z.infer<typeof CreateViewRequest>;
export const CreateViewResponse = View;

/** PATCH /api/views/:id. `config` replaces the whole config. */
export const UpdateViewRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  config: ViewConfig.optional(),
  position: Position.optional(),
});
export type UpdateViewRequest = z.infer<typeof UpdateViewRequest>;
export const UpdateViewResponse = View;
export const DeleteViewResponse = EmptyResponse;

/* ------------------------------------------------------------------ calendar */

/** Longest range one calendar query may cover. */
export const MAX_CALENDAR_RANGE_DAYS = 400;

/**
 * GET /api/calendar/events?from=&to=&databaseIds=a,b
 *
 * - Half-open range `[from, to)`; both are ISO date-times with offset.
 * - An occurrence is returned when it overlaps the range: `occurrenceStart < to` and
 *   `occurrenceEnd > from`. A timed point event (end null) is returned when
 *   `from <= occurrenceStart < to`. All-day dates count from local midnight in the workspace time
 *   zone, and an all-day event with end null lasts one day.
 * - `databaseIds` (comma-separated) limits the databases; default is every database with a date
 *   property. Each database uses its first date property (by position).
 * - Occurrences are sorted by `occurrenceStart`, then `rowId`.
 */
export const CalendarEventsQuery = z
  .object({
    from: IsoDateTime,
    to: IsoDateTime,
    databaseIds: z.string().max(4000).optional(),
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), {
    message: 'from must be before to',
    path: ['to'],
  })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= MAX_CALENDAR_RANGE_DAYS * 86_400_000, {
    message: `range is longer than ${MAX_CALENDAR_RANGE_DAYS} days`,
    path: ['to'],
  });
export type CalendarEventsQuery = z.infer<typeof CalendarEventsQuery>;
export const CalendarEventsResponse = z.object({ events: z.array(EventOccurrence) });
export type CalendarEventsResponse = z.infer<typeof CalendarEventsResponse>;

/* ------------------------------------------------------------------ changesets (undo) */

/** GET /api/changesets?limit=&source=&agentRunId= (newest first, limit 1..200, default 50). */
export const ListChangesetsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  source: ChangesetSource.optional(),
  agentRunId: Id.optional(),
});
export type ListChangesetsQuery = z.infer<typeof ListChangesetsQuery>;
export const ListChangesetsResponse = z.object({ changesets: z.array(Changeset) });
export type ListChangesetsResponse = z.infer<typeof ListChangesetsResponse>;

/**
 * POST /api/changesets/:id/undo. Undo writes a new changeset (source `user`, label
 * `Undo: <label>`). If an entity changed after the changeset → 409 `undo_conflict`.
 */
export const UndoChangesetResponse = z.object({ undoChangesetId: Id });
export type UndoChangesetResponse = z.infer<typeof UndoChangesetResponse>;
