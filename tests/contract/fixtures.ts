/**
 * Valid sample values for every schema exported by @fortnight/shared, keyed by schema object
 * (aliases such as `CreatePageResponse = Page` share an entry). `schemas.test.ts` fails if an
 * exported schema has no entry, so new schemas must add one here.
 */
import * as s from '@fortnight/shared';
import type { z } from 'zod';

export interface Fixture {
  /** JSON input. */
  input: unknown;
  /** Expected parse output when it differs from the input (trims, coercions, defaults). */
  output?: unknown;
}

const T = '2026-11-11T10:00:00.000Z';
const id = (n: number) => `01940000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const richText = { text: 'Hello', marks: ['bold'], href: 'https://example.com' };
const mentionPage = { type: 'page', pageId: id(1) };
const workspace = {
  id: id(1),
  name: 'Fortnight',
  settings: { timeZone: 'Asia/Tashkent', weekStartsOn: 1 },
  createdAt: T,
  updatedAt: T,
};
const mockUser = { id: 'u_0123456789abcdef', name: 'Ada Lovelace', initials: 'AL', color: 'blue' };
const page = {
  id: id(2),
  parentId: null,
  kind: 'page',
  databaseId: null,
  title: 'Notes',
  icon: '📝',
  cover: null,
  position: 'a0',
  archivedAt: null,
  version: 3,
  createdAt: T,
  updatedAt: T,
};
const block = {
  id: id(3),
  pageId: id(2),
  parentId: null,
  type: 'to_do',
  position: 'a0',
  content: { rich: [richText], checked: false },
  createdAt: T,
  updatedAt: T,
};
const dateTimed = {
  start: '2026-11-16T10:00:00+05:00',
  end: '2026-11-16T11:00:00+05:00',
  allDay: false,
  recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231',
};
const dateAllDay = { start: '2026-11-18', end: '2026-11-21', allDay: true, recurrence: null };
const database = {
  id: id(4),
  pageId: id(5),
  title: 'Calendar',
  titlePropertyId: id(6),
  createdAt: T,
  updatedAt: T,
};
const selectOption = { id: id(7), name: 'Work', color: 'blue' };
const property = {
  id: id(8),
  databaseId: id(4),
  name: 'Tags',
  position: 'a2',
  type: 'multi_select',
  config: { options: [selectOption] },
};
const row = {
  id: id(9),
  databaseId: id(4),
  position: 'a0',
  title: 'Team sync',
  properties: { [id(10)]: dateTimed, [id(8)]: [id(7)], [id(11)]: 'notes', [id(12)]: null },
  archivedAt: null,
  version: 0,
  createdAt: T,
  updatedAt: T,
};
const filter = {
  and: [
    { propertyId: id(8), op: 'contains', value: id(7) },
    {
      or: [
        { propertyId: id(10), op: 'this_week' },
        { propertyId: id(11), op: 'is_empty' },
      ],
    },
  ],
};
const sort = { propertyId: 'created_time', direction: 'desc' };
const viewConfig = {
  filter,
  sorts: [sort],
  visiblePropertyIds: [id(8)],
  propertyWidths: { [id(8)]: 200 },
  datePropertyId: id(10),
  calendarMode: 'week',
};
const view = {
  id: id(13),
  databaseId: id(4),
  name: 'Week',
  position: 'a0',
  type: 'calendar',
  config: viewConfig,
};
const occurrence = {
  id: `${id(9)}:2026-11-18T10:00:00+05:00`,
  rowId: id(9),
  databaseId: id(4),
  datePropertyId: id(10),
  title: 'Team sync',
  start: '2026-11-16T10:00:00+05:00',
  end: '2026-11-16T11:00:00+05:00',
  allDay: false,
  recurring: true,
  recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE',
  occurrenceStart: '2026-11-18T10:00:00+05:00',
  occurrenceEnd: '2026-11-18T11:00:00+05:00',
};
const changeOpPut = { kind: 'put', entity: 'block', id: id(3), value: { title: 'x' } };
const changeOpRemove = { kind: 'remove', entity: 'block', id: id(3) };
const changeset = {
  id: id(14),
  source: 'agent',
  label: 'Agent: create_event',
  agentRunId: id(15),
  toolUseId: 'toolu_01',
  ops: [changeOpPut],
  inverse: [changeOpRemove],
  createdAt: T,
  undoneAt: null,
};
const insertOp = {
  op: 'insert',
  block: { id: id(16), parentId: null, position: 'a1', type: 'heading_2', content: { rich: [] } },
};
const updateOp = { op: 'update', id: id(3), type: 'code', content: { text: 'x', language: 'ts' } };
const moveOp = { op: 'move', id: id(3), parentId: id(16), position: 'a0' };
const deleteOp = { op: 'delete', id: id(3) };
const affected = { pageIds: [id(2)], rowIds: [], databaseIds: [] };
const profile = {
  id: 'sonnet-full',
  name: 'Sonnet, full access',
  description: 'Balanced',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  instructions: null,
  tools: 'all',
};
const conversation = {
  id: id(17),
  title: 'Plan the week',
  profileId: 'sonnet-full',
  createdAt: T,
  updatedAt: T,
};
const toolCallItem = {
  kind: 'tool_call',
  id: id(18),
  runId: id(15),
  toolUseId: 'toolu_01',
  name: 'create_event',
  input: { title: 'Review' },
  ok: true,
  summary: 'Created "Review"',
  changesetId: id(14),
  affected,
  undoneAt: null,
  createdAt: T,
};
const searchResult = {
  kind: 'row',
  id: id(9),
  pageId: id(9),
  databaseId: id(4),
  title: 'Team sync',
  snippet: '…weekly team sync…',
  blockId: null,
};
const validationDetails = { in: 'body', issues: [{ path: ['ops', 0, 'type'], message: 'bad' }] };

const same = (input: unknown): Fixture[] => [{ input }];

export const FIXTURES = new Map<z.ZodType, Fixture[]>([
  // common
  [s.Id, same(id(1))],
  [s.Timestamp, same(T)],
  [s.IsoDateTime, [{ input: '2026-11-11T09:00:00+05:00' }, { input: T }]],
  [s.IsoDate, same('2026-11-11')],
  [s.Position, same('a0V')],
  [s.TimeZone, [{ input: 'Europe/Berlin' }, { input: 'UTC' }]],
  [s.Color, same('purple')],
  [s.ErrorCode, same('version_conflict')],
  [s.ApiError, [{ input: { error: { code: 'not_found', message: 'No page' } } }]],
  [s.ValidationErrorDetails, same(validationDetails)],
  [s.EmptyResponse, same({})],
  // filters
  [s.FilterOp, same('on_or_before')],
  [
    s.FilterValue,
    [
      { input: 'x' },
      { input: 3 },
      { input: true },
      { input: { start: '2026-11-01', end: '2026-11-30' } },
    ],
  ],
  [
    s.FilterCondition,
    same({ propertyId: id(10), op: 'between', value: { start: '2026-11-01', end: '2026-11-30' } }),
  ],
  [s.Filter, same(filter)],
  [s.Sort, same(sort)],
  // model
  [s.WorkspaceSettings, same(workspace.settings)],
  [s.Workspace, same(workspace)],
  [s.MockUser, same(mockUser)],
  [s.TextMark, same('strike')],
  [s.Mention, [{ input: mentionPage }, { input: { type: 'date', date: '2026-11-11' } }]],
  [s.RichText, [{ input: richText }, { input: { text: 'Calendar', mention: mentionPage } }]],
  [s.BlockType, same('database_view')],
  [s.RichContent, same({ rich: [richText] })],
  [s.ToDoContent, same({ rich: [], checked: true })],
  [s.CodeContent, same({ text: 'let x = 1;', language: 'typescript' })],
  [s.ImageContent, same({ url: `/uploads/${id(19)}`, caption: [], width: 320 })],
  [s.DividerContent, same({})],
  [s.DatabaseViewContent, same({ databaseId: id(4), viewId: id(13) })],
  [
    s.BlockTypeContent,
    [
      { input: { type: 'paragraph', content: { rich: [richText] } } },
      { input: { type: 'divider', content: {} } },
      {
        input: {
          type: 'image',
          content: { url: 'https://x.test/a.png', caption: [], width: null },
        },
      },
    ],
  ],
  [s.Block, same(block)],
  [s.PageKind, same('database')],
  [s.Page, [{ input: page }, { input: { ...page, kind: 'database', databaseId: id(4) } }]],
  [
    s.DateValue,
    [
      { input: dateTimed },
      { input: dateAllDay },
      { input: { start: '2026-11-25', end: null, allDay: true, recurrence: 'FREQ=DAILY;COUNT=3' } },
      { input: { start: '2026-11-25T08:00:00Z', end: null, allDay: false, recurrence: null } },
    ],
  ],
  [s.Database, same(database)],
  [s.PropertyType, same('relation')],
  [s.SelectOption, same(selectOption)],
  [s.EmptyConfig, same({})],
  [s.NumberConfig, same({ format: 'percent' })],
  [s.SelectConfig, same({ options: [selectOption] })],
  [s.RelationConfig, same({ targetDatabaseId: id(4) })],
  [s.PropertyConfig, [{ input: { format: 'currency' } }, { input: { targetDatabaseId: id(4) } }]],
  [s.PropertyDefinition, [{ input: { name: 'Done', type: 'checkbox', config: {} } }]],
  [
    s.Property,
    [
      { input: property },
      { input: { ...property, type: 'number', name: 'Cost', config: { format: 'currency' } } },
    ],
  ],
  [
    s.PropertyValue,
    [
      { input: null },
      { input: 'text' },
      { input: 4.5 },
      { input: false },
      { input: [id(7)] },
      { input: dateAllDay },
    ],
  ],
  [s.Row, same(row)],
  [s.ViewType, same('gallery')],
  [s.ViewConfig, [{ input: viewConfig }, { input: {} }]],
  [s.View, same(view)],
  [s.EventOccurrence, same(occurrence)],
  [s.EntityKind, same('property')],
  [s.ChangeOp, [{ input: changeOpPut }, { input: changeOpRemove }]],
  [s.ChangesetSource, same('ai_inline')],
  [s.Changeset, same(changeset)],
  // ops
  [s.InsertBlockOp, same(insertOp)],
  [s.UpdateBlockOp, same(updateOp)],
  [s.MoveBlockOp, same(moveOp)],
  [s.DeleteBlockOp, same(deleteOp)],
  [s.BlockOp, [{ input: insertOp }, { input: updateOp }, { input: moveOp }, { input: deleteOp }]],
  // api
  [s.HealthResponse, same({ ok: true, contractVersion: '1.0.0', agentKeyConfigured: false })],
  [
    s.LoginRequest,
    [
      { input: { name: '  Ada  ', password: 'x' }, output: { name: 'Ada', password: 'x' } },
      { input: { name: 'Ada' } },
    ],
  ],
  [s.SessionResponse, same({ user: mockUser })],
  [s.UpdateWorkspaceRequest, same({ name: 'Home', settings: { timeZone: 'UTC' } })],
  [s.IdParams, same({ id: id(2) })],
  [
    s.ListPagesQuery,
    [{ input: { includeArchived: 'true' }, output: { includeArchived: true } }, { input: {} }],
  ],
  [s.ListPagesResponse, same({ pages: [page] })],
  [s.CreatePageRequest, same({ title: 'New', parentId: null, afterId: id(2), icon: null })],
  [s.GetPageResponse, same({ page, blocks: [block] })],
  [s.UpdatePageRequest, same({ version: 3, title: 'Renamed', parentId: id(1), position: 'a1' })],
  [s.OpsRequest, same({ ops: [insertOp, updateOp, moveOp, deleteOp], label: 'Edit page' })],
  [
    s.PageOpsResponse,
    same({ changesetId: id(14), page, blocks: [block], deletedBlockIds: [id(20)] }),
  ],
  [s.RowOpsResponse, same({ changesetId: id(14), row, blocks: [block], deletedBlockIds: [] })],
  [
    s.VersionConflictDetails,
    [{ input: { entity: 'page', current: page } }, { input: { entity: 'row', current: row } }],
  ],
  [
    s.VersionConflictError,
    same({
      error: {
        code: 'version_conflict',
        message: 'Stale',
        details: { entity: 'page', current: page },
      },
    }),
  ],
  [s.UndoConflictDetails, same({ conflicts: [{ entity: 'block', id: id(3) }] })],
  [
    s.UndoConflictError,
    same({
      error: {
        code: 'undo_conflict',
        message: 'Changed',
        details: { conflicts: [{ entity: 'row', id: id(9) }] },
      },
    }),
  ],
  [
    s.SearchQuery,
    [
      { input: { q: ' plan ', limit: '5' }, output: { q: 'plan', limit: 5 } },
      { input: { q: 'x' }, output: { q: 'x', limit: 20 } },
    ],
  ],
  [s.SearchResult, same(searchResult)],
  [s.SearchResponse, same({ results: [searchResult] })],
  [s.UploadResponse, same({ id: id(19), url: `/uploads/${id(19)}` })],
  [
    s.CreateDatabaseRequest,
    same({
      title: 'Tasks',
      parentId: null,
      properties: [{ name: 'Due', type: 'date', config: {} }],
    }),
  ],
  [
    s.CreateDatabaseResponse,
    same({
      database,
      page: { ...page, kind: 'database', databaseId: id(4) },
      properties: [property],
      views: [view],
    }),
  ],
  [s.ListDatabasesResponse, same({ databases: [database] })],
  [s.GetDatabaseResponse, same({ database, properties: [property], views: [view] })],
  [s.UpdateDatabaseRequest, same({ title: 'Events' })],
  [
    s.CreatePropertyRequest,
    same({ name: 'Status', type: 'select', config: { options: [selectOption] }, afterId: id(8) }),
  ],
  [
    s.UpdatePropertyRequest,
    same({ name: 'Labels', config: { options: [selectOption] }, position: 'a5' }),
  ],
  [s.DeletePropertyResponse, same({ changesetId: id(14) })],
  [
    s.QueryDatabaseRequest,
    same({ filter, sorts: [sort], cursor: null, limit: 100, viewId: id(13) }),
  ],
  [s.QueryDatabaseResponse, same({ rows: [row], nextCursor: 'opaque' })],
  [
    s.CreateRowRequest,
    same({ title: 'New event', properties: { [id(10)]: dateAllDay }, afterId: null }),
  ],
  [s.GetRowResponse, same({ row, blocks: [block] })],
  [
    s.UpdateRowRequest,
    same({ version: 0, title: 'Moved', properties: { [id(10)]: dateAllDay, [id(11)]: null } }),
  ],
  [
    s.CreateViewRequest,
    same({ name: 'Board', type: 'board', config: { groupByPropertyId: id(21) } }),
  ],
  [s.UpdateViewRequest, same({ name: 'Board 2', config: {}, position: 'a3' })],
  [
    s.CalendarEventsQuery,
    same({
      from: '2026-11-01T00:00:00+05:00',
      to: '2026-12-01T00:00:00+05:00',
      databaseIds: `${id(4)},${id(22)}`,
    }),
  ],
  [s.CalendarEventsResponse, same({ events: [occurrence] })],
  [
    s.ListChangesetsQuery,
    [
      {
        input: { limit: '10', source: 'agent', agentRunId: id(15) },
        output: { limit: 10, source: 'agent', agentRunId: id(15) },
      },
      { input: {}, output: { limit: 50 } },
    ],
  ],
  [s.ListChangesetsResponse, same({ changesets: [changeset] })],
  [s.UndoChangesetResponse, same({ undoChangesetId: id(23) })],
  // agent
  [s.AgentProfile, same(profile)],
  [s.AgentProfilesResponse, same({ profiles: [profile], defaultProfileId: 'sonnet-full' })],
  [s.SetDefaultProfileRequest, same({ profileId: 'haiku-read' })],
  [s.SetDefaultProfileResponse, same({ defaultProfileId: 'haiku-read' })],
  [s.Conversation, same(conversation)],
  [
    s.CreateConversationRequest,
    [{ input: { title: 'Hi', profileId: 'sonnet-full' } }, { input: {} }],
  ],
  [s.UpdateConversationRequest, same({ profileId: 'opus-full' })],
  [s.ListConversationsResponse, same({ conversations: [conversation] })],
  [s.AffectedEntities, same(affected)],
  [s.AgentToolName, same('query_database')],
  [
    s.AgentTranscriptItem,
    [
      { input: { kind: 'user_message', id: id(24), runId: id(15), text: 'Hi', createdAt: T } },
      { input: { kind: 'assistant_text', id: id(25), runId: id(15), text: 'Hello', createdAt: T } },
      { input: toolCallItem },
      {
        input: {
          kind: 'run_error',
          id: id(26),
          runId: id(15),
          code: 'agent_key_missing',
          message: 'Add your key',
          createdAt: T,
        },
      },
    ],
  ],
  [s.GetConversationResponse, same({ conversation, items: [toolCallItem] })],
  [
    s.SendMessageRequest,
    same({
      text: 'Schedule a 1h review every Friday',
      context: {
        pageId: id(2),
        selectedBlockIds: [id(3)],
        now: '2026-11-11T10:00:00+05:00',
        timeZone: 'Asia/Tashkent',
      },
    }),
  ],
  [s.UndoRunResponse, same({ undoneChangesetIds: [id(14)] })],
  [
    s.InlineAiRequest,
    [
      { input: { action: 'summarize', pageId: id(2), blockIds: [id(3)] } },
      {
        input: { action: 'custom', pageId: id(2), text: 'abc', instruction: 'Translate to Uzbek' },
      },
    ],
  ],
  [s.AgentFilterCondition, same({ property: 'Date', op: 'next_week' })],
  [
    s.AgentFilter,
    same({
      or: [
        { property: 'Tags', op: 'contains', value: 'Work' },
        { property: 'Done', op: 'is', value: false },
      ],
    }),
  ],
  [s.AgentSort, same({ property: 'Date', direction: 'asc' })],
  [
    s.AgentPropertyValue,
    [
      { input: 'Work' },
      { input: ['Work', 'Focus'] },
      {
        input: {
          start: '2026-11-20T16:00:00+05:00',
          end: '2026-11-20T17:00:00+05:00',
          recurrence: 'FREQ=WEEKLY;BYDAY=FR',
        },
      },
      { input: null },
    ],
  ],
]);

/** Fixtures for schemas held in records (SSE events, tool inputs). */
export const AGENT_SSE_FIXTURES: Record<s.AgentSseEventName, unknown> = {
  'run.started': {
    runId: id(15),
    conversationId: id(17),
    profileId: 'sonnet-full',
    model: 'claude-sonnet-5-5',
  },
  'text.delta': { text: 'Sure, ' },
  'tool.started': { toolUseId: 'toolu_01', name: 'create_event', input: { title: 'Review' } },
  'tool.finished': {
    toolUseId: 'toolu_01',
    ok: true,
    summary: 'Created',
    changesetId: id(14),
    affected,
  },
  'run.finished': {
    runId: id(15),
    stopReason: 'end_turn',
    changesetIds: [id(14)],
    usage: { inputTokens: 1200, outputTokens: 300 },
  },
  error: { code: 'agent_key_missing', message: 'Add your key to .env' },
};

export const INLINE_SSE_FIXTURES: Record<s.InlineSseEventName, unknown> = {
  'text.delta': { text: 'Shorter text' },
  done: { usage: { inputTokens: 10, outputTokens: 5 } },
  error: { code: 'internal_error', message: 'failed' },
};

export const TOOL_INPUT_FIXTURES: Record<s.AgentToolName, unknown> = {
  search_workspace: { query: 'roadmap', limit: 5 },
  list_pages: { parentId: null, depth: 2 },
  get_page: { pageId: id(2) },
  create_page: { title: 'Plan', parentId: id(2), icon: '🗓️', markdown: '# Plan\n\n- [ ] one' },
  update_page: { pageId: id(2), title: 'Plan v2', parentId: null },
  archive_page: { pageId: id(2) },
  append_blocks: { pageId: id(2), markdown: 'More text', afterBlockId: id(3) },
  update_block: { blockId: id(3), markdown: '- [x] done' },
  delete_blocks: { blockIds: [id(3)] },
  list_databases: {},
  get_database: { databaseId: id(4) },
  query_database: {
    databaseId: id(4),
    filter: { property: 'Date', op: 'this_week' },
    sorts: [{ property: 'Date', direction: 'asc' }],
    limit: 50,
  },
  create_row: { databaseId: id(4), title: 'Task', properties: { Tags: ['Work'], Done: false } },
  update_row: { rowId: id(9), properties: { Notes: 'Moved' } },
  archive_row: { rowId: id(9) },
  list_events: { from: '2026-11-16T00:00:00+05:00', to: '2026-11-23T00:00:00+05:00' },
  create_event: {
    title: 'Review',
    start: '2026-11-20T16:00:00+05:00',
    end: '2026-11-20T17:00:00+05:00',
    recurrence: 'FREQ=WEEKLY;BYDAY=FR',
    notes: 'Weekly',
  },
  move_event: { rowId: id(9), start: '2026-11-21', allDay: true },
  delete_event: { rowId: id(9) },
};

/** Inputs that must be rejected, with the schema that rejects them. */
export const INVALID: [string, z.ZodType, unknown][] = [
  ['timestamp with offset', s.Timestamp, '2026-11-11T10:00:00+05:00'],
  ['bad position', s.Position, 'a-0'],
  ['unknown time zone', s.TimeZone, 'Mars/Olympus'],
  ['block type/content mismatch', s.Block, { ...block, type: 'code' }],
  ['update op type/content mismatch', s.UpdateBlockOp, { ...updateOp, type: 'divider' }],
  ['update op without content', s.UpdateBlockOp, { op: 'update', id: id(3), type: 'paragraph' }],
  ['all-day with date-time', s.DateValue, { ...dateAllDay, start: '2026-11-18T00:00:00Z' }],
  ['timed with date', s.DateValue, { ...dateTimed, end: '2026-11-17' }],
  ['end before start', s.DateValue, { ...dateAllDay, end: '2026-11-17' }],
  ['all-day end equal to start', s.DateValue, { ...dateAllDay, end: '2026-11-18' }],
  ['bad recurrence', s.DateValue, { ...dateAllDay, recurrence: 'FREQ=YEARLY' }],
  [
    'count and until',
    s.DateValue,
    { ...dateAllDay, recurrence: 'FREQ=DAILY;COUNT=2;UNTIL=20261231' },
  ],
  ['filter with stray key', s.Filter, { and: [], propertyId: 'x' }],
  ['filter unknown op', s.Filter, { propertyId: 'x', op: 'like' }],
  ['row parsed as page', s.Page, row],
  ['empty login name', s.LoginRequest, { name: '   ' }],
  [
    'calendar range reversed',
    s.CalendarEventsQuery,
    { from: '2026-12-01T00:00:00Z', to: '2026-11-01T00:00:00Z' },
  ],
  [
    'calendar range too long',
    s.CalendarEventsQuery,
    { from: '2026-01-01T00:00:00Z', to: '2027-12-01T00:00:00Z' },
  ],
  [
    'calendar range without offset',
    s.CalendarEventsQuery,
    { from: '2026-11-01T00:00:00', to: '2026-12-01T00:00:00' },
  ],
  ['custom inline AI without instruction', s.InlineAiRequest, { action: 'custom', pageId: id(2) }],
  ['empty ops batch', s.OpsRequest, { ops: [] }],
  ['unknown error code', s.ApiError, { error: { code: 'teapot', message: 'x' } }],
  ['non-empty logout body', s.LogoutResponse, { ok: true }],
  [
    'health without ok',
    s.HealthResponse,
    { ok: false, contractVersion: '1', agentKeyConfigured: false },
  ],
  [
    'select property with relation config',
    s.Property,
    { ...property, type: 'select', config: { targetDatabaseId: id(4) } },
  ],
  ['upload url outside /uploads', s.UploadResponse, { id: id(19), url: 'https://evil.test/x' }],
];
