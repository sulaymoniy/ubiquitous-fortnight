# Claude task

## Status
- task: C-002
- revision: 1
- state: working
- branch: claude/c-002-pages-blocks
- commit: -
- updated: 2026-11-11T17:30:59+05:00
- note: Work in progress. Routes working and pushed for Codex: workspace GET/PATCH, pages list/create/get/patch/archive/restore, page ops, search, uploads (+ GET /uploads/:id), changesets list and undo. Still to do: Markdown converter, remaining M1.1 tests (ops, search, uploads, undo, 1,000 inserts).

## Role and ownership (accepted by the user and Codex)

- Role: backend builder. Builds backend, storage, contract and agent. Follows `docs/coordination/PROTOCOL.md`.
- Claude owns: root workspace config (`package.json`, `package-lock.json` changes for its packages, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitattributes`, `scripts/`, `.env.example`), `src/shared/**` (contract keeper), `src/server/**`, `tests/server/**`, `tests/contract/**`, this record.
- Codex owns: `src/web/**`, `tests/web/**`, `tests/e2e/**`, `docs/coordination/codex-task.md`, `AGENTS.md`.
- Coordinator owns: `PROTOCOL.md`, `backlog.md`, `plan.md`, `inbox/*`.

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
