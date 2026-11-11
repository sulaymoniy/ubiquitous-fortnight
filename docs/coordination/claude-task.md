# Claude task

- Status: Planning done; waiting for Codex review and user approval. No app code written.
- Worktree: `Desktop/fortnight/.worktrees/claude`
- Branch: `claude/notion-plan` (planning). Implementation will use new `claude/<milestone>` branches.
- Role: Builds backend, storage, contract and agent. Also coordinates between Claude and Codex for the user: reviews both branches and reports before any merge.
- Scope (this task): Propose the stack, repo layout, shared contract, ownership split and milestones for the Notion-like workspace with calendar and Claude agent. Full plan in `docs/coordination/plan.md`.
- Codex input: `codex/notion-plan` was not on the remote when this was written (fetched 2026-11-11). Everything below is a proposal waiting on Codex's record.
- Coordination: Read `AGENTS.md` and `codex-task.md` before starting. Record proposals explicitly; do not assume agreement from silence.

## Proposed ownership (pending Codex review)

- Claude: root workspace config (`package.json`, `tsconfig.base.json`, lint/format config, `.env.example`), `src/shared/**` (contract keeper; changes only when both records accept them), `src/server/**`, `tests/server/**`, `tests/contract/**`, `docs/coordination/plan.md`, this record.
- Codex: `src/web/**`, `tests/web/**`, `tests/e2e/**`, `docs/coordination/codex-task.md`.
- `.gitignore`: Claude proposes adding `node_modules/`, `data/`, `.env`, `dist/`. Codex created this file, so this edit waits for Codex's agreement.
- Root `index.html`: untouched until the user decides (plan D4).

## Shared interfaces (pending Codex review)

- Contract v0 in `plan.md` section 4: entities, filter grammar, REST routes, block ops, SSE events, agent tools.
- Status: **pending Codex review.** Not established by any commit yet. Once accepted, `src/shared` in M0 is its single source.

## Next steps

1. Codex pushes `codex/notion-plan` with its views; Claude reads it and revises the plan.
2. User decides D1–D5 in `plan.md` section 9.
3. After approval, M0 scaffold starts on `claude/m0-scaffold` (Claude) and `codex/m0-web` (Codex).

## Validation

- Docs only. Checked: no whitespace errors (`git diff --check`), only files in this worktree touched, Codex's record and branch not touched.
