import type {
  AffectedEntities,
  BlockType,
  ChangeOp,
  ChangesetSource,
  PropertyType,
  PropertyValue,
  ViewConfig,
  ViewType,
  WorkspaceSettings,
} from '@fortnight/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * SQLite schema for the whole v0.1 data model (plan section 4). Column names are snake_case
 * (Drizzle `casing: 'snake_case'`). JSON columns hold contract-shaped values. Timestamps are ISO
 * strings in UTC. Search uses the FTS5 table `search_index` from a custom migration.
 */

const timestamps = {
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
};

/** Single row: the one local workspace. */
export const workspace = sqliteTable('workspace', {
  id: text().primaryKey(),
  name: text().notNull(),
  settings: text({ mode: 'json' }).$type<WorkspaceSettings>().notNull(),
  ...timestamps,
});

/**
 * Pages, full-page databases and database rows. Rows (`kind = 'row'`) have `databaseId` and
 * `properties`, can hold blocks, and are never listed in the sidebar. A database page has
 * `kind = 'database'` and `databaseId` pointing to its database.
 */
export const pages = sqliteTable(
  'pages',
  {
    id: text().primaryKey(),
    parentId: text(),
    kind: text({ enum: ['page', 'database', 'row'] }).notNull(),
    databaseId: text(),
    title: text().notNull().default(''),
    icon: text(),
    cover: text(),
    position: text().notNull(),
    properties: text({ mode: 'json' }).$type<Record<string, PropertyValue>>(),
    archivedAt: text(),
    version: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('pages_parent_idx').on(t.parentId, t.position),
    index('pages_database_idx').on(t.databaseId, t.kind, t.position),
  ],
);

export const blocks = sqliteTable(
  'blocks',
  {
    id: text().primaryKey(),
    pageId: text()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    parentId: text(),
    type: text().$type<BlockType>().notNull(),
    position: text().notNull(),
    content: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (t) => [index('blocks_page_idx').on(t.pageId, t.parentId, t.position)],
);

export const databases = sqliteTable('databases', {
  id: text().primaryKey(),
  pageId: text()
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  title: text().notNull().default(''),
  titlePropertyId: text().notNull(),
  ...timestamps,
});

export const properties = sqliteTable(
  'properties',
  {
    id: text().primaryKey(),
    databaseId: text()
      .notNull()
      .references(() => databases.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    type: text().$type<PropertyType>().notNull(),
    position: text().notNull(),
    config: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (t) => [index('properties_database_idx').on(t.databaseId, t.position)],
);

export const views = sqliteTable(
  'views',
  {
    id: text().primaryKey(),
    databaseId: text()
      .notNull()
      .references(() => databases.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    type: text().$type<ViewType>().notNull(),
    position: text().notNull(),
    config: text({ mode: 'json' }).$type<ViewConfig>().notNull(),
    ...timestamps,
  },
  (t) => [index('views_database_idx').on(t.databaseId, t.position)],
);

/** Undo log. Every mutation writes one changeset. */
export const changesets = sqliteTable(
  'changesets',
  {
    id: text().primaryKey(),
    source: text().$type<ChangesetSource>().notNull(),
    label: text().notNull(),
    agentRunId: text(),
    toolUseId: text(),
    ops: text({ mode: 'json' }).$type<ChangeOp[]>().notNull(),
    inverse: text({ mode: 'json' }).$type<ChangeOp[]>().notNull(),
    createdAt: text().notNull(),
    undoneAt: text(),
  },
  (t) => [
    index('changesets_created_idx').on(t.createdAt),
    index('changesets_run_idx').on(t.agentRunId),
  ],
);

/** Uploaded images; the file is stored at `<dataDir>/uploads/<id>`. */
export const uploads = sqliteTable('uploads', {
  id: text().primaryKey(),
  fileName: text().notNull(),
  mimeType: text().notNull(),
  size: integer().notNull(),
  createdAt: text().notNull(),
});

/** Small key-value settings, e.g. `defaultAgentProfileId`. */
export const appSettings = sqliteTable('app_settings', {
  key: text().primaryKey(),
  value: text({ mode: 'json' }).$type<unknown>().notNull(),
});

export const agentConversations = sqliteTable('agent_conversations', {
  id: text().primaryKey(),
  title: text().notNull().default(''),
  profileId: text().notNull(),
  /** Exact Messages API history (assistant content replayed unchanged, incl. thinking blocks). */
  apiMessages: text({ mode: 'json' }).$type<unknown[]>().notNull().default([]),
  ...timestamps,
});

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text().primaryKey(),
    conversationId: text()
      .notNull()
      .references(() => agentConversations.id, { onDelete: 'cascade' }),
    profileId: text().notNull(),
    model: text().notNull(),
    status: text({ enum: ['running', 'finished', 'cancelled', 'failed'] }).notNull(),
    stopReason: text(),
    usage: text({ mode: 'json' }).$type<{ inputTokens: number; outputTokens: number }>(),
    createdAt: text().notNull(),
    finishedAt: text(),
  },
  (t) => [index('agent_runs_conversation_idx').on(t.conversationId)],
);

/** Transcript entries of a conversation (`AgentTranscriptItem`), ordered by `seq`. */
export const agentItems = sqliteTable(
  'agent_items',
  {
    id: text().primaryKey(),
    conversationId: text()
      .notNull()
      .references(() => agentConversations.id, { onDelete: 'cascade' }),
    runId: text().notNull(),
    seq: integer().notNull(),
    kind: text({ enum: ['user_message', 'assistant_text', 'tool_call', 'run_error'] }).notNull(),
    data: text({ mode: 'json' })
      .$type<Record<string, unknown> & { affected?: AffectedEntities }>()
      .notNull(),
    createdAt: text().notNull(),
  },
  (t) => [index('agent_items_conversation_idx').on(t.conversationId, t.seq)],
);
