## Status
- task: X-001
- revision: 1
- state: ready_for_review
- branch: codex/x-001-m0-web
- commit: 79f11a1fb7a4b055830104911180b8af74c1d79e
- updated: 2026-11-11T12:34:05Z
- note: X-001 complete on upstream/main 8e65ad0. Fresh npm ci, root typecheck/lint/build, 287 tests, and 2 real-API browser tests pass. Contract v1 accepted; no temporary types or known blockers.

# Codex task record

## Ownership
Frontend builder: `src/web/**`, `tests/web/**`, `tests/e2e/**`, this record, and `AGENTS.md`. Only npm-generated root `package-lock.json` updates for owned packages are included, as allowed by PROTOCOL.md. No coordinator, backend, shared-contract, root configuration, .env, or data files edited.

## X-001: M0 web scaffold

### Built
- `@fortnight/web`: React, Vite, TypeScript, TanStack Query for server state and Zustand for shell toggles. Normal dev runs on 127.0.0.1:5173, proxying /api and /uploads to :3001.
- Centered demo-login card, name/password fields, login/logout, session restoration on reload, 401-to-login handling, and actionable retry UI for connectivity/API failures.
- Responsive sidebar, user name/initials, home area, API health/contract status, and a toggleable assistant slot. Future page/AI features are honestly labeled; no dummy actions or real model calls.
- Runtime request/response validation using `@fortnight/shared`, including safe handling of malformed JSON/shapes, typed API error details, cancellation, and session-expiry events. Temporary wire types and standalone aliases are removed.
- Bundled Inter (no external font CDN), Lucide icons, semantic neutral/olive design tokens in `src/web/src/styles/tokens.css`, visible keyboard focus, skeleton loaders, Escape dismissal, reduced-motion support, 720px content width, and tablet sidebar collapse.
- Uses the shared root TypeScript, ESLint, Prettier and tool versions. No standalone lint configuration remains.

### Tests and isolation
- 12 web/client tests: login/logout, existing sessions, assistant toggle, expired sessions, network/retry behavior, malformed success/error responses, conflict details, and cancellation.
- 2 Playwright tests against the real API: login/reload/logout and mobile navigation with overflow check.
- `npm run e2e` starts its own API on :3101 and web on :5174; existing servers are never reused. Every run gets a unique database below ignored node_modules/.cache. API key is explicitly blank, AGENT_FAKE=1. Normal dev ports/data remain independent.
- Vite's `FORTNIGHT_API_TARGET` is optional server-side proxy configuration, never a browser-exposed environment variable.

### Validation
- Rebased on canonical main `8e65ad0`, which includes C-001 merge `5c6f083`.
- Node 22.23.4 / npm 11.6.2 used explicitly (system Node is 23.9.0).
- `npm install`: pass; generated workspace lockfile includes web dependencies and the actual workspace shared link.
- Root `npm run typecheck`: pass across all workspaces.
- Root `npm run lint`: pass (ESLint + shared Prettier checks).
- Root `npm test`: 287 tests pass (275 server/contract + 12 web/client).
- Root `npm run e2e`: 2 tests pass against the real API.
- Root npm run build: pass after workspace integration. Fresh temporary clone at ea0f26a: npm ci passed in 19 seconds with no native build tools, followed by passing root typecheck, lint, all 287 tests, and both real-API Playwright tests.
- Earlier visual smoke with mocked API: inspected desktop login/shell and 768px tablet screenshots; no overflow at 1440/1024/768/390px and no page errors. This supplements the real API browser tests.
- No paid API calls, .env/data commits, main merges, or pull requests.

### Decisions and limitations
- Avatar colors are named values in contract v1. The M0 shell retains the server color as data while rendering avatars with the single neutral/accent theme.
- Only M0 features are active. Page tree/editor, databases, calendar and agent interactions follow their assigned future tasks.
- Browser installation: `npx playwright install chromium` is needed once on a clean machine.
- No contract requests or known X-001 functional blockers remain. Fresh-install validation is complete.
- Moderate development-tool audit advisories remain in the shared toolchain; no force-upgrade of coordinator-owned tooling was attempted.

## Contract v1
**Accepted.** Codex accepts executable 1.0.0 and all 12 C-001 precision decisions recorded in plan section 10: separate row ops, touched/deleted blocks, explicit update type/content, structured conflicts, fixed error codes, calendar occurrence/range/end semantics, recurrence/DST rules, database/search IDs, changeset ops, agent event/inline shapes, and allowed image types. No shared files were changed. Health/session/login/logout consume those schemas directly. The form matches 80-character names and 200-character passwords.

## Prior planning agreement
Plan and ownership split approved in `1c19a82`: Claude owns backend/storage/contract/agent; Codex owns frontend/web/e2e. Frontend decisions remain React/Vite/TypeScript, Tiptap/ProseMirror with a block-format adapter and round-trip tests, FullCalendar standard React views, TanStack Query, Zustand and dnd-kit. Shared changes go through the coordinator; nothing assumes access to the other agent's chat.
