# Inbox: frontend builder (codex)

Written by the coordinator only. Follow `docs/coordination/PROTOCOL.md`.

## Current task
- task: X-003
- revision: 1
- state: assigned
- branch: codex/x-003-databases-calendar (resume your checkpoint; rebase onto `main`)
- base: main (X-004 merged)
- spec: `backlog.md` → X-003, feature-first mode
- Also fix in this pass (X-004 follow-ups, merged fast at the user's request):
  1. 5 web tests in `tests/web/App.test.tsx` fail because `scroll.current?.scrollTo is not a function` in jsdom. Guard the call (`el.scrollTo?.(...)`) or stub `Element.prototype.scrollTo` in `tests/web/setup.ts`.
  2. Run Prettier on the 6 flagged files (`agent.css`, `AgentPanel.tsx`, `InlineAI.tsx`, `api/agent.ts`, `BlockRow.tsx`, `session.ts`).

## Deferred
- (none)

## X-004 spec
- The real API key is now configured on the user's machine, but **use `AGENT_FAKE=1` for all your development and tests**. No real API calls.
- Build, in this order (feature-first, minimal tests):
  1. **Agent panel** in the right-side slot (replace "coming soon"):
     - chat input; streamed assistant text from the SSE `text.delta` events of `POST /api/agent/conversations/:id/messages`
     - send `context: { pageId, selectedBlockIds, now, timeZone }` with the current page
  2. **Tool-call cards**: one per `tool.started` / `tool.finished` event, showing the tool name, a short input summary, the result summary, and an **Undo** button (`POST /api/changesets/:id/undo`). Add **"Undo all"** for the run (`POST /api/agent/runs/:runId/undo`) and **Stop** (`/cancel`).
  3. **Refresh**: after `tool.finished`, invalidate the queries for the `affected` page, row and database ids, so the editor, tables and calendar update. Never overwrite a dirty editor.
  4. **Profile picker** in the panel header: list from `GET /api/agent/profiles`, showing name, model and a read-only badge; switch per conversation (`PATCH` the conversation); "Set as default" option. If `/api/health` says `agentKeyConfigured: false`, show "Add your key to .env" instead of the input.
  5. **Conversation list**: new chat, earlier chats (`GET /api/agent/conversations`), reopen to see the transcript.
  6. **Inline `/ai`**: "/" menu items for AI write, continue, summarize, rewrite, shorter, longer and fix grammar, plus "Ask AI…" (custom). They stream from `POST /api/ai/inline` into a preview box under the block, with Accept (inserts through the normal ops call, so it is undoable) and Discard.
  7. **Polish and final e2e**: one Playwright run with `AGENT_FAKE=1` covering the three example prompts ("schedule a 1h review every Friday", "summarize this page", "what's on my week?"), undo of a run, and inline AI accept. Run it against `npm run build && npm start`. Fix any rough edges you saw across the app.
- Ready when: the panel works against the fake model in the running app, and `npm ci`, typecheck, lint, test and e2e all pass.

## Notes from the coordinator
- **C-004 is merged: the agent API (profiles, conversations, SSE runs, undo, inline AI, `AGENT_FAKE=1`), `npm run build && npm start`, and the README are on `main`.** The whole backend is finished. After X-003, X-004 can use the real agent routes with the fake model. If you find a backend bug, describe it under "Requests" in your record; Claude is stopped, so the coordinator will handle it.
- **C-003 (databases, views, query, calendar API with recurrence) is merged on `main`.** After X-002, X-003 can use the real API right away.
- **FEATURE-FIRST MODE (see top of `PROTOCOL.md`): ship working Notion features fast.** Minimal tests (core logic only), no e2e until X-004, and mark ready as soon as the feature works and install/typecheck/lint/test pass. The user has seen no features after an hour, so speed matters most now.
- **Efficiency mode is on (see `PROTOCOL.md`).** The user's usage limit is close. Work in fewer, bigger steps; no status-only commits; short notes; 10-minute idle waits. The backlog now has 3 remaining tasks per builder (C-003, C-004 / X-003, X-004).
- Push your branches to your fork (`zfroff/ubiquitous-fortnight`); the coordinator fetches from there. No pull requests needed.
- **The UI/UX standard at the top of `backlog.md` applies to every X task.** X-001 looked great: calm, clean, on-brand. Keep that level for the editor, sidebar tree, "/" menu and search palette.
- Claude's C-002 (pages, blocks, ops, search, uploads, undo) is on `origin/claude/c-002-pages-blocks`, with its routes already working. Build against it now. **C-002 is now merged on `main`.** Rebase and mark X-002 ready as soon as the editor works.
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
- 2026-11-11: X-002 merged (clean install, typecheck, lint, 376 tests). X-003 assigned.
- 2026-11-11: X-004 merged fast at the user's request (typecheck, ESLint, server tests pass; web test and format follow-ups listed). X-003 resumed.
