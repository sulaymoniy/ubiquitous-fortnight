# Backlog

Tasks in order. Each task's acceptance checks are the matching milestone rows in `plan.md` section 5, plus anything listed here. Builders act only on the task their inbox assigns; this list shows what comes next so designs can anticipate it.

`C-` = backend builder (claude). `X-` = frontend builder (codex). "Needs" = what must be merged on `main` before the task can be marked `ready_for_review` (work may start earlier against the contract and mocks).

## C-001: M0 backend scaffold and contract v1
- Needs: nothing.
- Branch: `claude/c-001-m0-scaffold`
1. Workspace root: npm workspaces with the glob `src/*` so `src/web` can be added without root changes. Root scripts `dev`, `build`, `typecheck`, `lint`, `test`, `e2e`, `seed` run with `--workspaces --if-present` so they work before `src/web` exists. `tsconfig.base.json`, ESLint and Prettier config. Exact dependency versions. Node 22.
2. `src/shared` (`@fortnight/shared`): Zod schemas plus inferred types for everything in `plan.md` section 4 (entities, RichText, block types and content, property types and values, DateValue, View config, Filter/Sort, Changeset, every REST request and response, the error shape, BlockOp, SSE events, AgentProfile, MockUser, EventOccurrence, agent tool inputs). `CONTRACT_VERSION = "1.0.0"`. Fractional-index helpers. Make explicit:
   - the row-body ops response is not the sidebar `Page` type
   - ops responses list touched blocks and deleted block ids
   - the shape of 409 conflict `details`
   - calendar range `[from, to)`, all-day `end` exclusive, occurrence identity `rowId + occurrenceStart`
   - time zone and DST handling, in schema comments
3. `src/server` (`@fortnight/server`): Fastify 5 + `fastify-type-provider-zod`; better-sqlite3 + Drizzle with migrations for the whole v0.1 data model; DB under `data/`; loads root `.env` (never log or return the key). Implement only `GET /api/health`, `POST/GET/DELETE /api/session` (mock login: any name and password; users in memory; HttpOnly `fsid` cookie), and the 401 guard on all other `/api` routes. Dev server on `:3001`. Deterministic, idempotent `npm run seed`: workspace, nested sample pages with every block type, and the "Calendar" database (Name, Date, Tags, Notes) with a few events, including one recurring.
4. Tests: `tests/server` (Vitest + `fastify.inject`): health, login/logout, the 401 guard, key never in responses, migrations on an empty DB, seed run twice. `tests/contract`: every implemented response parses with the shared schemas; round-trip parse tests for each schema.
5. In `claude-task.md`, document how Codex consumes `@fortnight/shared` (package name, import paths, tsconfig and Vite settings it needs).

## X-001: M0 web scaffold, login, app shell
- Needs: C-001 (start now with `TEMP(contract)` types; switch to `@fortnight/shared` once C-001 is on `main`).
- Branch: `codex/x-001-m0-web`
- `src/web` (`@fortnight/web`): Vite + React + TS, `src/web/index.html` as the app entry, dev on `:5173` with `/api` and `/uploads` proxied to `:3001`. Mock login screen (name and password; label it as a demo login), logout, 401 → login. App shell: sidebar, main area, right panel slot; shows the user's name and API health. Typed API client over `@fortnight/shared`. TanStack Query, Zustand. `tests/web` (Vitest + Testing Library) and `tests/e2e` (Playwright) set up, with one e2e test: log in, see the shell, log out. `npm run e2e` starts server and web itself.

## C-002: M1.1 pages, blocks, ops, search, uploads, undo log
- Needs: C-001.
- Routes from `plan.md` 4.3: pages, page ops, archive/restore, search (FTS5), uploads, changesets list and undo. Every mutation writes a changeset with inverse ops. Markdown ↔ blocks converter in `src/server` (the agent needs it later), with round-trip tests.

## X-002: M1.2 sidebar and block editor, plus M1.3 e2e
- Needs: X-001, C-002.
- Tiptap editor mapped to the shared block format through one adapter with round-trip tests. Everything in the M1.2 row. Autosave: per page, serialized, keeps dirty edits on failure or 401, flushes before navigation, never overwritten by a refetch. M1.3 Playwright scenario.

## C-003: M2.1 databases, properties, rows, views, query
- Needs: C-002.

## X-003: M2.2 table, board, list, gallery views, plus M2.3 e2e
- Needs: X-002, C-003.

## C-004: M3.1 calendar API and recurrence
- Needs: C-003.

## X-004: M3.2 calendar views (FullCalendar), plus M3.3 e2e
- Needs: X-003, C-004.

## C-005: M4.1 agent backend
- Needs: C-004.
- Profiles, routes, the tool loop with SSE, a changeset per tool call, run undo, inline AI, and a fake-model mode (`AGENT_FAKE=1`) with scripted turns for the three example prompts. No real API calls in tests or during development. Check model IDs and request parameters against Anthropic's current SDK docs before writing the client code.

## X-005: M4.2 agent panel, profile picker, inline /ai, plus e2e with the fake model
- Needs: X-004, C-005.

## C-006: Production build and docs
- Needs: C-005, X-005.
- `npm run build && npm start` serves the built web app and API on one port. Root `README.md` covering setup, `.env`, dev, seed, tests, and the mock-login and agent-profile notes.

## X-006: Final UI polish and full e2e pass
- Needs: C-006.
- Fix rough edges found across phases. Full Playwright suite green against the production build.

## F-001: Final integration (coordinator)
- Clean clone, install, build, run every check, smoke-test in a browser, tag `v0.1.0`. Real-model evaluation (M4.3) only if the user approves the cost.
