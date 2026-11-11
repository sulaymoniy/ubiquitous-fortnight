# Inbox: frontend builder (codex)

Written by the coordinator only. Follow `docs/coordination/PROTOCOL.md`.

## Current task
- task: X-002
- revision: 1
- state: assigned
- branch: codex/x-002-editor
- base: main (X-001 merged as `d7cbfc8`, lockfile fix `32c466e`)
- spec: `backlog.md` → X-002, acceptance: `plan.md` section 5, M1.2 and M1.3

## Notes from the coordinator
- Push your branches to your fork (`zfroff/ubiquitous-fortnight`); the coordinator fetches from there. No pull requests needed.
- **The UI/UX standard at the top of `backlog.md` applies to every X task.** X-001 looked great: calm, clean, on-brand. Keep that level for the editor, sidebar tree, "/" menu and search palette.
- Claude's C-002 (pages, blocks, ops, search, uploads, undo) is on `origin/claude/c-002-pages-blocks`, with its routes already working. Build against it now. X-002 can be marked `ready_for_review` only after C-002 is on `main`; the coordinator tells you here when it lands.
- **Fix in X-002: the page title is garbled.** `document.title` shows "Fortnight â€” your space to think": the em dash in `src/web/index.html` (or wherever the title is set) is double-encoded. Save it as UTF-8, or use `&mdash;` or a plain hyphen. Add a check (unit or e2e) that the title has no mojibake.
- **Lockfile rule (new; Claude has the same rule).** Your X-001 lockfile dropped `@emnapi/core` and `@emnapi/runtime`, so `npm ci` failed on Windows; the coordinator regenerated it on Windows in `32c466e`. From now on, after any `npm install`, run `git diff package-lock.json` and make sure no package entries you did not intend to change were removed. npm on one OS can prune optional-dependency peers that other OSes need. If entries vanish, restore them (for example `git checkout upstream/main -- package-lock.json`, then `npm install` again). Only commit lockfile changes for packages you added or updated.

## Review notes (X-001 revision 1, commit 79f11a1): passed and merged
- Ownership OK. Typecheck, lint, build, format, 275 server and contract tests, 12 web tests, and 2 Playwright tests against the real API all pass on Windows, once the lockfile is fixed.
- Visual check: the login card and app shell meet the UI/UX standard. Good empty states, typography and spacing.

## History
- 2026-11-11: X-001 assigned.
- 2026-11-11: UI/UX standard added at the user's request.
- 2026-11-11: C-001 merged into `main`; X-001 can now be finished and reviewed.
- 2026-11-11: X-001 reviewed and merged into `main` (`d7cbfc8`); lockfile regenerated on Windows (`32c466e`). X-002 assigned.
