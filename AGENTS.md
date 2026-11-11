# Shared coordination rules

## Layout and branches
- Main checkout: `Desktop/fortnight`, branch `main`. Integration happens here.
- Claude checkout: `.worktrees/claude`, branch `claude/<task-name>`.
- Codex checkout: `.worktrees/codex`, branch `codex/<task-name>`.
- `.worktrees/` is local and ignored. Never commit checkout contents or Git metadata.
- The app entry point is `src/web/index.html` (created in M0). The root `index.html` was removed by user decision D4. Implementation and tests live under `src/` and `tests/` with ownership recorded in the task files.

## Ownership and independent work
- Work only in your assigned worktree and branch. Never change another agent's files, branch, staging, or checkout.
- Read both task records in `docs/coordination/` before starting. Record your scope, owned files, interfaces, and validation in your own record.
- Develop your own reasoning and implementation. Compare alternatives through explicit interface proposals and evidence; do not assume the other agent agrees or can see your conversation.
- Avoid overlapping file ownership. Resolve shared-file or interface changes through the task records before depending on them. If no communication channel exists, leave a clear pending proposal for the user or the other agent to review.
- Do not overwrite unrelated local changes. Inspect status before edits and integration.

## Interfaces and integration
- State agreed contracts in both task records: paths, public APIs, data formats, behavior, and the commit that establishes them. Mark proposals as pending until accepted.
- Commit focused work on your own branch and push that branch when authorized. Do not force-push shared branches.
- Integrate reviewed work in the main checkout only when authorized. Check for remote updates and preserve other changes; stop on conflicting ownership instead of silently replacing work.
- Run checks appropriate to the change and record results and limitations. A branch or directory existing does not mean its task is finished.
- The user can override these rules and authorize integration directly.
