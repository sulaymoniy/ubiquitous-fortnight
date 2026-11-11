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
- C-001 (root workspace and `@fortnight/shared`) is being built in parallel. Until it is on `main`, build `src/web` with temporary types in `src/web/src/api/` marked `TEMP(contract)`, and do not create root files (`package.json`, `tsconfig.base.json`, lint config). X-001 can only be marked `ready_for_review` after you rebase on a `main` that has C-001 and replace every `TEMP(contract)` type with `@fortnight/shared`.
- Watch `origin/claude/c-001-m0-scaffold` on the canonical repo to see the contract early.
- **User request (applies to X-001 and every later X task): a cool, clean UI/UX.** See "UI/UX standard" at the top of `backlog.md`. Review will check it, not just the tests. Apply it to the login screen and app shell in X-001 now.
- The coordinator runs the app on localhost for the user after each merge, so `npm run dev` must give a working, good-looking app from a fresh clone with seed data.

## Review notes
- (none yet)

## History
- 2026-11-11: X-001 assigned.
- 2026-11-11: UI/UX standard added at the user's request.
