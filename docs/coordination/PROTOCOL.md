# Autonomous work protocol

Authorized by the user on 2026-11-11: the agents work continuously, without asking the user questions, until every task in `backlog.md` is merged. This file supplements `AGENTS.md`; where they differ, this file wins.

## Roles

| Role | Who | Works in | Pushes to |
|---|---|---|---|
| Coordinator | Claude session in the main checkout `Desktop/fortnight` | `main` | `origin` (sulaymoniy/ubiquitous-fortnight) |
| Backend builder (`claude`) | Claude session in `Desktop/fortnight/.worktrees/claude` | `claude/<task-id>-<slug>` | `origin` |
| Frontend builder (`codex`) | Codex app on the user's other machine | `codex/<task-id>-<slug>` | its fork `zfroff/ubiquitous-fortnight` (or `origin` if it has access) |

Canonical repo: `https://github.com/sulaymoniy/ubiquitous-fortnight`. Its `main` is the only source of truth for tasks.

## Files and who writes them

| File | Writer |
|---|---|
| `docs/coordination/PROTOCOL.md`, `backlog.md`, `plan.md`, `inbox/claude.md`, `inbox/codex.md` | Coordinator only (on `main`) |
| `docs/coordination/claude-task.md` | Backend builder only (on its task branch) |
| `docs/coordination/codex-task.md`, `AGENTS.md` | Frontend builder only (on its task branch) |
| Code and tests | As listed in `plan.md` section 3: `src/shared`, `src/server`, `tests/server`, `tests/contract`, root config → claude; `src/web`, `tests/web`, `tests/e2e` → codex |
| `package-lock.json` | Either builder may commit changes that `npm install` makes for packages it owns. Never hand-edit. The coordinator regenerates it if branches conflict. |

## Builder loop (claude and codex)

Repeat until your inbox says `state: done`:

1. `git fetch` the canonical repo. Read `docs/coordination/inbox/<you>.md` on its `main` (for example `git show <canonical-remote>/main:docs/coordination/inbox/codex.md`). Also re-read `PROTOCOL.md`, `backlog.md` and `plan.md` from `main` when they changed.
2. Look at the inbox `Current task` block: `task`, `revision`, `state`.
   - `state: assigned` and you have not finished this task id and revision: work on it (step 3).
   - `state: changes_requested`: apply the review notes on the same branch (step 3), as the new revision.
   - `state: waiting` or nothing new: wait 5 minutes, then go back to step 1. Do not stop the session. (Codex: run `sleep 300` in the shell. Claude: end the loop iteration; `/loop` wakes you.)
   - `state: done`: write a final status and stop.
3. Do the task:
   - Start from the latest canonical `main` (`git switch -c <branch> <canonical>/main`), or rebase your existing task branch onto it.
   - Read the task in `backlog.md` and the acceptance checks in `plan.md`. Make your own design decisions inside the contract; record assumptions in your task record instead of asking.
   - Commit in small, focused commits. Push early and push at least every 30 minutes of work, with your status set to `working`, so the coordinator can report progress.
   - Before marking ready: rebase on the latest canonical `main`, run `npm install`, `npm run typecheck`, `npm run lint`, `npm test` (and `npm run e2e` when the task says so), and `git diff --check`. All must pass.
4. Update the Status block at the top of your task record (format below) to `ready_for_review` with the exact commit SHA, commit, and push. Then go to step 1 and wait for the next inbox change.
5. If you cannot continue without a decision you are not allowed to make (contract change, ownership conflict, paid API use, anything destructive), set `state: blocked` with the exact question in `note`, push, and keep polling. Do other parts of the task meanwhile if possible.

Never: edit files you do not own, edit the coordinator's files, merge into `main`, force-push `main`, call the Anthropic API for real, commit `.env` or `data/`, or ask the user questions in chat. The user has said they will not answer; the coordinator answers through the inbox.

### Status block (top of `claude-task.md` / `codex-task.md`)

```
## Status
- task: C-002
- revision: 1
- state: working | ready_for_review | blocked | idle
- branch: claude/c-002-pages-blocks
- commit: <full SHA of the commit to review, or "-">
- updated: <ISO 8601 time>
- note: <one line: progress, what is left, or the blocking question>
```

Below the block, keep a short log per task: what was built, decisions and assumptions, test commands with results, known limitations, and any requests to the other builder or the coordinator.

## Contract changes

`src/shared` is the contract. A builder that needs a change writes it under "Contract requests" in its task record. The coordinator decides, records it in `plan.md` section 10 and assigns it (always to the backend builder, who owns `src/shared`). Codex never edits `src/shared`; it may add temporary types in `src/web/src/api/` marked `TEMP(contract)` until the change lands.

## Coordinator loop

Every tick (self-paced, about every 5–15 minutes while builders are active):

1. Fetch `origin` and the `codex` remote. Read both builders' Status blocks from their task branches.
2. Report to the user in chat: each builder's task, state, latest commit and note.
3. For each `ready_for_review` branch at the stated SHA:
   - Merge it into a scratch branch from `main`, run `npm install`, typecheck, lint, tests (and e2e when relevant), and review the diff against the task, the contract and file ownership.
   - Pass: merge into `main` (`--no-ff`), push, mark the task done in the inbox, assign the next ready task. Coordinator-only commits on `main` touch only coordinator files, plus a regenerated `package-lock.json` when needed.
   - Fail: set the inbox to `changes_requested` with a numbered list of concrete fixes, bump the revision, push.
4. Answer `blocked` questions in the inbox. Escalate to the user only for: paid API use, destructive or irreversible actions, security issues, or a disagreement between builders that the contract cannot settle.
5. When the last task is merged and the final checks pass, set both inboxes to `state: done` and report to the user.
