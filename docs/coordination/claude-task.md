# Claude task

## Status
- task: C-004
- revision: 1
- state: working
- branch: claude/c-004-agent-build
- commit: -
- updated: 2026-11-11T18:14:27+05:00
- note: Agent routes and fake-model mode work and are pushed for Codex (profiles, conversations, SSE messages, cancel, run undo, inline AI; AGENT_FAKE=1). Next: agent tests, production build check, README.

## Role and ownership (accepted by the user and Codex)

- Role: backend builder. Builds backend, storage, contract and agent. Follows `docs/coordination/PROTOCOL.md`.
- Claude owns: root workspace config (`package.json`, `package-lock.json` changes for its packages, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitattributes`, `scripts/`, `.env.example`), `src/shared/**` (contract keeper), `src/server/**`, `tests/server/**`, `tests/contract/**`, this record.
- Codex owns: `src/web/**`, `tests/web/**`, `tests/e2e/**`, `docs/coordination/codex-task.md`, `AGENTS.md`.
- Coordinator owns: `PROTOCOL.md`, `backlog.md`, `plan.md`, `inbox/*`.

## C-003: databases, properties, rows, views, query, calendar (M2.1 + M3.1)

- Routes: `GET/POST /api/databases`, `GET/PATCH /api/databases/:id`, `POST /api/databases/:id/properties`, `PATCH/DELETE /api/properties/:id`, `POST /api/databases/:id/query`, `POST /api/databases/:id/rows`, `GET/PATCH /api/rows/:id`, `POST /api/rows/:id/{archive,restore,ops}`, `POST /api/databases/:id/views`, `PATCH/DELETE /api/views/:id`, `GET /api/calendar/events`. Every mutation writes one changeset (undoable).
- Decisions: new rows and properties without `afterId` go last (`afterId: null` = first). Values are checked per type with messages naming the property; URLs must be http(s) or mailto. Reads drop values of deleted properties, removed select options and archived/missing relation targets. Deleting a property strips its values from rows in the same changeset. Renaming a database page renames the database (and back).
- Query: filters and sorts run in memory over live rows (5,000 rows: well under 100 ms). Text ops are case-insensitive; date ops compare local dates in the workspace zone; `past_week` = [today-7, today], `next_week` = [today, today+7], `this_week` uses `weekStartsOn`. Empty values sort last both ways. A view's filter is ANDed with the request filter (conditions on deleted properties are dropped); request sorts replace view sorts. Cursor = opaque offset.
- Calendar: `services/recurrence.ts` + `services/tz.ts` (Intl only). Wall-clock time kept across DST; DST gaps move forward, overlaps take the earlier instant. COUNT counts from the first occurrence; UNTIL inclusive. Each database uses its first date property.
- Tests: `tests/server/databases.test.ts` (invalid values for every type, every filter op, and/or, sorts, cursor, views, option rename, relation drops, undo of property delete and row archive, 5,000-row timing, row bodies), `tests/server/calendar.test.ts` (DST gap/overlap, weekly across DST, COUNT, UNTIL, BYDAY+INTERVAL, MONTHLY skip, all-day overlap in UTC+5, point events, seeded range, reschedule).
- Contract requests: none.

## C-002: M1.1 pages, blocks, ops, search, uploads, undo log

### Routes (all behind the session guard, shapes from contract v1)

- `GET /api/workspace`, `PATCH /api/workspace` (name; settings merged, e.g. only `timeZone`).
- `GET /api/pages?includeArchived=`, `POST /api/pages`, `GET /api/pages/:id`, `PATCH /api/pages/:id`, `POST /api/pages/:id/archive`, `POST /api/pages/:id/restore`, `POST /api/pages/:id/ops`.
- `GET /api/search?q=&limit=`.
- `POST /api/uploads` (multipart field `file`), `GET /uploads/:id`.
- `GET /api/changesets?limit=&source=&agentRunId=`, `POST /api/changesets/:id/undo`.
- Not in C-002 (they belong to C-003 with the rest of rows): `GET /api/rows/:id` and `POST /api/rows/:id/ops`. The ops engine is shared, so they are thin wrappers there.

### Behavior decisions (inside the contract; recorded for Codex and the coordinator)

1. **Page ordering**: `POST /api/pages` without `afterId` inserts as the FIRST sibling (contract: "null or missing = first"). To append, send `afterId` = the last sibling. Moving to a new parent without `position` appends at the end.
2. **Page version** is bumped by title/icon/cover/parent/position changes, archive and restore. Block ops do not bump it (blocks are last-writer-wins); they update `page.updatedAt`, and the ops response returns the current page.
3. **Archive** sets the same `archivedAt` on the page and every not-yet-archived descendant; **restore** clears exactly that set, so a child archived earlier stays archived. Restoring a page whose parent is still archived (or gone) moves it to the top level, at the end. Archiving an archived page or restoring a live one is a no-op 200. Database pages are archived with their parent; database rows are not pages and are not touched.
4. **Ops validation** stops at the first bad op with 400 `validation_error`, `details.issues[0].path` like `['ops', 3, 'block', 'parentId']`. Checks: unknown block on this page, parent not on this page, id already used (on any page), move under itself or a descendant, invalid fractional position (e.g. `a00`), type/content mismatch (schema). Ops on a row id or unknown page are 404.
5. **Undo**: the conflict check compares every touched entity with the state the changeset left (ignoring page/row `version`); on conflict 409 with `{ conflicts }` and nothing changes. Undo restores the exact prior stored rows, except page/row `version`, which keeps counting up so clients with the old version get a 409. Undo writes its own changeset (`Undo: <label>`), so undoing an undo is a redo. Undoing twice is 409 `undo_conflict` with `conflicts: []`. Every mutation in C-002 writes exactly one changeset; uploads write none (files are not workspace state).
6. **Search** (FTS5 confirmed in Node 22.23's `node:sqlite`, SQLite 3.53.4): migration `0002` replaces the C-001 table with one row per title and one per block. Every word must match (prefix match, so results appear while typing); accents and case are ignored (`Café` matches `cafe`); FTS syntax in the query is neutralized. Title matches rank first, then bm25 with title weight 10 and body weight 1; one result per page or row. `snippet` is plain text (no highlight markers); `blockId` is the matching block, or null for a title match. Archived pages and rows are not indexed. The index is updated in the same transaction as each change, rebuilt by the seed, and rebuilt on server start when empty.
7. **Uploads**: the type comes from the file's first bytes (PNG, JPEG, GIF, WebP); the client's content type is ignored, so an SVG renamed `.png` is 415. Over 10 MB is 413 `payload_too_large`. A missing `file` field is 400; a JSON body is 415. `GET /uploads/:id` needs the session cookie (browsers send it with same-origin `<img>` requests) and returns the stored content type with `X-Content-Type-Options: nosniff` and long private caching; malformed ids are 400 and unknown ids 404.
8. **Markdown converter** (`src/server/src/markdown/markdown.ts`, exported from `@fortnight/server`): `markdownToNodes`, `nodesToMarkdown`, `blocksToMarkdown`, `blocksToTree`, `markdownToRich`, `richToMarkdown`, `normalizeRich`. Uses `marked`'s lexer (pure JS). Forms: headings, paragraphs, `- `, `1. `, `- [ ]` / `- [x]`, `> `, fenced code with language, `---`, `![caption](url)` (or `<img src alt width>` when a width is set), toggles as `<details><summary>`, inline databases as `<!-- database_view {...} -->`, inline `**`, `*`, `~~`, code spans, `<u>`, links, mentions as `[text](fortnight:page/<id>)` and `[text](fortnight:date/<date>)`, line breaks as `<br>`. Lossy by design: leading/trailing spaces of a block, image caption formatting, and children of blocks Markdown cannot nest (they follow their parent). C-005's agent tools use it.

### Files

- New: `src/server/src/store/{entities,changes,mappers}.ts` (generic stored rows, `ChangeRecorder`, mappers), `src/server/src/services/{pages,ops,search,undo}.ts`, `src/server/src/routes/{pages,search-changesets,uploads}.ts`, `src/server/src/markdown/markdown.ts`, `src/server/drizzle/0002_search_blocks.sql`.
- Changed: `app.ts` (routes, multipart, guard also on `/uploads/`), `db/seed.ts` (rebuilds the search index), `main.ts` (rebuilds an empty index), `index.ts` (exports).
- New dependencies (pure JavaScript, no install scripts): `@fastify/multipart@10.1.8`, `marked@18.2.0`.
- Tests: `tests/server/{pages,ops-undo,search-uploads,markdown}.test.ts` and `api-helpers.ts`; `db-seed.test.ts` updated for the new search columns.

### M1.1 acceptance checks and their tests

| Check | Test |
|---|---|
| Nested page create, move and reorder | `pages.test.ts`: nested create, `afterId` order, move and reorder, cycles rejected |
| Archive cascades, restore brings children back | `pages.test.ts`: archive/restore, incl. a separately archived child and an archived parent |
| An ops batch with one invalid op changes nothing | `ops-undo.test.ts`: 6 invalid batches; DB snapshot and changeset count unchanged |
| Positions ordered after 1,000 random inserts | `ops-undo.test.ts`: 1,000 random inserts in 4 batches through the API; order matches |
| Stale `version` returns 409 | `pages.test.ts`: 409 `version_conflict` with the current page; `ops-undo.test.ts`: stale version after undo |
| Search finds a word right after saving, title first, snippet | `search-uploads.test.ts`: immediate hit with snippet and block id; title first; prefixes, accents, renames, archive, seeded rows |
| Image upload round-trips, rejects non-images and files over 10 MB | `search-uploads.test.ts`: byte-equal download, sniffed type, 415, 413, 401, 404 and 400 |
| Undo restores the exact prior state | `ops-undo.test.ts`: snapshot compare (pages, blocks, workspace, search index; page version excluded by design) for ops, and for edit + move + archive; redo; conflict; double undo |
| Markdown and blocks round trip | `markdown.test.ts`: every form, inline marks and special characters, the seeded page with all 13 block types, 1,000 random documents |

### Checks run (on `29845f0`, based on main `8e65ad0`)

- Worktree: `npm run typecheck` pass, `npm run lint` pass, `npm test` **12 files, 319 tests passed**, `npm run format:check` pass, `git diff --check` clean.
- Fresh clone from GitHub at `29845f0`: `npm ci` exit 0 ("added 218 packages", no gyp step, no build tools on this machine), typecheck pass, lint pass, 319 tests pass.
- Live (`DATA_DIR=<tmp> PORT=3019 npm run dev`, then curl): seeded pages listed; created a page; ops inserted a paragraph; search found it at once with snippet and block id; PNG upload 200 and `GET /uploads/:id` 200 `image/png`; undoing the ops changeset made search stop finding the word.

### Rebase onto main `6f04bb4` (after X-001 merge)

- Rebased all C-002 commits onto `origin/main` `6f04bb4`. The only conflict was `package-lock.json`: resolved by taking main's lockfile (the Windows regeneration from `32c466e`) and running `npm install`. The resulting lockfile diff against main is limited to my packages: `src/server` dependency list, plus new `@fastify/multipart@10.1.8`, `@fastify/busboy@3.2.5` (its dependency) and `marked@18.2.0`. No entries were dropped (checked by comparing every `packages` entry with main's lockfile).
- Checks after the rebase, on `0b5d310`: `npm run typecheck` pass (server, shared, web); `npm run lint` pass (server, shared, web); `npm test`: server 12 files / 319 tests pass, web 2 files / 12 tests pass; `npm run format:check` pass; `git diff --check origin/main HEAD` clean; `npm run e2e` (Codex's Playwright suite against the real server): 2 passed.

### Known limitations

- Row bodies (`/api/rows/:id`, `/api/rows/:id/ops`) come with C-003.
- Search snippets have no highlight markers (the contract says plain text); the UI can highlight the query words itself.
- The server uses one SQLite connection with synchronous transactions, so requests are serialized. Fine for the single-user app.

### Contract requests

- None. Everything above fits contract v1.

## C-001: M0 backend scaffold and contract v1

### Revision 2 (review of `85d83a9`)

1. **Clean install without build tools (blocking).** Cause: `better-sqlite3@13` ships `binding.gyp`, and npm 10.9.9 runs its default `node-gyp rebuild` install step for it despite `gypfile: false` and the bundled `prebuilds/`, so `npm ci` needs Visual Studio. My worktree only passed because it was installed incrementally.
   - Fix: removed `better-sqlite3` entirely. The server uses **Node's built-in `node:sqlite`** (SQLite 3.53 with FTS5, part of Node, nothing to install or compile) through `src/server/src/db/sqlite.ts`, a ~150-line adapter that implements the part of the better-sqlite3 API that Drizzle's synchronous session uses (`prepare`, `run`/`all`/`get`, `raw()`, `transaction()` with savepoints), plus `pragma`, `exec`, `close`. `db/client.ts` builds the Drizzle database from `drizzle-orm/better-sqlite3/session` and `drizzle-orm/sqlite-core`, because `drizzle-orm/better-sqlite3` (the driver entry) imports the native package when it loads. Drizzle queries, transactions and the migrator are unchanged; only `@types/better-sqlite3` (types only) stays.
   - Alternatives rejected: `@libsql/client` (pooled connections lose per-connection `PRAGMA foreign_keys`, and with one connection a request during an open transaction fails instead of waiting); the synchronous `libsql` package (rows carry an extra `_metadata` field, `pragma` returns objects, older SQLite 3.45); Drizzle's own `node-sqlite` driver (only in 1.0 release candidates).
   - Node's one-time "SQLite is an experimental feature" warning is filtered at load (test asserts it is not printed). Root `engines.node` is now `>=22.16.0 <23` (`StatementSync#setReturnArrays`); the adapter throws a clear error on older Node.
   - Lockfile regenerated with npm (not hand-edited): the only changes are `better-sqlite3` and `node-addon-api` removed. Remaining install scripts in the lockfile are esbuild's (checks its prebuilt platform binary from optional dependencies, no compiler) and fsevents (macOS only).
   - New `tests/server/sqlite-adapter.test.ts` (10 tests): commit, rollback, nested savepoint rollback, client-level savepoints, async function rejected, raw arrays and plain-object rows, JSON columns and selected fields, foreign keys enforced, no ExperimentalWarning printed, `better-sqlite3` neither a dependency nor resolvable.
2. **Status times**: taken from `date -Iseconds` from now on.

**Clean-install proof** (fresh clone from GitHub at `2bf33f5`, this machine has no Visual Studio / C++ build tools):

```
$ git clone --branch claude/c-001-m0-scaffold https://github.com/sulaymoniy/ubiquitous-fortnight.git clean2
$ git rev-parse HEAD            -> 2bf33f54f2167e7ae0b02e253e5c904245b18550
$ node -v; npm -v               -> v22.23.4, 10.9.9
$ npm config get ignore-scripts -> false
$ where cl.exe msbuild.exe      -> INFO: Could not find files for the given pattern(s).
$ npm ci                        -> added 215 packages, and audited 218 packages in 9s; exit code 0; no gyp output
$ npm run typecheck             -> PASS
$ npm run lint                  -> PASS
$ npm test                      -> Test Files 8 passed (8); Tests 275 passed (275)
$ DATA_DIR=<tmp> npm run seed   -> "Seeded a new workspace in <tmp>ortnight.db"
$ DATA_DIR=<tmp> npm run seed   -> "Seed data already present in <tmp>ortnight.db; nothing changed"
$ DATA_DIR=<tmp> PORT=3018 npm run dev, then curl:
    GET /api/health                -> {"ok":true,"contractVersion":"1.0.0","agentKeyConfigured":false}
    GET /api/workspace (no cookie) -> 401
    POST /api/session              -> {"user":{"name":"Clean Install","initials":"CI",...}}
    GET /api/session (cookie)      -> 200
    dev log: no ExperimentalWarning, no gyp
```

### How Codex consumes `@fortnight/shared`

- Package: `@fortnight/shared` (workspace `src/shared`). Add `"@fortnight/shared": "*"` to `src/web/package.json` `dependencies`; `npm install` at the repo root links it.
- Import everything from the package root: `import { Page, PageOpsResponse, CONTRACT_VERSION, type Block } from '@fortnight/shared'`. Schemas and types share names (`Page` is both the Zod schema and the inferred type). There are no subpath imports.
- The package ships TypeScript source (`exports: { ".": "./src/index.ts" }`); there is no build step. Internal imports use `.ts` extensions.
- Vite: works as is (Vite transpiles TS from linked workspace packages). If the dev server complains, add `optimizeDeps: { exclude: ['@fortnight/shared'] }`.
- tsconfig for `src/web`: extend `../../tsconfig.base.json` and override for the browser, for example `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"jsx": "react-jsx"`, `"types": ["vite/client"]`. Keep `allowImportingTsExtensions` and `noEmit` (already in the base). The base sets `"types": []`, so list the types you need.
- Runtime parsing: `Schema.parse(json)` on responses, or `safeParse` to show contract errors. Zod is 4.x (`zod@4.6.7`).
- Root scripts run `--workspaces --if-present`, so `src/web` only needs its own `dev`, `build`, `typecheck`, `lint`, `test` and `e2e` scripts. `npm run dev` at the root runs every workspace's `dev` in parallel (`scripts/run-parallel.mjs`). Root devDependencies already include `typescript@6.0.3`, `vite@8.3.8`, `vitest@5.1.0`, ESLint 10 and Prettier; the shared `eslint.config.js` already has browser globals for `src/web/**` and `tests/web/**`.

### Contract v1 precision decisions (for `plan.md` section 10, v1 row; accepted by the coordinator)

All are refinements inside the accepted v0.1 design:

1. **Row-body ops have their own route.** `POST /api/rows/:id/ops` returns `RowOpsResponse { changesetId, row: Row, blocks, deletedBlockIds }`. `POST /api/pages/:id/ops` returns `PageOpsResponse { changesetId, page: Page, blocks, deletedBlockIds }` and 404s for row ids. A row is never parsed as a sidebar `Page`.
2. **Ops responses** list every inserted, updated or moved block in its final state (`blocks`) and every removed block id, including descendants (`deletedBlockIds`).
3. **`update` block op requires both `type` and `content`** (send the current type to keep it), so the pair is validated as one `{ type, content }` variant. v0.1 had both optional.
4. **409 details.** `version_conflict`: `details = { entity: 'page' | 'row', current }`. `undo_conflict`: `details = { conflicts: { entity, id }[] }` inside the standard error body (v0.1 put `conflicts` at the top level).
5. **Error codes** are a fixed list (`ERROR_CODES` in `common.ts`); 400 `validation_error` details are `{ in, issues: { path, message }[] }`.
6. **Calendar.** Range `[from, to)` with offsets, max 400 days. All-day `end` is exclusive; `end: null` = one day (all-day) or a point (timed). `EventOccurrence` keeps `start`/`end` as the row's series value and adds `occurrenceEnd` and `recurrence` next to `occurrenceStart`, plus `id = rowId:occurrenceStart`. Overlap rule, sort order and DST behavior are in the schema comments (`api.ts`, `model.ts`, `recurrence.ts`).
7. **Recurrence** is parsed by `parseRecurrence` in `@fortnight/shared`; `DateValue` rejects invalid rules. Wall-clock time is kept across DST; first occurrence is always `start`; MONTHLY skips months without the day.
8. **`Page.databaseId`** added (null for normal pages) so the sidebar can open a database page without another lookup.
9. **`SearchResult`** gains `databaseId` and uses `blockId: string | null` instead of optional.
10. **Changeset ops** are entity-level: `ChangeOp = { kind: 'put', entity, id, value } | { kind: 'remove', entity, id }`.
11. **Agent**: `run.started` includes `conversationId`; transcript items are typed (`AgentTranscriptItem`); `InlineAiRequest` needs `instruction` for `write` and `custom`; inline stream ends with `done` or `error`.
12. **Uploads** allow PNG, JPEG, GIF and WebP (no SVG, to avoid script injection), max 10 MB.

### Decisions and assumptions

- Node 22 was not installed on this machine. Installed the official Node 22.23.4 Windows zip from nodejs.org (SHA-256 checked against `SHASUMS256.txt`) into `%LOCALAPPDATA%\Programs\node-v22.23.4-win-x64`, user-local, no admin rights or system changes.
- TypeScript is pinned to 6.0.3, not 7.x, because `typescript-eslint@8.72.2` supports `<6.1`.
- `npm run dev` uses `scripts/run-parallel.mjs` instead of `--workspaces`, because `--workspaces` runs one workspace after another and a dev server never exits. It still needs no change when `src/web` is added.
- `.gitattributes` forces LF line endings so Prettier checks pass on Windows checkouts.
- `npm audit` reports 10 moderate advisories in dev tooling (minimatch via ESLint); none are in runtime server dependencies yet. Not fixed with `--force` because it would change major versions.

### What was built (commit `85d83a9`, on top of `ade8fd2`)

- **Root**: npm workspaces `src/*`; root scripts `dev` (parallel), `build`, `typecheck`, `lint`, `test`, `e2e`, `seed` run per workspace with `--if-present`; `format` / `format:check`. Exact versions everywhere. Node `>=22.16 <23` (revision 2).
- **`@fortnight/shared`** (`src/shared/src`): `common.ts` (ids, timestamps, positions, time zones, colors, error codes and shapes), `model.ts` (all entities, rich text, 13 block variants, 9 property variants, DateValue rules, views, EventOccurrence, changesets), `filters.ts`, `ops.ts`, `api.ts` (every REST request/response in plan 4.3), `agent.ts` (profiles, conversations, transcript items, SSE events, inline AI, all 19 tool input schemas), `recurrence.ts` (RRULE subset parser), `positions.ts` (fractional-index helpers). `CONTRACT_VERSION = "1.0.0"`.
- **`@fortnight/server`** (`src/server`):
  - `src/app.ts` `buildApp({ db, config })`: Fastify 5 with Zod validation and response serialization from the shared schemas; JSON only (other content types are 415); 1 MB body limit (uploads get their own limit in C-002).
  - Routes: `GET /api/health`, `POST/GET/DELETE /api/session`. Mock users are derived from the name (`mockUserFromName`), sessions in memory, cookie `fsid` HttpOnly, SameSite=Lax, path `/`.
  - 401 guard as an `onRequest` hook on `/api` and `/api/*` except `GET /api/health` and `/api/session`. Unknown `/api` routes are 401 without a session and 404 with one.
  - Errors: every non-2xx is `{ error: { code, message, details? } }`; 500s never include internals.
  - Database: `src/db/schema.ts` (13 tables incl. agent runs/items and the FTS5 `search_index`), migrations in `src/server/drizzle` (generated by `npm run db:generate -w @fortnight/server`, plus a custom FTS5 migration), applied on every start. SQLite file at `data/fortnight.db` (WAL, foreign keys on), opened with `node:sqlite` since revision 2. `DATA_DIR`, `DB_FILE`, `PORT` (default 3001), `HOST` (default 127.0.0.1), `LOG_LEVEL`, `FORTNIGHT_TIME_ZONE` (seed default `UTC`) are read from the environment / root `.env`.
  - Seed (`npm run seed`, also automatic when `npm run dev` finds a new database): workspace "Fortnight"; pages Getting started (all 13 block types incl. nested bullet, toggle child, image, inline database view), Projects → Fortnight app → Ideas; the **Calendar** database (Name, Date, Tags, Notes; views "Calendar" and "All events") with Team sync (timed), Conference (3-day all-day), Dentist (one-day all-day), Weekly review (weekly on Fridays, has a body) and Morning run (daily, COUNT=10). Ids are fixed and exported as `SEED_IDS` from `@fortnight/server` for e2e tests.
- **Tests** (`tests/server`, `tests/contract`, run by `npm test` through the server's Vitest config): health and key flag; login with any name/password, cookie flags, same name → same user, empty name 400, session read, logout, re-login replaces the session, forged cookie; 401 on 17 protected/unknown routes and 404 with a session; error shapes for 400/413/415/malformed JSON; the API key never appears in any response body/header or in the config; migrations on an empty file DB and twice on the same DB; FTS5 works; seed twice leaves the DB byte-for-byte identical, is deterministic, keeps user edits, and every seeded block/property/view/date parses with the shared schemas; every exported schema has a fixture that round-trips through JSON (enforced by a coverage test), plus 26 must-reject cases; SSE events and all tool inputs round-trip; 1,000 random position inserts stay ordered; RRULE parser accepts the subset and rejects 13 bad rules; every implemented response parses with its contract schema.

### Checks run (after rebasing on `origin/main` `ca8d7b5`)

- `npm install`: up to date. `npm run typecheck`: pass. `npm run lint` (ESLint + Prettier check): pass. `npm test`: 7 files, **265 tests passed**. `npm run e2e`: no workspace defines it yet (Codex adds it in X-001). `npm run format:check`: pass. `git diff --check origin/main HEAD`: clean.
- Manual smoke test: `npm run seed` twice on a fresh data dir (second run: "nothing changed"); `npm run dev` (root, parallel runner) then over HTTP: health 200, `/api/pages` without cookie 401, login → user, `GET /api/session` → user, logout `{}`, then 401.

### Known limitations

- Only health and session routes exist; everything else in the contract is C-002 onward. The FTS5 table exists but is not filled yet (C-002 adds indexing, including the seeded pages).
- `npm run build` has nothing to build yet; the server runs TypeScript through `tsx`. The production build is C-006.
- Timed seed events use UTC (`Z`) times so the seed is identical on every machine.

### Requests

- **Codex**: please review contract v1 (`src/shared`, decisions 1–12 above) and record acceptance or change requests in `codex-task.md`. Replace `TEMP(contract)` types with imports from `@fortnight/shared`. For e2e, the seed ids are exported as `SEED_IDS` from `@fortnight/server`, and a fresh `DATA_DIR` gives a clean, seeded database.
- **Coordinator**: please copy decisions 1–12 into `plan.md` section 10 as the v1 row once Codex accepts them.
