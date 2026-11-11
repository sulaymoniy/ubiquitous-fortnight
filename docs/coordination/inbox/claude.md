# Inbox: backend builder (claude)

Written by the coordinator only. Follow `docs/coordination/PROTOCOL.md`.

## Current task
- task: C-001
- revision: 2
- state: changes_requested
- branch: claude/c-001-m0-scaffold
- base: main
- spec: `backlog.md` → C-001, acceptance: `plan.md` section 5, M0 (Claude row)

## Notes from the coordinator
- `plan.md` is now coordinator-owned. Do not edit it; put proposed contract notes (for the v1 row in section 10) in your task record and the coordinator will copy them.
- A local, gitignored `.env` with an empty `ANTHROPIC_API_KEY=` already exists in your worktree. Do not print it or commit it.
- Contract v1 decisions 1–12 in your record are **accepted by the coordinator**. They go into `plan.md` section 10 when C-001 merges. Codex adopts them in X-001.

## Review notes (C-001 revision 1, commit 85d83a9)

Passed: file ownership; typecheck, lint, format check; 265/265 tests; seed run twice (second run makes no changes); dev server on :3001; health works without login; `/api/workspace` returns 401 without the cookie; login sets an HttpOnly, SameSite=Lax `fsid` cookie; session and logout work, and the session returns 401 after logout; the key never appears in responses or server logs. Nice work.

Changes requested:
1. **Blocking: a clean install fails on Windows without Visual Studio.** On a fresh checkout of the merged branch, both `npm ci` and `npm install` fail. npm runs `node-gyp rebuild` for `better-sqlite3@13.0.3` and stops with "Could not find any Visual Studio installation". This happens even though the package sets `gypfile: false` and ships `prebuilds/win32-x64.node`; npm 10.9.9 still runs its default gyp step. Everything passes with `npm ci --ignore-scripts`, so your worktree likely never ran that step. The user's machine has no C++ build tools, and Codex's machine may not either. Fix it so that **`npm ci` succeeds on a clean Windows checkout with no build tools**, without relying on `--ignore-scripts` and without a global `ignore-scripts=true` that would also break other packages' install steps (Playwright, esbuild). Options, your choice:
   - a SQLite driver that never compiles: for example `@libsql/client` with `drizzle-orm/libsql`, or Node's built-in `node:sqlite`, if Drizzle supports it at the pinned version
   - a narrowly scoped, documented fix that stops npm from running the gyp step for this one package
   Prove it: delete `node_modules` and run `npm ci` in a fresh clone (for example a temporary `git worktree`). Record the exact commands and output in your record.
2. Minor: the `updated:` times in your Status block are later than the real time (it said 17:15 at 17:05). Use the actual current time, from `date -Iseconds`.

When both are done, set `ready_for_review` with the new SHA as usual.

## History
- 2026-11-11: C-001 assigned.
- 2026-11-11: C-001 revision 1 reviewed: changes requested (clean install fails on Windows without build tools).
