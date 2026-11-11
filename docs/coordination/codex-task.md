## Status

- task: X-001
- revision: 1
- state: working
- branch: codex/x-001-m0-web
- commit: ab1f9fccbb4fbb8d4519cb6ed551d8669799e6e8
- updated: 2026-11-11T12:14:45Z
- note: Contract v1 accepted and integrated; 12 web/client tests, frontend typecheck and lint pass under Node 22. Waiting for C-001 on main for workspace cleanup, clean install, root checks and real API e2e.

# X-001: M0 web scaffold

- Owns src/web, tests/web, tests/e2e, and this record. No coordinator/backend/shared files modified.
- Decisions: warm neutral/olive UI; demo login clearly labeled, no fake pages or active AI controls; mobile navigation and toggleable right panel. TanStack Query owns sessions/health; Zustand owns shell toggles.
- Network failures have retry UI; 401 clears the displayed session. API requests use same-origin cookies. Shared types are marked TEMP(contract) until C-001 merges.
- E2E starts server and Vite itself in fake-agent mode; browser results are under ignored node_modules/.cache. Actual E2E and root checks await C-001.
- Environment: system Node is 23.9.0. Validation now uses cached Node 22.23.4 and npm 11.6.2 explicitly; tooling matches C-001 (Vite 8.3.8, Vitest 5.1.0, TS 6.0.3, ESLint 10.14.0).

# Codex task

- Status: **Approved by Codex.** Reviewed Claude's plan at `f99e3cf` on 2026-11-11. The user explicitly requested approval. The plan, ownership split, milestone order, acceptance checks, and contract design v0.1 are accepted as the implementation baseline.
- Worktree: `Desktop/fortnight/.worktrees/codex`
- Branch: `codex/notion-plan` (review); frontend scaffold will use `codex/m0-web`.
- Role: Frontend implementation, web tests, and end-to-end tests. Claude coordinates integration and owns backend, storage, shared contract, and agent implementation.
- Owned files: `src/web/**`, `tests/web/**`, `tests/e2e/**`, `docs/coordination/codex-task.md`, `AGENTS.md`.
- Scope of this commit: Record approval, answer the four questions in plan section 8, and align AGENTS.md with the user-approved application entry point. No application code added.

## Accepted plan and user decisions

- Accept the plan in `docs/coordination/plan.md` at `f99e3cf`, including D1-D5: ownership split, mock login, RRULE series recurrence, removal of root index.html, and server-only API key with in-app agent profiles.
- Accept contract design v0.1 in sections 4 and 10: entities, filters, REST and block operations, SSE events, agent tools, recurrence, and profile switching.
- Claude is the keeper of `src/shared/**`; contract changes require acceptance in both task records. Generated/inferred shared types are the source for the frontend API client; do not maintain duplicate wire types.
- This is design approval. Executable contract v1 will be validated against M0's actual schemas and tests; it is not claimed to exist or pass yet.
- Claude should acknowledge this approval in its own task record and update its plan/changelog. Codex does not edit Claude-owned records.

## Answers to plan section 8

1. **Editor:** Tiptap/ProseMirror with custom nodes and marks where needed. Keep the proposed flat Block/RichText JSON contract and persistent block IDs. One adapter owns conversion between editor documents and the shared format, with round-trip tests for hierarchy, marks, mentions, image metadata, and stable IDs. Unsupported input must be reported rather than silently dropped. Inline database views remain a stretch goal as planned.
2. **Tests:** Codex owns all `tests/e2e/**` and `tests/web/**`. Claude supplies deterministic seed data and fake-model mode. E2E covers the real API and persisted data; isolated UI tests use contract-shaped fixtures.
3. **Shared contract:** Accepted: Claude owns `src/shared/**` and versioned schemas; each contract change needs agreement in both records.
4. **Calendar:** Use FullCalendar's standard React calendar with month/week/day views and interaction support; custom app styling and date adapters live in `src/web`. No premium resource views are needed. The server expands recurrence; the client displays occurrences and sends series changes through row mutations.

Frontend scaffold: React + Vite + TypeScript, TanStack Query for server state, Zustand for local UI state, dnd-kit for page/block/board ordering, and a typed fetch client over `@fortnight/shared`. Pin compatible package versions during implementation.

Library references reviewed: https://tiptap.dev/docs/editor/extensions/custom-extensions and https://fullcalendar.io/docs/react and https://fullcalendar.io/docs/editable.

## Schema details to make explicit during M0

These are implementation precision items within the accepted design, not a new feature scope or a reason to block scaffolding:

- Define MockUser and all request/response schemas, including the row-body ops response (a row must not be parsed as a sidebar Page), deleted/touched block handling, and error details for conflicts.
- Make date range boundaries, all-day end semantics, workspace time zone/DST recurrence behavior, and occurrence identity explicit before the calendar milestone. Keep the accepted whole-series editing behavior.
- Health/session exceptions must still allow login/logout and return 401 for protected routes. The mock login is imitation only and the UI should describe it accurately.
- Serialize autosave per page, retain unsaved edits on network failure/401, and flush pending edits before navigation. Refetches after agent mutations must not overwrite a dirty editor buffer.
- API model names and provider-specific parameters in the plan are examples to verify against provider documentation when Claude implements the agent. Approval does not assert their runtime availability.

## M0 handoff and validation

- Ready for `codex/m0-web` after Claude publishes the root scaffold/shared schemas on `claude/m0-scaffold`; frontend layout work may proceed independently within owned files using mocks.
- Preserve Claude's root workspace config and lockfile ownership; request root script/dependency changes through this record.
- Implementation follows the milestone checks in the plan. No paid model evaluation is authorized by this documentation update.
- Reviewed the full 422-line plan and both task records; checked whitespace and confirmed only AGENTS.md and this Codex-owned record changed. No runtime tests are applicable to this docs-only approval.

## X-001 progress: UI standard and validation

- Bundled Inter via @fontsource/inter (no font CDN), Lucide icons, and shared tokens in src/web/src/styles/tokens.css. Centered demo-login card; neutral/olive palette; AA text contrast, skeletons, focus states, Escape dismissal, and tablet sidebar collapse.
- Fixed logout cache observer handling after a regression test exposed a stale authenticated shell.
- Passed frontend typecheck, lint, 6 session tests, and production build with the final Node 22/tooling versions. Root checks and real API e2e remain gated on C-001.
- Browser check with mock API: screenshots inspected for desktop login and shell and 768px tablet; no horizontal overflow at 1440, 1024, 768, 390px; no page errors. This is visual smoke verification, not the real-backend e2e acceptance check.
- Temporary standalone dependency aliases/configuration will be removed after C-001 workspace installation. API contract types remain TEMP(contract); ready_for_review is gated on shared schemas and full root/e2e checks.
- A standalone install with old npm 11.2.0 failed resolving updated peers; npm 11.6.2 installed the matched toolchain successfully without bypassing peer constraints. Audit now reports only moderate dev-tool advisories (same tooling family noted by C-001); no critical advisories remain in the isolated web install.

## Contract v1

- **Accepted.** Codex accepts executable contract 1.0.0 and all 12 precision decisions in Claude's C-001 record at 1d2589d, as authorized by the coordinator's inbox on main 6173a9c. Separate row ops, deleted-block IDs, explicit update type/content, structured conflict details, named colors, recurrence/DST/range semantics, database/search IDs, changeset ops, agent events, and allowed image types fit the frontend adapters and do not require a design change.
- Health/session/login/logout now use the shared request/response schemas with runtime parsing; no duplicate wire types remain. Malformed success responses, network failures, cancellation, API error details and session-expiry events are covered by client tests.
- Early validation uses an untracked read-only snapshot of the published C-001 shared package under src/web/node_modules/.cache; no src/shared or root files changed. This snapshot is temporary and will be replaced by the real workspace link after C-001 merges. Root clean-install and real API/e2e checks still gate ready_for_review.
- Contract requests: none for X-001. Accept the schema's 80-character name and 200-character password limits; the form matches them. The API's named avatar color is retained as data while the M0 shell uses the neutral theme accent.
