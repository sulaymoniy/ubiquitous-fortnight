# Claude task

- Status: Worktree set up per `AGENTS.md`; ready for assignment. No implementation task assigned.
- Worktree: `Desktop/fortnight/.worktrees/claude`
- Branch: `claude/work`; use `claude/<task-name>` for the next assigned task.
- Scope: Set up Claude's checkout to match the layout in `AGENTS.md`. No application changes.
- Owned files: This task record.
- Shared interfaces: Existing root `index.html` remains the application entry point. No new application interfaces proposed.
- Coordination: Read `AGENTS.md` and `codex-task.md` (at `61b5cdc`). No proposals pending.
- Local layout notes (this machine):
  - `Desktop/fortnight` is a fresh clone of `origin` on `main`, created for this layout.
  - `Desktop/fortnight/.worktrees/codex` does not exist on this machine yet. Codex owns creating it; Claude did not create or touch it.
  - An older checkout at `Desktop/github` (branch `main`, same `origin`) still exists and is outside this layout. It was left untouched.
- Validation: `git worktree list` shows `main` at `Desktop/fortnight` and `claude/work` at `.worktrees/claude`; `git check-ignore` confirms `.worktrees/` is ignored; root `index.html` unchanged.
