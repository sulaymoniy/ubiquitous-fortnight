# Claude task

- Status: Planning accepted. User decisions D1–D5 recorded in `plan.md` section 9 (2026-11-11). Codex approved the plan and contract design v0.1 in `1c19a82`; Claude acknowledges that approval. Merged to `main` with user authorization. No app code written.
- Worktree: `Desktop/fortnight/.worktrees/claude`
- Branch: `claude/notion-plan` (planning). Implementation will use new `claude/<milestone>` branches.
- Role: Builds backend, storage, contract and agent. Also coordinates between Claude and Codex for the user: reviews both branches and reports before any merge.
- Scope (this task): Propose the stack, repo layout, shared contract, ownership split and milestones for the Notion-like workspace with calendar and Claude agent. Full plan in `docs/coordination/plan.md`.
- Codex input: Codex pushed from its fork (`zfroff:codex/notion-plan`, PR #2). Its record accepts the plan, answers `plan.md` section 8, and lists M0 precision items; Claude accepts those items (summarized in `plan.md` section 8).
- Coordination: Read `AGENTS.md` and `codex-task.md` before starting. Record proposals explicitly; do not assume agreement from silence.

## Ownership (accepted by the user and Codex)

- Claude: root workspace config (`package.json`, `tsconfig.base.json`, lint/format config, `.env.example`), `src/shared/**` (contract keeper; changes only when both records accept them), `src/server/**`, `tests/server/**`, `tests/contract/**`, `docs/coordination/plan.md`, this record.
- Codex: `src/web/**`, `tests/web/**`, `tests/e2e/**`, `docs/coordination/codex-task.md`, `AGENTS.md`.

## Changes made on user authorization (2026-11-11)

- Root `index.html` removed (D4). This overrides the `AGENTS.md` line that keeps it; Codex should update `AGENTS.md` to say the app entry is `src/web/index.html`.
- `.gitignore` (created by Codex) now also ignores `node_modules/`, `dist/`, `data/`, `.env`, `agent-profiles.json`.
- `.env.example` added with an empty `ANTHROPIC_API_KEY=`. A local, untracked `.env` copy exists in this worktree for the user's key.
- Plan updated for mock login (D2), accepted recurrence design (D3) and in-app agent profile switching (D5).

## Shared interfaces

- Contract design v0.1 in `plan.md` section 4: entities, filter grammar, REST routes, block ops, SSE events, agent tools, mock login, agent profiles.
- Status: **accepted** by both records (Codex `1c19a82`, Claude in this commit). Executable contract v1 does not exist yet; it is established by `src/shared` schemas and contract tests in M0.

## Next steps

1. With user approval, M0 scaffold starts on `claude/m0-scaffold` (Claude) and `codex/m0-web` (Codex).

## Validation

- Docs only. Checked: no whitespace errors (`git diff --check`), only files in this worktree touched, Codex's record and branch not touched.
