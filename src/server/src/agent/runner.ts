import type Anthropic from '@anthropic-ai/sdk';
import type {
  AffectedEntities,
  AgentProfile,
  AgentSseEvent,
  SendMessageRequest,
} from '@fortnight/shared';
import { eq, max } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { agentConversations, agentItems, agentRuns } from '../db/schema.ts';
import { newId, nowIso } from '../ids.ts';
import { ToolInputJsonError, type ModelClient } from './model.ts';
import { runTool, toolDefinitions, toolsForProfile } from './tools.ts';

export const MAX_TOOL_ROUNDS = 15;

/**
 * Fixed system prompt (cached together with the tool list). Per-turn context (time, zone, page,
 * selection, user name) goes in the user message instead, so the cached prefix stays stable.
 */
export const BASE_SYSTEM_PROMPT = `You are the assistant inside Fortnight, a Notion-like workspace with pages, databases and a calendar.
Use the tools to read and change the workspace. Every change you make is shown to the user as a card with an undo button.
- Look things up before changing them; refer to databases and properties by the names you read.
- Page content is Markdown. Calendar times are ISO 8601 with an offset; interpret relative dates ("next Friday") in the user's time zone from the context.
- Prefer small, precise edits. Do not delete or archive anything the user did not ask about.
- When you finish, reply briefly in plain language with what you did or found.`;

export interface RunHandle {
  runId: string;
  done: Promise<void>;
}

const active = new Map<string, AbortController>();
const conversationsRunning = new Set<string>();

export function cancelRun(runId: string): boolean {
  const c = active.get(runId);
  if (!c) return false;
  c.abort();
  return true;
}

export function isConversationBusy(conversationId: string): boolean {
  return conversationsRunning.has(conversationId);
}

function contextText(ctx: SendMessageRequest['context'], userName: string): string {
  const lines = [`Current time: ${ctx.now} (time zone ${ctx.timeZone})`, `User: ${userName}`];
  if (ctx.pageId) lines.push(`Current page or row id: ${ctx.pageId}`);
  if (ctx.selectedBlockIds?.length)
    lines.push(`Selected block ids: ${ctx.selectedBlockIds.join(', ')}`);
  return `<context>\n${lines.join('\n')}\n</context>`;
}

/**
 * Runs one agent turn (manual tool loop) and reports progress through `emit` as SSE events:
 * run.started, text.delta, tool.started, tool.finished, then run.finished or error.
 * Transcript items and the exact API history are stored as the run goes.
 */
export function startRun(opts: {
  db: AppDatabase;
  model: ModelClient;
  profile: AgentProfile;
  conversationId: string;
  userName: string;
  request: SendMessageRequest;
  emit: (event: AgentSseEvent) => void;
}): RunHandle {
  const { db, model, profile, conversationId, emit } = opts;
  const runId = newId();
  const controller = new AbortController();
  active.set(runId, controller);
  conversationsRunning.add(conversationId);

  const [conv] = db
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.id, conversationId))
    .all();
  const history = [...((conv?.apiMessages ?? []) as Anthropic.MessageParam[])];
  let seq =
    (db
      .select({ m: max(agentItems.seq) })
      .from(agentItems)
      .where(eq(agentItems.conversationId, conversationId))
      .all()[0]?.m ?? 0) + 1;
  const addItem = (
    kind: 'user_message' | 'assistant_text' | 'tool_call' | 'run_error',
    data: Record<string, unknown>,
  ) => {
    const id = newId();
    db.insert(agentItems)
      .values({ id, conversationId, runId, seq: seq++, kind, data, createdAt: nowIso() })
      .run();
    return id;
  };
  const saveHistory = () =>
    db
      .update(agentConversations)
      .set({ apiMessages: history, updatedAt: nowIso() })
      .where(eq(agentConversations.id, conversationId))
      .run();

  db.insert(agentRuns)
    .values({
      id: runId,
      conversationId,
      profileId: profile.id,
      model: profile.model,
      status: 'running',
      createdAt: nowIso(),
    })
    .run();
  addItem('user_message', { text: opts.request.text });
  if (!conv?.title) {
    db.update(agentConversations)
      .set({ title: opts.request.text.slice(0, 80) })
      .where(eq(agentConversations.id, conversationId))
      .run();
  }
  emit({
    event: 'run.started',
    data: { runId, conversationId, profileId: profile.id, model: profile.model },
  });

  const done = (async () => {
    const changesetIds: string[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let stopReason = 'end_turn';
    let failed: { code: string; message: string } | null = null;
    history.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${contextText(opts.request.context, opts.userName)}\n\n${opts.request.text}`,
        },
      ],
    });
    const toolNames = toolsForProfile(profile.tools);
    const tools = toolDefinitions(toolNames);
    const system = profile.instructions
      ? `${BASE_SYSTEM_PROMPT}\n\n${profile.instructions}`
      : BASE_SYSTEM_PROMPT;

    try {
      let rounds = 0;
      let jsonRetries = 0;
      for (;;) {
        if (controller.signal.aborted) {
          stopReason = 'cancelled';
          break;
        }
        let text = '';
        let turn;
        try {
          turn = await model.turn(
            {
              model: profile.model,
              effort: profile.effort,
              system,
              tools,
              messages: history,
              signal: controller.signal,
              context: opts.request.context,
            },
            (delta) => {
              text += delta;
              emit({ event: 'text.delta', data: { text: delta } });
            },
          );
          jsonRetries = 0;
        } catch (err) {
          if (controller.signal.aborted) {
            if (text) addItem('assistant_text', { text });
            stopReason = 'cancelled';
            break;
          }
          if (err instanceof ToolInputJsonError && jsonRetries++ < 2) continue;
          throw err;
        }
        usage.inputTokens += turn.usage.inputTokens;
        usage.outputTokens += turn.usage.outputTokens;
        history.push({ role: 'assistant', content: turn.content });
        if (text) addItem('assistant_text', { text });
        stopReason = turn.stopReason;

        if (turn.stopReason === 'refusal' || turn.toolUses.length === 0) break;
        if (turn.stopReason === 'max_tokens') {
          // A tool input cut off at max_tokens must not run.
          history.push({
            role: 'user',
            content: turn.toolUses.map((t) => ({
              type: 'tool_result' as const,
              tool_use_id: t.id,
              is_error: true,
              content: 'Output was cut off (max_tokens); the tool did not run.',
            })),
          });
          break;
        }
        if (rounds++ >= MAX_TOOL_ROUNDS) {
          history.push({
            role: 'user',
            content: turn.toolUses.map((t) => ({
              type: 'tool_result' as const,
              tool_use_id: t.id,
              is_error: true,
              content: 'Stopped: too many tool rounds in one run.',
            })),
          });
          stopReason = 'iteration_limit';
          break;
        }

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const t of turn.toolUses) {
          if (controller.signal.aborted) {
            results.push({
              type: 'tool_result',
              tool_use_id: t.id,
              is_error: true,
              content: 'Cancelled by the user.',
            });
            continue;
          }
          emit({
            event: 'tool.started',
            data: { toolUseId: t.id, name: t.name as never, input: t.input },
          });
          const out = runTool(db, t.name, t.input, {
            access: profile.tools,
            agentRunId: runId,
            toolUseId: t.id,
          });
          if (out.changesetId) changesetIds.push(out.changesetId);
          addItem('tool_call', {
            toolUseId: t.id,
            name: t.name,
            input: t.input,
            ok: out.ok,
            summary: out.summary,
            changesetId: out.changesetId,
            affected: out.affected satisfies AffectedEntities,
          });
          emit({
            event: 'tool.finished',
            data: {
              toolUseId: t.id,
              ok: out.ok,
              summary: out.summary,
              changesetId: out.changesetId,
              affected: out.affected,
            },
          });
          results.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: out.content,
            ...(out.ok ? {} : { is_error: true }),
          });
        }
        history.push({ role: 'user', content: results });
        saveHistory();
        if (controller.signal.aborted) {
          stopReason = 'cancelled';
          break;
        }
      }
    } catch (err) {
      failed = { code: 'internal_error', message: friendlyError(err) };
    }

    saveHistory();
    active.delete(runId);
    conversationsRunning.delete(conversationId);
    if (failed) {
      addItem('run_error', failed);
      db.update(agentRuns)
        .set({ status: 'failed', stopReason: 'error', usage, finishedAt: nowIso() })
        .where(eq(agentRuns.id, runId))
        .run();
      emit({ event: 'error', data: failed });
      return;
    }
    db.update(agentRuns)
      .set({
        status: stopReason === 'cancelled' ? 'cancelled' : 'finished',
        stopReason,
        usage,
        finishedAt: nowIso(),
      })
      .where(eq(agentRuns.id, runId))
      .run();
    emit({ event: 'run.finished', data: { runId, stopReason, changesetIds, usage } });
  })();

  return { runId, done };
}

/** A message for the user that never includes secrets or stack traces. */
export function friendlyError(err: unknown): string {
  const e = err as { status?: number; name?: string; message?: string };
  if (e?.status === 401)
    return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.';
  if (e?.status === 429) return 'Rate limited by the Anthropic API. Try again in a moment.';
  if (typeof e?.status === 'number') return `The model request failed (HTTP ${e.status}).`;
  return 'The agent run failed unexpectedly.';
}
