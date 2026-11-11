# Fortnight plan: Notion-like workspace with calendar and Claude agent

- Author: Claude (`claude/notion-plan`)
- Status: **User decisions D1–D5 made on 2026-11-11 (section 9).** Contract and remaining details are still a **proposal pending Codex review**. Nothing in the contract is agreed until both task records mark it accepted.
- Codex input: `codex/notion-plan` was not on the remote when this was written (fetched 2026-11-11). Every section below is a proposal waiting on Codex's record. Where I expect Codex to have its own view, I say so and leave the decision open.
- Communication channel: Codex runs on a different machine. The only shared channel is Git: each agent pushes its own branch and record; the user relays prompts. Neither agent can see the other's conversation.

## 1. Goal and phases

A single-user web app (behind a mock login, no real auth) that works like a Notion workspace (page tree, block editor, databases) with a built-in calendar, plus a Claude agent that can act on the workspace. It is an experiment platform for the agent, so every change must be observable and undoable.

| Phase | Content |
|---|---|
| 0 | Scaffold, shared contract package, dev loop, CI-able checks, mock login |
| 1 | Sidebar page tree, block editor (text, headings, lists, to-dos, toggles, code, quote, divider, image), "/" menu, drag to reorder, autosave, search |
| 2 | Databases: table, board, list, gallery views; properties (text, number, select, multi-select, date, checkbox, URL, relation); filter and sort |
| 3 | Calendar: month, week, day views over database rows with date properties; drag to reschedule |
| 4 | Claude agent: chat panel with tool use over pages, blocks, databases and events; inline `/ai`; every action shown and undoable; API key server-only; switch between agent profiles in the app |
| Later | Templates, sharing and export, real-time collaboration, dark mode, mobile |

## 2. Tech stack (proposal)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere, Node 22 LTS | One type system across the contract |
| Repo | npm workspaces (no extra tool needed) | Simple; Windows-friendly |
| Shared contract | `zod` schemas, TS types inferred from them | Same schema validates requests on the server and parses responses on the client |
| Backend | Fastify 5 + `fastify-type-provider-zod` | Fast, typed routes, built-in `inject` for tests |
| Storage | SQLite via `better-sqlite3` + Drizzle ORM and migrations; FTS5 for search | Zero-ops, single file, transactional; FTS5 is built in |
| Ordering | Fractional index strings (`fractional-indexing`) for pages, blocks, rows, options | Reorder without renumbering siblings; client can compute positions optimistically |
| IDs | UUIDv7 strings, client-generated for blocks | Optimistic inserts without a round trip |
| AI | `@anthropic-ai/sdk` on the server only | Key never leaves the backend |
| Frontend (Codex's call) | Suggested: React 19 + Vite + TS, TanStack Query (server state), Zustand (UI state), dnd-kit (drag), editor on TipTap/ProseMirror or BlockNote | Codex owns this choice. The contract stores blocks in our own JSON format (section 4), so the editor library can change without a data migration |
| Tests | Vitest (unit and integration), Playwright (end-to-end) | One runner per layer |
| Lint and format | ESLint + Prettier, shared root config | |

Dev loop: `npm run dev` starts the API on `:3001` and Vite on `:5173`; Vite proxies `/api` and `/uploads`. Production: `npm run build && npm start` serves the built web app from the API server.

## 3. Repository layout and ownership (proposal)

```
package.json              # workspace root, scripts            Claude (M0)
tsconfig.base.json        # shared compiler options            Claude (M0)
.eslintrc / .prettierrc   # shared lint/format config          Claude (M0)
.env.example              # ANTHROPIC_API_KEY placeholder      Claude
.env                      # your real key, local only, gitignored
.gitignore                # node_modules, data/, .env, dist/, agent-profiles.json; Claude edited with user authorization (Codex created it)
                          # root index.html removed (user decision D4); the app entry is src/web/index.html
src/
  shared/                 # @fortnight/shared: the contract    Claude keeps it; changes need both records
    src/model.ts          # entities
    src/api.ts            # request/response schemas per route
    src/filters.ts        # filter/sort grammar
    src/agent.ts          # SSE event types, tool names
    src/positions.ts      # fractional index helpers
  server/                 # @fortnight/server                  Claude
    src/app.ts, routes/, db/, services/, agent/, markdown/
  web/                    # @fortnight/web                     Codex
    index.html, vite.config.ts, src/...
tests/
  server/                 # Vitest + fastify.inject            Claude
  contract/               # server responses parse with shared schemas  Claude
  web/                    # Vitest + Testing Library           Codex
  e2e/                    # Playwright                         Codex (Claude supplies seed + fake-model mode)
data/                     # runtime SQLite + uploads, gitignored
```

Rules:
- No file has two owners. The other agent requests a change through its own task record; the owner makes it.
- `src/shared` is the contract. Claude edits it, but only to apply changes recorded as accepted in both task records. Each accepted change bumps `CONTRACT_VERSION` in `src/shared/src/index.ts` and adds a line to section 10.
- Codex consumes the contract through its own typed API client in `src/web/src/api/`.

### Why this split (and the alternative)

Proposed split: **Claude owns backend, storage, contract, agent and its tools; Codex owns the whole frontend, including the agent panel UI and the e2e suite.** This keeps every server-side invariant (ordering, undo, validation) in one place and every UI decision in another, and the boundary is the HTTP + SSE contract, which is easy to test from both sides.

Alternative: vertical slices (each agent owns a phase end to end). Rejected for now because pages, databases and the calendar share one storage model and one undo log; splitting those across owners would put two agents in the same files. Open to Codex arguing otherwise in its record.

## 4. Shared contract v0 (proposal)

All IDs are strings. All timestamps are ISO 8601 UTC. `position` is a fractional index string, compared lexicographically.

### 4.1 Entities

```ts
Workspace { id, name, settings: { timeZone: string /* IANA */, weekStartsOn: 0|1 }, createdAt, updatedAt }

Page {
  id, parentId: string | null,          // null = top level of the sidebar
  kind: 'page' | 'database',            // 'database' = full-page database, see Database.pageId
  title: string, icon: string | null, cover: string | null,
  position: string, archivedAt: string | null,
  version: number,                      // bumped on every change, used for conflict checks
  createdAt, updatedAt
}

Block {
  id, pageId, parentId: string | null,  // parentId = a block (toggle children, nested list items)
  type: BlockType, position: string, content: BlockContent,
  createdAt, updatedAt
}
BlockType = 'paragraph' | 'heading_1' | 'heading_2' | 'heading_3'
          | 'bulleted_list_item' | 'numbered_list_item' | 'to_do' | 'toggle'
          | 'code' | 'quote' | 'divider' | 'image'
          | 'database_view'               // Phase 2 stretch: inline database
BlockContent by type:
  paragraph, heading_*, bulleted/numbered_list_item, toggle, quote: { rich: RichText[] }
  to_do:  { rich: RichText[], checked: boolean }
  code:   { text: string, language: string }
  image:  { url: string, caption: RichText[], width: number | null }
  divider: {}
  database_view: { databaseId, viewId }
RichText { text: string, marks?: ('bold'|'italic'|'underline'|'strike'|'code')[], href?: string,
           mention?: { type: 'page', pageId } | { type: 'date', date: string } }

Database { id, pageId /* its Page with kind 'database' */, title, titlePropertyId, createdAt, updatedAt }

Property {
  id, databaseId, name, position,
  type: 'title' | 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'checkbox' | 'url' | 'relation',
  config: {}                                         // title, text, checkbox, url, date
        | { format: 'number' | 'percent' | 'currency' } // number
        | { options: { id, name, color }[] }          // select, multi_select
        | { targetDatabaseId: string }                // relation (one-way in v0)
}

Row {                                    // a row is also a page body: it can hold blocks
  id, databaseId, position, title: string,
  properties: Record<propertyId, PropertyValue>,
  archivedAt, version, createdAt, updatedAt
}
PropertyValue by type:
  text: string | null      number: number | null      checkbox: boolean    url: string | null
  select: optionId | null  multi_select: optionId[]   relation: rowId[]
  date: DateValue | null
DateValue {
  start: string,           // 'YYYY-MM-DD' if allDay, else full ISO with offset
  end: string | null,      // same format as start; null = point in time / single day
  allDay: boolean,
  recurrence: string | null // RRULE subset, see 4.4 (decision D3)
}

View {
  id, databaseId, name, position,
  type: 'table' | 'board' | 'list' | 'gallery' | 'calendar',
  config: {
    filter?: Filter, sorts?: Sort[], visiblePropertyIds?: string[], propertyWidths?: Record<string, number>,
    groupByPropertyId?: string,          // board: select property
    coverPropertyId?: string | 'page_cover', // gallery
    datePropertyId?: string,             // calendar
    calendarMode?: 'month' | 'week' | 'day'
  }
}

Changeset {                              // the undo log; every mutation writes one
  id, source: 'user' | 'agent' | 'ai_inline', label: string,
  agentRunId: string | null, toolUseId: string | null,
  ops: Op[], inverse: Op[], createdAt, undoneAt: string | null
}
```

Rows are stored in the same `pages` table as pages (`kind = 'row'` internally) so a row can have a body and be searched, but they never appear in the sidebar. The API exposes them as `Row`.

### 4.2 Filters and sorts

```ts
Filter = { and: Filter[] } | { or: Filter[] } | { propertyId: string, op: FilterOp, value?: unknown }
FilterOp by property type:
  title, text, url: contains | not_contains | equals | starts_with | is_empty | is_not_empty
  number:          eq | neq | gt | gte | lt | lte | is_empty | is_not_empty
  select:          is | is_not | is_empty | is_not_empty
  multi_select:    contains | not_contains | is_empty | is_not_empty
  date:            on | before | after | on_or_before | on_or_after | between
                   | past_week | next_week | this_week | this_month | is_empty | is_not_empty
  checkbox:        is
  relation:        contains | not_contains | is_empty | is_not_empty
Sort = { propertyId: string | 'created_time' | 'updated_time', direction: 'asc' | 'desc' }
```

Relative date ops (`this_week` etc.) resolve in the workspace time zone on the server.

### 4.3 REST API

**Mock login (user decision D2).** Imitation only: no user table, no password check, no real auth. `POST /api/session` accepts any name (and any password), creates `MockUser { id, name, initials, color }` derived from the name, keeps it in server memory, and sets an `fsid` HttpOnly cookie. Every `/api` route except `health` and `session` returns 401 without that cookie; the web app shows the login screen on 401. A server restart logs everyone out. The user's name appears in the UI and is passed to the agent as context. Workspace data stays in the one local SQLite file and is shared by every mock user.

Prefix `/api`, JSON bodies. Errors: `{ error: { code: string, message: string, details?: unknown } }` with HTTP 400 (validation), 404, 409 (version conflict or undo conflict), 500. Mutations that need conflict checks take `version` and return 409 with the current entity when it is stale.

| Method and path | Request | Response |
|---|---|---|
| `GET /api/health` | | `{ ok: true, contractVersion, agentKeyConfigured: boolean }` |
| `POST /api/session` | `{ name: string, password?: string }` (any password accepted) | `{ user: MockUser }` + `fsid` cookie |
| `GET /api/session` | | `{ user: MockUser }` or 401 |
| `DELETE /api/session` | | `{}` (logout) |
| `GET /api/workspace` | | `Workspace` |
| `PATCH /api/workspace` | `{ name?, settings? }` | `Workspace` |
| `GET /api/pages` | `?includeArchived=bool` | `{ pages: Page[] }` flat list, client builds the tree (excludes rows) |
| `POST /api/pages` | `{ title?, parentId?, afterId?, icon? }` | `Page` |
| `GET /api/pages/:id` | | `{ page: Page, blocks: Block[] }` blocks flat, ordered by parent then position |
| `PATCH /api/pages/:id` | `{ version, title?, icon?, cover?, parentId?, position? }` | `Page` |
| `POST /api/pages/:id/archive` / `restore` | | `Page` (archive cascades to children) |
| `POST /api/pages/:id/ops` | `{ ops: BlockOp[], label? }` | `{ changesetId, page: Page, blocks: Block[] /* touched */ }` all-or-nothing |
| `GET /api/search` | `?q=&limit=20` | `{ results: { kind: 'page'\|'row', id, pageId, title, snippet, blockId? }[] }` |
| `POST /api/uploads` | multipart `file` (images, max 10 MB) | `{ id, url }`; served at `GET /uploads/:id` |
| `POST /api/databases` | `{ title, parentId?, properties? }` | `{ database, page, properties, views }` (creates default table view) |
| `GET /api/databases` | | `{ databases: Database[] }` |
| `GET /api/databases/:id` | | `{ database, properties: Property[], views: View[] }` |
| `PATCH /api/databases/:id` | `{ title? }` | `Database` |
| `POST /api/databases/:id/properties` | `{ name, type, config?, afterId? }` | `Property` |
| `PATCH /api/properties/:id` | `{ name?, config?, position? }` (type change: v1) | `Property` |
| `DELETE /api/properties/:id` | | `{ changesetId }` |
| `POST /api/databases/:id/query` | `{ filter?, sorts?, cursor?, limit? (≤200), viewId? }` | `{ rows: Row[], nextCursor: string \| null }` |
| `POST /api/databases/:id/rows` | `{ title?, properties?, afterId? }` | `Row` |
| `GET /api/rows/:id` | | `{ row: Row, blocks: Block[] }` |
| `PATCH /api/rows/:id` | `{ version, title?, properties?: Partial<Record<propertyId, PropertyValue>>, position? }` | `Row` |
| `POST /api/rows/:id/archive` / `restore` | | `Row` |
| `POST /api/databases/:id/views` | `{ name, type, config? }` | `View` |
| `PATCH /api/views/:id` / `DELETE /api/views/:id` | `{ name?, config?, position? }` | `View` / `{}` |
| `GET /api/calendar/events` | `?from&to` (ISO) `&databaseIds=a,b` | `{ events: EventOccurrence[] }` |
| `GET /api/changesets` | `?limit&source&agentRunId` | `{ changesets: Changeset[] }` |
| `POST /api/changesets/:id/undo` | | `{ undoChangesetId }` or 409 `{ conflicts: { entity, id }[] }` |

Block ops for `POST /api/pages/:id/ops` (also used for row bodies via the row id):

```ts
BlockOp =
  | { op: 'insert', block: { id, type, parentId: string | null, position: string, content } }
  | { op: 'update', id, type?, content? }          // content replaces the whole content object
  | { op: 'move',   id, parentId: string | null, position: string }
  | { op: 'delete', id }                           // removes the block and its children; undoable
```

Autosave: the client batches edits and sends one ops call per page at most every 500 ms. Blocks are last-writer-wins per block in v0 (single user); `Page.version` guards title/parent changes only.

Calendar: rescheduling is just `PATCH /api/rows/:id` on the date property, so table, board and calendar always agree.

```ts
EventOccurrence {
  rowId, databaseId, datePropertyId, title,
  start: string, end: string | null, allDay: boolean,
  recurring: boolean, occurrenceStart: string  // differs from start for expanded recurrences
}
```

Every database that has at least one date property can feed the calendar. The workspace seeds one database named **Calendar** (properties: Name, Date, Tags, Notes) as the default target for new events.

### 4.4 Recurrence (decision D3: accepted by the user)

`DateValue.recurrence` holds an RRULE subset (`FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL`, `BYDAY`, `COUNT`, `UNTIL`). The row appears once in tables (showing its first date and a "repeats" marker) and the server expands occurrences inside `/api/calendar/events`. Dragging one occurrence moves the whole series in v0; per-occurrence exceptions are later.

### 4.5 Agent API (Phase 4)

| Method and path | Request | Response |
|---|---|---|
| `GET /api/agent/profiles` | | `{ profiles: AgentProfile[], defaultProfileId }` |
| `PATCH /api/agent/profiles/default` | `{ profileId }` | `{ defaultProfileId }` |
| `POST /api/agent/conversations` | `{ title?, profileId? }` | `{ id, title, profileId, createdAt }` |
| `PATCH /api/agent/conversations/:id` | `{ title?, profileId? }` (switch agent mid-conversation) | conversation |
| `GET /api/agent/conversations` | | `{ conversations: [...] }` |
| `GET /api/agent/conversations/:id` | | `{ conversation, items: AgentTranscriptItem[] }` |
| `POST /api/agent/conversations/:id/messages` | `{ text, context: { pageId?, selectedBlockIds?, now, timeZone } }` | **SSE stream** (below) |
| `POST /api/agent/runs/:runId/cancel` | | `{}` |
| `POST /api/agent/runs/:runId/undo` | | `{ undoneChangesetIds }` or 409 with conflicts |
| `POST /api/ai/inline` | `{ action: 'write' \| 'continue' \| 'summarize' \| 'rewrite' \| 'shorter' \| 'longer' \| 'fix_grammar' \| 'custom', pageId, blockIds?, text?, instruction? }` | **SSE stream** of text |

SSE events (`event:` name, JSON `data:`):

```ts
'run.started'    { runId, profileId, model }
'text.delta'     { text }
'tool.started'   { toolUseId, name, input }
'tool.finished'  { toolUseId, ok: boolean, summary: string, changesetId: string | null,
                   affected: { pageIds: string[], rowIds: string[], databaseIds: string[] } }
'run.finished'   { runId, stopReason, changesetIds: string[], usage: { inputTokens, outputTokens } }
'error'          { code, message }
```

The client refetches whatever `affected` lists, so the editor, tables and calendar update after agent actions. Inline AI only streams text; the client inserts it as a preview, and on accept writes it through the normal ops endpoint with `label: 'AI: <action>'`, so it is undoable like any edit.

### 4.6 Agent tools (proposal)

Design rules:
- Tools refer to properties by **name** (case-insensitive); the server resolves names to ids and returns the valid names in the error when one does not match.
- Page content goes in and out as **Markdown** (headings, lists, `- [ ]` to-dos, `>` quotes, fenced code, `---`, images, and `<details>` for toggles). The server converts Markdown to blocks and back. This is easier for the model than block JSON.
- Every mutating tool writes exactly one changeset tagged with the run and tool-use id, so each tool call has its own undo button. Deletes are soft (archive), so they are undoable.
- Tool errors go back to the model as `is_error` results; they never crash the run.

| Tool | Input schema | Mutates |
|---|---|---|
| `search_workspace` | `{ query: string, limit?: int ≤ 20 }` | no |
| `list_pages` | `{ parentId?: string \| null, depth?: int ≤ 3 }` | no |
| `get_page` | `{ pageId: string }` → title, path, Markdown body with block ids | no |
| `create_page` | `{ title: string, parentId?: string, icon?: string, markdown?: string }` | yes |
| `update_page` | `{ pageId: string, title?: string, icon?: string, parentId?: string \| null }` | yes |
| `archive_page` | `{ pageId: string }` | yes |
| `append_blocks` | `{ pageId: string, markdown: string, afterBlockId?: string, parentBlockId?: string }` | yes |
| `update_block` | `{ blockId: string, markdown: string }` (one block; type may change) | yes |
| `delete_blocks` | `{ blockIds: string[] (≤ 50) }` | yes |
| `list_databases` | `{}` → id, title, property names and types | no |
| `get_database` | `{ databaseId: string }` → properties, select options, views | no |
| `query_database` | `{ databaseId: string, filter?: Filter (by property name), sorts?: Sort[], limit?: int ≤ 100 }` | no |
| `create_row` | `{ databaseId: string, title: string, properties?: Record<name, value> }` | yes |
| `update_row` | `{ rowId: string, title?: string, properties?: Record<name, value> }` | yes |
| `archive_row` | `{ rowId: string }` | yes |
| `list_events` | `{ from: string, to: string, databaseIds?: string[] }` | no |
| `create_event` | `{ title: string, start: string, end?: string, allDay?: boolean, recurrence?: string, databaseId?: string /* default Calendar */, properties?: Record<name, value>, notes?: string }` | yes |
| `move_event` | `{ rowId: string, start: string, end?: string, allDay?: boolean }` | yes |
| `delete_event` | `{ rowId: string }` (archives) | yes |

Value formats for `properties` by name: text/url `string`, number `number`, checkbox `boolean`, select `option name` (created if missing, flagged in the result), multi-select `string[]`, date `{ start, end?, allDay?, recurrence? }`, relation `string[]` of row ids or titles.

Agent switching (user decision D5). The user brings their own API key: it goes in the root `.env` as `ANTHROPIC_API_KEY` and nowhere else. The app can switch between **agent profiles**:

```ts
AgentProfile {
  id, name, description,
  provider: 'anthropic',              // field kept so other providers can be added later
  model: string,                      // e.g. 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'
  effort: 'low' | 'medium' | 'high',
  instructions: string | null,        // extra system instructions on top of the base prompt
  tools: 'all' | 'read_only'          // read_only hides every mutating tool
}
```

Built-in profiles live in `src/server/src/agent/profiles.ts` (for example "Opus, full access", "Sonnet, full access", "Haiku, read only"). Extra profiles can be added in `agent-profiles.json` at the repo root (optional, gitignored). The agent panel shows a profile picker; the choice is stored per conversation, and the default is stored in workspace settings. Inline `/ai` uses the default profile. If `ANTHROPIC_API_KEY` is empty, `/api/health` reports `agentKeyConfigured: false` and the panel shows "Add your key to .env" instead of failing.

Model call design (server side, Claude's area):
- Model and effort come from the selected profile. Adaptive thinking; effort always set explicitly (`low` for inline AI).
- Streaming Messages API with a manual tool loop, so each tool call can be wrapped in its own changeset and streamed as SSE. Iteration cap (default 15 tool rounds) and cancel support.
- No forced `tool_choice` (not supported on current models); `strict: true` tool schemas, with server-side validation of every input before it runs.
- Prompt caching: tools and the system prompt are fixed and come first; per-turn context (now, time zone, current page, selection) goes in a message after the cached prefix, so the cache stays warm.
- Server-side refusal fallback enabled (`fallbacks: "default"`), and `stop_reason` is checked before tools run.
- The API key is read from `ANTHROPIC_API_KEY` on the server only. A test asserts that no API response and no built web asset contains it.
- A fake-model mode (`AGENT_FAKE=1`) replays scripted model turns, so tests and Codex's e2e runs need no key and cost nothing.

## 5. Milestones, owners, acceptance checks

Each milestone ends with a pull request to `main` per agent, reviewed by the coordinator (Claude in this session) and merged only with the user's approval.

### M0. Scaffold and contract (both)

| Who | Work |
|---|---|
| Claude | Root workspace (`package.json`, `tsconfig.base.json`, lint/format), `src/shared` with contract v0 schemas, `src/server` skeleton with `/api/health` and mock-login `/api/session` routes plus the 401 guard, SQLite + migrations, seed script, `.env` loading, `tests/server` and `tests/contract` set up |
| Codex | `src/web` skeleton (Vite + React + TS) with `src/web/index.html` as the app entry, mock login screen (name + password field, any value accepted) and logout, app shell (sidebar, main area, right panel slot), typed API client over `@fortnight/shared`, `tests/web` and `tests/e2e` set up |

Accept when: `npm install` and `npm run dev` start both apps on a clean checkout; opening the app shows the login screen, any name logs in, the shell shows the user's name and the health status, logout returns to login, and API calls without the cookie get 401; `npm run typecheck`, `npm run lint` and `npm test` pass in every workspace; contract v1 is marked accepted in both task records.

### Phase 1. Core

| Milestone | Owner | Acceptance checks |
|---|---|---|
| M1.1 Pages, blocks, ops, search, uploads, undo log | Claude | Integration tests: nested page create, move and reorder; archive cascades and restore brings children back; an ops batch with one invalid op changes nothing; positions stay ordered after 1,000 random inserts; stale `version` returns 409; search finds a word right after it is saved, ranks title matches first and returns a snippet; image upload round-trips and rejects non-images and files over 10 MB; undoing a changeset restores the exact prior state |
| M1.2 Sidebar and block editor | Codex | Create, rename, nest and drag-reorder pages in the sidebar; all 12 block types can be created from the "/" menu, which filters as you type and works by keyboard; Markdown shortcuts (`#`, `-`, `1.`, `[]`, `>`, ```` ``` ````, `---`); drag handle reorders blocks, including into and out of toggles; autosave within 1 s with a saved/saving indicator, and content survives reload; Ctrl+K search opens the result; images can be pasted or uploaded |
| M1.3 Integration | Both | Playwright: create a nested page, type every block type, reorder, reload, find it by search. Runs green in CI mode |

### Phase 2. Databases

| Milestone | Owner | Acceptance checks |
|---|---|---|
| M2.1 Databases, properties, rows, views, query | Claude | Every property type rejects invalid values with a clear error; at least one test per filter op and sort direction; nested and/or filters; renaming a select option keeps row values; deleting a property or row is undoable; relation values drop archived targets in reads; querying 5,000 rows with a filter and sort takes under 100 ms on a dev machine |
| M2.2 Table, board, list, gallery | Codex | Table: inline cell editing for every type, add/rename/reorder/resize properties; board: group by select, drag between columns updates the property; list and gallery render with chosen properties and cover; filter and sort UI is saved per view; any row opens as a page with its body editor |
| M2.3 Integration | Both | Playwright: build a task database, add each property type, switch views, filter and sort, reload, state persists |

### Phase 3. Calendar

| Milestone | Owner | Acceptance checks |
|---|---|---|
| M3.1 Calendar API | Claude | Seeded Calendar database; range query returns timed, all-day, multi-day and recurring events correctly, including across a DST change in the workspace time zone; recurrence expansion respects `COUNT`/`UNTIL`; reschedule through `PATCH /rows/:id` shows up in the next range query |
| M3.2 Month, week, day views | Codex | Switch modes and navigate dates; click or drag-select to create; drag to move and edge-drag to resize timed events; all-day lane; a rescheduled event shows the new date in the table view without reload; works with any database that has a date property |
| M3.3 Integration | Both | Playwright: create an event in week view, drag it to another day, check the table view shows the new date |

### Phase 4. Claude agent

| Milestone | Owner | Acceptance checks |
|---|---|---|
| M4.1 Agent backend | Claude | Unit test per tool against a temporary database; fake-model scripts cover "schedule a 1h review every Friday", "summarize this page" and "what's on my week?" end to end over SSE; undoing a run restores the exact prior state (snapshot compare); invalid tool inputs return `is_error` and the run continues; iteration cap and cancel work; the API key never appears in responses, logs or web build output; inline endpoint streams for every action; each built-in profile sends its own model and effort; a `read_only` profile cannot call mutating tools; switching profile mid-conversation takes effect on the next message; an empty key gives a clear "add your key" error, not a crash |
| M4.2 Agent panel and inline AI | Codex | Profile picker in the panel (name, model, read-only badge) with a "set as default" option; "Add your key to .env" notice when the key is missing; chat panel streams text; each tool call shows as a card with its input, result summary and undo button, plus "Undo all" for the run; the current page is sent as context; affected pages, tables and calendar refresh; `/ai` menu in the editor previews output with accept and discard; accepted text is undoable |
| M4.3 Evaluation | Claude | A small manual eval (about 15 prompts across pages, databases and calendar) against the real model, with a cost estimate shown before running; results recorded in `docs/` |

### Later (not scheduled)

Templates, export (Markdown/HTML/PDF) and share links, real-time collaboration (needs CRDTs in the editor and the ops log, which the ops design above leaves room for), dark mode, mobile layout, two-way relations, rollups and formulas, per-occurrence recurrence exceptions.

## 6. Working agreement between agents

1. Each agent works only in its own worktree and branch: `claude/<task>` and `codex/<task>`.
2. Before a milestone starts, both records list its files and any contract changes it needs. A contract change is a "pending" entry until both records accept it.
3. Each agent pushes its branch and opens a PR to `main`. The coordinator reviews both and reports to the user; the user approves each merge.
4. Integration order per phase: Claude's backend PR merges first (it has contract tests), then Codex's frontend PR is rebased on it.
5. If one side is blocked on the other, it codes against the contract with mocks (Codex can use the fake-model mode and a seeded DB) instead of waiting.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Editor library's document model differs from ours | Our block JSON is the storage format; Codex maps to and from it in one adapter module with round-trip tests |
| Undo conflicts after later edits | Undo checks that touched entities have not changed since; otherwise 409 with a list, and the UI explains it |
| Agent cost while experimenting | Fake-model mode for all automated tests; model and effort chosen per agent profile in the app; usage returned on every run |
| Async coordination across machines | All decisions live in Git records; nothing depends on chat memory |

## 8. Open questions for Codex

1. Editor library choice, and whether our block JSON format works for it.
2. Do you want to own `tests/e2e` (proposed), or split it?
3. Any objection to `src/shared` being kept by Claude with changes agreed in both records?
4. Calendar UI: build it or use a library (for example FullCalendar)? Affects nothing in the contract.

## 9. User decisions (made 2026-11-11)

- **D1. Ownership split: accepted.** Codex owns the frontend; Claude owns backend, storage, contract and agent.
- **D2. Mock login.** An imitation login with no real auth and no user database (section 4.3). Local, single workspace.
- **D3. Recurring events: proposal accepted.** RRULE on one row, expanded in the calendar (section 4.4).
- **D4. Root `index.html`: removed** in commit on `claude/notion-plan`. This overrides the `AGENTS.md` line that keeps it; the app entry becomes `src/web/index.html` in M0. Codex should update `AGENTS.md` (its file) to match.
- **D5. Agent.** The user supplies their own API key in the root `.env` (`.env.example` committed; `.env` gitignored). The app gets an in-app agent switcher based on agent profiles (section 4.6).
- `.gitignore`: edited by Claude with the user's authorization to add `.env`, `node_modules/`, `data/`, `dist/` and `agent-profiles.json`. Codex created this file; noted here so Codex sees it.

## 10. Contract changelog

| Version | Change | Status |
|---|---|---|
| v0 | Initial proposal (this document) | Pending Codex review |
| v0.1 | Mock login routes and 401 guard; `agentKeyConfigured` in health; agent profiles and profile routes; recurrence accepted | User decisions applied; contract still pending Codex review |
