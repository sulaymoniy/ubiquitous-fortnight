# Claude task

## Status
- task: C-001
- revision: 1
- state: working
- branch: claude/c-001-m0-scaffold
- commit: -
- updated: 2026-11-11T17:15:00+05:00
- note: Root workspace and `@fortnight/shared` contract v1 pushed early for Codex; server, migrations, seed and tests in progress.

## Role and ownership (accepted by the user and Codex)

- Role: backend builder. Builds backend, storage, contract and agent. Follows `docs/coordination/PROTOCOL.md`.
- Claude owns: root workspace config (`package.json`, `package-lock.json` changes for its packages, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitattributes`, `scripts/`, `.env.example`), `src/shared/**` (contract keeper), `src/server/**`, `tests/server/**`, `tests/contract/**`, this record.
- Codex owns: `src/web/**`, `tests/web/**`, `tests/e2e/**`, `docs/coordination/codex-task.md`, `AGENTS.md`.
- Coordinator owns: `PROTOCOL.md`, `backlog.md`, `plan.md`, `inbox/*`.

## C-001: M0 backend scaffold and contract v1

### How Codex consumes `@fortnight/shared`

- Package: `@fortnight/shared` (workspace `src/shared`). Add `"@fortnight/shared": "*"` to `src/web/package.json` `dependencies`; `npm install` at the repo root links it.
- Import everything from the package root: `import { Page, PageOpsResponse, CONTRACT_VERSION, type Block } from '@fortnight/shared'`. Schemas and types share names (`Page` is both the Zod schema and the inferred type). There are no subpath imports.
- The package ships TypeScript source (`exports: { ".": "./src/index.ts" }`); there is no build step. Internal imports use `.ts` extensions.
- Vite: works as is (Vite transpiles TS from linked workspace packages). If the dev server complains, add `optimizeDeps: { exclude: ['@fortnight/shared'] }`.
- tsconfig for `src/web`: extend `../../tsconfig.base.json` and override for the browser, for example `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"jsx": "react-jsx"`, `"types": ["vite/client"]`. Keep `allowImportingTsExtensions` and `noEmit` (already in the base). The base sets `"types": []`, so list the types you need.
- Runtime parsing: `Schema.parse(json)` on responses, or `safeParse` to show contract errors. Zod is 4.x (`zod@4.6.7`).
- Root scripts run `--workspaces --if-present`, so `src/web` only needs its own `dev`, `build`, `typecheck`, `lint`, `test` and `e2e` scripts. `npm run dev` at the root runs every workspace's `dev` in parallel (`scripts/run-parallel.mjs`). Root devDependencies already include `typescript@6.0.3`, `vite@8.3.8`, `vitest@5.1.0`, ESLint 10 and Prettier; the shared `eslint.config.js` already has browser globals for `src/web/**` and `tests/web/**`.

### Contract v1 precision decisions (for `plan.md` section 10, v1 row; pending Codex acceptance)

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
