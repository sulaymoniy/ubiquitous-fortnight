import { z } from 'zod';
import { EmptyResponse, Id, IsoDate, IsoDateTime, TimeZone, Timestamp } from './common.ts';
import { FILTER_OPS, FilterValue } from './filters.ts';

/**
 * Agent API (plan sections 4.5 and 4.6). Routes:
 * GET /api/agent/profiles · PATCH /api/agent/profiles/default ·
 * POST|GET /api/agent/conversations · GET|PATCH /api/agent/conversations/:id ·
 * POST /api/agent/conversations/:id/messages (SSE) · POST /api/agent/runs/:runId/cancel ·
 * POST /api/agent/runs/:runId/undo · POST /api/ai/inline (SSE).
 */

/* ------------------------------------------------------------------ profiles */

/**
 * An agent profile (decision D5). Built-in profiles live in the server; extra ones can be added
 * in a gitignored `agent-profiles.json` at the repo root. The API key is never part of a profile.
 */
export const AgentProfile = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  provider: z.literal('anthropic'),
  /** Model id, e.g. `claude-sonnet-5-5`. Verified against provider docs when the agent is built. */
  model: z.string().min(1).max(100),
  effort: z.enum(['low', 'medium', 'high']),
  /** Extra system instructions added to the base prompt. */
  instructions: z.string().max(20_000).nullable(),
  /** `read_only` hides every mutating tool. */
  tools: z.enum(['all', 'read_only']),
});
export type AgentProfile = z.infer<typeof AgentProfile>;

export const AgentProfilesResponse = z.object({
  profiles: z.array(AgentProfile),
  defaultProfileId: z.string(),
});
export type AgentProfilesResponse = z.infer<typeof AgentProfilesResponse>;

export const SetDefaultProfileRequest = z.object({ profileId: z.string().min(1).max(64) });
export type SetDefaultProfileRequest = z.infer<typeof SetDefaultProfileRequest>;
export const SetDefaultProfileResponse = z.object({ defaultProfileId: z.string() });
export type SetDefaultProfileResponse = z.infer<typeof SetDefaultProfileResponse>;

/* ------------------------------------------------------------------ conversations */

export const Conversation = z.object({
  id: Id,
  title: z.string().max(200),
  /** Profile used for the next message. Switching takes effect on the next message. */
  profileId: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Conversation = z.infer<typeof Conversation>;

export const CreateConversationRequest = z.object({
  title: z.string().max(200).optional(),
  /** Default: the workspace default profile. */
  profileId: z.string().min(1).max(64).optional(),
});
export type CreateConversationRequest = z.infer<typeof CreateConversationRequest>;
export const CreateConversationResponse = Conversation;

export const UpdateConversationRequest = z.object({
  title: z.string().max(200).optional(),
  profileId: z.string().min(1).max(64).optional(),
});
export type UpdateConversationRequest = z.infer<typeof UpdateConversationRequest>;
export const UpdateConversationResponse = Conversation;

/** Newest first. */
export const ListConversationsResponse = z.object({ conversations: z.array(Conversation) });
export type ListConversationsResponse = z.infer<typeof ListConversationsResponse>;

/** Entities a tool call changed; the client refetches them. */
export const AffectedEntities = z.object({
  pageIds: z.array(Id),
  rowIds: z.array(Id),
  databaseIds: z.array(Id),
});
export type AffectedEntities = z.infer<typeof AffectedEntities>;

export const AGENT_TOOL_NAMES = [
  'search_workspace',
  'list_pages',
  'get_page',
  'create_page',
  'update_page',
  'archive_page',
  'append_blocks',
  'update_block',
  'delete_blocks',
  'list_databases',
  'get_database',
  'query_database',
  'create_row',
  'update_row',
  'archive_row',
  'list_events',
  'create_event',
  'move_event',
  'delete_event',
] as const;
export const AgentToolName = z.enum(AGENT_TOOL_NAMES);
export type AgentToolName = z.infer<typeof AgentToolName>;

/** One entry of a stored conversation, in order. */
export const AgentTranscriptItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user_message'),
    id: Id,
    runId: Id,
    text: z.string(),
    createdAt: Timestamp,
  }),
  z.object({
    kind: z.literal('assistant_text'),
    id: Id,
    runId: Id,
    text: z.string(),
    createdAt: Timestamp,
  }),
  z.object({
    kind: z.literal('tool_call'),
    id: Id,
    runId: Id,
    toolUseId: z.string(),
    name: AgentToolName,
    input: z.unknown(),
    /** Null while running. */
    ok: z.boolean().nullable(),
    summary: z.string().nullable(),
    changesetId: Id.nullable(),
    affected: AffectedEntities,
    /** Set when this tool call's changeset was undone. */
    undoneAt: Timestamp.nullable(),
    createdAt: Timestamp,
  }),
  z.object({
    kind: z.literal('run_error'),
    id: Id,
    runId: Id,
    code: z.string(),
    message: z.string(),
    createdAt: Timestamp,
  }),
]);
export type AgentTranscriptItem = z.infer<typeof AgentTranscriptItem>;

export const GetConversationResponse = z.object({
  conversation: Conversation,
  items: z.array(AgentTranscriptItem),
});
export type GetConversationResponse = z.infer<typeof GetConversationResponse>;

/** POST /api/agent/conversations/:id/messages → `text/event-stream` of AgentSseEvent. */
export const SendMessageRequest = z.object({
  text: z.string().trim().min(1).max(20_000),
  context: z.object({
    /** Page or row the user is looking at. */
    pageId: Id.optional(),
    selectedBlockIds: z.array(Id).max(500).optional(),
    /** The client's current time with its offset. */
    now: IsoDateTime,
    timeZone: TimeZone,
  }),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

/* ------------------------------------------------------------------ SSE events */

/**
 * Server-sent events of an agent run. Each event is `event: <name>` + `data: <JSON>`.
 * Order: `run.started`, then any mix of `text.delta` / `tool.started` / `tool.finished`,
 * then exactly one of `run.finished` or `error` as the last event.
 */
export const AGENT_SSE_EVENTS = {
  'run.started': z.object({
    runId: Id,
    conversationId: Id,
    profileId: z.string(),
    model: z.string(),
  }),
  'text.delta': z.object({ text: z.string() }),
  'tool.started': z.object({
    toolUseId: z.string(),
    name: AgentToolName,
    input: z.unknown(),
  }),
  'tool.finished': z.object({
    toolUseId: z.string(),
    ok: z.boolean(),
    summary: z.string(),
    /** Null for read-only tools and failed calls. */
    changesetId: Id.nullable(),
    affected: AffectedEntities,
  }),
  'run.finished': z.object({
    runId: Id,
    /** Provider stop reason, or `cancelled` / `iteration_limit`. */
    stopReason: z.string(),
    changesetIds: z.array(Id),
    usage: z.object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    }),
  }),
  error: z.object({ code: z.string(), message: z.string() }),
} as const;
export type AgentSseEventName = keyof typeof AGENT_SSE_EVENTS;
export type AgentSseEvent = {
  [K in AgentSseEventName]: { event: K; data: z.infer<(typeof AGENT_SSE_EVENTS)[K]> };
}[AgentSseEventName];

/** POST /api/agent/runs/:runId/cancel. The run ends with `run.finished` (stopReason `cancelled`). */
export const CancelRunResponse = EmptyResponse;

/**
 * POST /api/agent/runs/:runId/undo: undoes every changeset of the run, newest first, as one
 * operation. Conflict → 409 `undo_conflict` and nothing is undone.
 */
export const UndoRunResponse = z.object({ undoneChangesetIds: z.array(Id) });
export type UndoRunResponse = z.infer<typeof UndoRunResponse>;

/* ------------------------------------------------------------------ inline AI */

export const INLINE_AI_ACTIONS = [
  'write',
  'continue',
  'summarize',
  'rewrite',
  'shorter',
  'longer',
  'fix_grammar',
  'custom',
] as const;

/**
 * POST /api/ai/inline → `text/event-stream` of InlineSseEvent. Uses the default profile with
 * low effort. Only streams text; the client writes accepted text through the ops endpoint with
 * label `AI: <action>`.
 */
export const InlineAiRequest = z
  .object({
    action: z.enum(INLINE_AI_ACTIONS),
    pageId: Id,
    blockIds: z.array(Id).max(500).optional(),
    /** Selected text, if any. */
    text: z.string().max(100_000).optional(),
    /** Required for `custom` and `write`. */
    instruction: z.string().max(4000).optional(),
  })
  .refine((r) => (r.action !== 'custom' && r.action !== 'write') || !!r.instruction, {
    message: 'instruction is required for custom and write',
    path: ['instruction'],
  });
export type InlineAiRequest = z.infer<typeof InlineAiRequest>;

/** Inline AI stream: `text.delta`*, then exactly one of `done` or `error`. */
export const INLINE_SSE_EVENTS = {
  'text.delta': z.object({ text: z.string() }),
  done: z.object({
    usage: z.object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    }),
  }),
  error: z.object({ code: z.string(), message: z.string() }),
} as const;
export type InlineSseEventName = keyof typeof INLINE_SSE_EVENTS;
export type InlineSseEvent = {
  [K in InlineSseEventName]: { event: K; data: z.infer<(typeof INLINE_SSE_EVENTS)[K]> };
}[InlineSseEventName];

/* ------------------------------------------------------------------ agent tool inputs */

/**
 * Tool inputs refer to properties by NAME (case-insensitive); the server resolves names to ids and
 * lists valid names in the error when one does not match. Page content goes in and out as
 * Markdown. Every mutating tool writes exactly one changeset tagged with the run and tool-use id.
 */
export type AgentFilter = { and: AgentFilter[] } | { or: AgentFilter[] } | AgentFilterCondition;
export const AgentFilterCondition = z.strictObject({
  property: z.string().min(1).max(200),
  op: z.enum(FILTER_OPS),
  value: FilterValue.optional(),
});
export type AgentFilterCondition = z.infer<typeof AgentFilterCondition>;
export const AgentFilter: z.ZodType<AgentFilter> = z.lazy(() =>
  z.union([
    z.strictObject({ and: z.array(AgentFilter).max(50) }),
    z.strictObject({ or: z.array(AgentFilter).max(50) }),
    AgentFilterCondition,
  ]),
);

export const AgentSort = z.object({
  /** Property name, or `created_time` / `updated_time`. */
  property: z.string().min(1).max(200),
  direction: z.enum(['asc', 'desc']),
});

const AgentDateInput = z.object({
  start: z.union([IsoDate, IsoDateTime]),
  end: z.union([IsoDate, IsoDateTime]).optional(),
  allDay: z.boolean().optional(),
  recurrence: z.string().max(500).optional(),
});

/**
 * Property value by property type: text/url string · number number · checkbox boolean ·
 * select option name (created if missing) · multi_select names · date `{ start, end?, allDay?,
 * recurrence? }` · relation row ids or titles · null clears.
 */
export const AgentPropertyValue = z.union([
  z.null(),
  z.string().max(100_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(2000)).max(1000),
  AgentDateInput,
]);
export type AgentPropertyValue = z.infer<typeof AgentPropertyValue>;
const AgentProperties = z.record(z.string().min(1).max(200), AgentPropertyValue);

export const AGENT_TOOL_INPUTS = {
  search_workspace: z.object({
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  list_pages: z.object({
    parentId: Id.nullable().optional(),
    depth: z.number().int().min(1).max(3).optional(),
  }),
  get_page: z.object({ pageId: Id }),
  create_page: z.object({
    title: z.string().max(2000),
    parentId: Id.optional(),
    icon: z.string().max(64).optional(),
    markdown: z.string().max(200_000).optional(),
  }),
  update_page: z.object({
    pageId: Id,
    title: z.string().max(2000).optional(),
    icon: z.string().max(64).optional(),
    parentId: Id.nullable().optional(),
  }),
  archive_page: z.object({ pageId: Id }),
  append_blocks: z.object({
    pageId: Id,
    markdown: z.string().min(1).max(200_000),
    afterBlockId: Id.optional(),
    parentBlockId: Id.optional(),
  }),
  update_block: z.object({ blockId: Id, markdown: z.string().max(200_000) }),
  delete_blocks: z.object({ blockIds: z.array(Id).min(1).max(50) }),
  list_databases: z.object({}),
  get_database: z.object({ databaseId: Id }),
  query_database: z.object({
    databaseId: Id,
    filter: AgentFilter.optional(),
    sorts: z.array(AgentSort).max(10).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  create_row: z.object({
    databaseId: Id,
    title: z.string().max(2000),
    properties: AgentProperties.optional(),
  }),
  update_row: z.object({
    rowId: Id,
    title: z.string().max(2000).optional(),
    properties: AgentProperties.optional(),
  }),
  archive_row: z.object({ rowId: Id }),
  list_events: z.object({
    from: IsoDateTime,
    to: IsoDateTime,
    databaseIds: z.array(Id).max(50).optional(),
  }),
  create_event: z.object({
    title: z.string().min(1).max(2000),
    start: z.union([IsoDate, IsoDateTime]),
    end: z.union([IsoDate, IsoDateTime]).optional(),
    allDay: z.boolean().optional(),
    recurrence: z.string().max(500).optional(),
    /** Default: the seeded "Calendar" database. */
    databaseId: Id.optional(),
    properties: AgentProperties.optional(),
    notes: z.string().max(100_000).optional(),
  }),
  move_event: z.object({
    rowId: Id,
    start: z.union([IsoDate, IsoDateTime]),
    end: z.union([IsoDate, IsoDateTime]).optional(),
    allDay: z.boolean().optional(),
  }),
  delete_event: z.object({ rowId: Id }),
} as const satisfies Record<AgentToolName, z.ZodType>;
export type AgentToolInput<T extends AgentToolName> = z.infer<(typeof AGENT_TOOL_INPUTS)[T]>;

/** Tools hidden from `read_only` profiles. */
export const MUTATING_AGENT_TOOLS = [
  'create_page',
  'update_page',
  'archive_page',
  'append_blocks',
  'update_block',
  'delete_blocks',
  'create_row',
  'update_row',
  'archive_row',
  'create_event',
  'move_event',
  'delete_event',
] as const satisfies readonly AgentToolName[];
