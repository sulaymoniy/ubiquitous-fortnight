# Fortnight

A local, single-user workspace in the style of Notion: nested pages with a block editor, databases (table, board, list, gallery and calendar views), search, an undo log for every change, and a Claude agent that can read and edit the workspace.

## Requirements

- Node.js 22.16 or newer (22.x). Nothing needs to compile: SQLite comes from Node's built-in `node:sqlite`.
- npm 10.

## Setup

```bash
npm ci
cp .env.example .env
```

Put your Anthropic API key in `.env` (optional; only the agent needs it):

```
ANTHROPIC_API_KEY=sk-ant-...
```

The key is read by the server only. It is never sent to the browser, returned by the API, or logged. Without a key the app works normally and the agent panel shows "Add your key to .env".

## Run

| Command | What it does |
|---|---|
| `npm run dev` | API on http://127.0.0.1:3001 and the web app on http://127.0.0.1:5173 (open this one), with hot reload |
| `npm run build` | Type-checks the server and builds the web app into `src/web/dist` |
| `npm start` | Production: serves the built web app and the API together on http://127.0.0.1:3001 |
| `npm run seed` | Creates the sample workspace if the database is empty (safe to run again) |

A new database is seeded automatically on the first start: a "Getting started" page with every block type, nested sample pages, and a **Calendar** database (Name, Date, Tags, Notes) with timed, all-day, multi-day and recurring events.

### Login

The login screen is a demo login: any name and any password work, and there are no accounts. Your name is shown in the app and passed to the agent. Sessions live in server memory, so restarting the server logs you out. All mock users share the one local workspace.

## Agent

Open the agent panel, pick a profile and ask, for example:

- "Schedule a 1h review every Friday"
- "Summarize this page"
- "What's on my week?"

Every change the agent makes appears as a card with an undo button, and "Undo all" reverts a whole reply.

**Profiles.** Built-in profiles:

| Profile | Model | Effort | Access |
|---|---|---|---|
| Opus 5.5, full access (default) | `claude-opus-5-5` | high | read and write |
| Sonnet 5.5, full access | `claude-sonnet-5-5` | medium | read and write |
| Haiku 5.5, read only | `claude-haiku-5-5` | low | read only |

The default profile can be changed in the app. To add your own, create `agent-profiles.json` at the repository root (it is gitignored); a profile with a built-in id replaces it:

```json
[
  {
    "id": "opus-planner",
    "name": "Opus planner",
    "description": "Plans my week",
    "provider": "anthropic",
    "model": "claude-opus-5-5",
    "effort": "high",
    "instructions": "Prefer mornings for focus work.",
    "tools": "all"
  }
]
```

**Fake model.** `AGENT_FAKE=1` replaces Claude with scripted replies (the three examples above, plus an echo). Tests and end-to-end runs use it, so they need no key and cost nothing.

## Tests and checks

```bash
npm run typecheck
npm run lint
npm test
npm run e2e
```

`npm test` runs the server and contract tests (`tests/server`, `tests/contract`) and the web tests (`tests/web`). `npm run e2e` runs the Playwright suite (`tests/e2e`); it starts its own server (with the fake model) and web app.

## Configuration

Environment variables (also read from `.env`):

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | Key for the agent |
| `AGENT_FAKE` | off | `1` = scripted fake model, no API calls |
| `PORT` / `HOST` | `3001` / `127.0.0.1` | Server address |
| `DATA_DIR` | `data` | SQLite database and uploaded images (gitignored) |
| `FORTNIGHT_TIME_ZONE` | `UTC` | Time zone of a newly seeded workspace (change it later in settings) |
| `LOG_LEVEL` | `info` | Server log level |

To start from scratch, stop the server and delete the `data` folder.

## Project layout

| Path | Contents |
|---|---|
| `src/shared` | `@fortnight/shared`: the API contract (Zod schemas and types) used by server and web |
| `src/server` | `@fortnight/server`: Fastify API, SQLite (Drizzle), search, undo log, agent |
| `src/web` | `@fortnight/web`: React app (Vite) |
| `tests/` | `server`, `contract`, `web`, `e2e` |
| `docs/coordination` | Plan, protocol and task records of the two agents that built this |
