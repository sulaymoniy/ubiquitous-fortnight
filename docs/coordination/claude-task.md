# Claude task

- Status: Planning done. User decisions D1–D5 recorded in `plan.md` section 9 (2026-11-11). Contract waiting for Codex review. No app code written.
- Worktree: `Desktop/fortnight/.worktrees/claude`
- Branch: `claude/notion-plan` (planning). Implementation will use new `claude/<milestone>` branches.
- Role: Builds backend, storage, contract and agent. Also coordinates between Claude and Codex for the user: reviews both branches and reports before any merge.
- Scope (this task): Propose the stack, repo layout, shared contract, ownership split and milestones for the Notion-like workspace with calendar and Claude agent. Full plan in `docs/coordination/plan.md`.
- Codex input: `codex/notion-plan` was not on the remote when this was written (fetched 2026-11-11). Everything below is a proposal waiting on Codex's record.
- Coordination: Read `AGENTS.md` and `codex-task.md` before starting. Record proposals explicitly; do not assume agreement from silence.

## Ownership (split accepted by the user; file list pending Codex review)

- Claude: root workspace config (`package.json`, `tsconfig.base.json`, lint/format config, `.env.example`), `src/shared/**` (contract keeper; changes only when both records accept them), `src/server/**`, `tests/server/**`, `tests/contract/**`, `docs/coordination/plan.md`, this record.
- Codex: `src/web/**`, `tests/web/**`, `tests/e2e/**`, `docs/coordination/codex-task.md`, `AGENTS.md`.

## Changes made on user authorization (2026-11-11)

- Root `index.html` removed (D4). This overrides the `AGENTS.md` line that keeps it; Codex should update `AGENTS.md` to say the app entry is `src/web/index.html`.
- `.gitignore` (created by Codex) now also ignores `node_modules/`, `dist/`, `data/`, `.env`, `agent-profiles.json`.
- `.env.example` added with an empty `ANTHROPIC_API_KEY=`. A local, untracked `.env` copy exists in this worktree for the user's key.
- Plan updated for mock login (D2), accepted recurrence design (D3) and in-app agent profile switching (D5).

## Shared interfaces (pending Codex review)

- Contract v0 in `plan.md` section 4: entities, filter grammar, REST routes, block ops, SSE events, agent tools.
- Status: **pending Codex review.** Not established by any commit yet. Once accepted, `src/shared` in M0 is its single source.

## Next steps

1. Codex pushes `codex/notion-plan` with its views and answers to `plan.md` section 8; Claude reads it and revises the contract.
2. Once the contract is accepted in both records and the user approves, M0 scaffold starts on `claude/m0-scaffold` (Claude) and `codex/m0-web` (Codex).

## Validation

- Docs only. Checked: no whitespace errors (`git diff --check`), only files in this worktree touched, Codex's record and branch not touched.
