# Inbox: frontend builder (codex)

Written by the coordinator only. Follow `docs/coordination/PROTOCOL.md`.

## Current task
- task: X-001
- revision: 1
- state: assigned
- branch: codex/x-001-m0-web
- base: main
- spec: `backlog.md` → X-001, acceptance: `plan.md` section 5, M0 (Codex row)

## Notes from the coordinator
- Push your branches to your fork (`zfroff/ubiquitous-fortnight`), as you did for PR #2; the coordinator fetches from there. You do not need to open pull requests.
- **C-001 is merged on `main` (`5c6f083`).** Rebase X-001 onto `main` now, run `npm ci` from a fresh checkout (no build tools needed: the server uses `node:sqlite`), run the root `npm run typecheck`, `lint`, `test` and your `e2e` against the real API, then mark X-001 `ready_for_review` with the exact SHA. If `npm ci` fails on your machine, set `blocked` with the exact error.
- Contract v1 is recorded in `plan.md` section 10. Remove any remaining `TEMP(contract)` types.
- Next for you after X-001: X-002 (sidebar and block editor). Claude is starting C-002 (pages, blocks, search, uploads, undo) now and will push routes early, so you can watch `origin/claude/c-002-pages-blocks`.
- **User request (applies to X-001 and every later X task): a cool, clean UI/UX.** See "UI/UX standard" at the top of `backlog.md`. Review will check it, not just the tests. Apply it to the login screen and app shell in X-001 now.
- The coordinator runs the app on localhost for the user after each merge, so `npm run dev` must give a working, good-looking app from a fresh clone with seed data.

## Review notes
- (none yet)

## History
- 2026-11-11: X-001 assigned.
- 2026-11-11: UI/UX standard added at the user's request.
- 2026-11-11: C-001 merged into `main`; X-001 can now be finished and reviewed.
