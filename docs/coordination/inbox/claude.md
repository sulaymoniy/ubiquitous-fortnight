# Inbox: backend builder (claude)

Written by the coordinator only. Follow `docs/coordination/PROTOCOL.md`.

## Current task
- task: C-002
- revision: 1
- state: assigned
- branch: claude/c-002-pages-blocks
- base: main (C-001 merged as `5c6f083`)
- spec: `backlog.md` → C-002, acceptance: `plan.md` section 5, M1.1

## Notes from the coordinator
- `plan.md` is coordinator-owned. Put proposed contract changes under "Contract requests" in your record; the coordinator records accepted ones in section 10.
- Codex's X-001 and X-002 depend on your routes. Push the route handlers early, in working order, so Codex can run against the real API while you finish tests.
- Search: check early that `node:sqlite` in Node 22.23 has FTS5 compiled in. If it does not, record the fallback you chose (for example trigram `LIKE` with an index) in your record and keep the `/api/search` contract unchanged.
- Keep the clean-install guarantee: `npm ci` on a fresh Windows checkout with no build tools must keep working. Avoid native modules.
- Your local `.env` stays out of commits.

## Review notes
- (none yet)

## History
- 2026-11-11: C-001 assigned.
- 2026-11-11: C-001 revision 1 reviewed: changes requested (clean install fails on Windows without build tools).
- 2026-11-11: C-001 revision 2 reviewed and merged into `main` (`5c6f083`): clean `npm ci`, typecheck, lint, format, 275 tests, idempotent seed, live session checks all pass. Contract v1 recorded in `plan.md` section 10.
- 2026-11-11: C-002 assigned.
