import {
  AgentProfilesResponse,
  CancelRunResponse,
  CreateConversationRequest,
  CreateConversationResponse,
  GetConversationResponse,
  IdParams,
  InlineAiRequest,
  ListConversationsResponse,
  SendMessageRequest,
  SetDefaultProfileRequest,
  SetDefaultProfileResponse,
  UndoRunResponse,
  UpdateConversationRequest,
  UpdateConversationResponse,
  type AgentProfile,
  type AgentTranscriptItem,
  type Conversation,
} from '@fortnight/shared';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AnthropicModelClient, FakeModelClient, type ModelClient } from '../agent/model.ts';
import { getDefaultProfileId, loadProfiles, setDefaultProfileId } from '../agent/profiles.ts';
import { cancelRun, friendlyError, isConversationBusy, startRun } from '../agent/runner.ts';
import type { AppContext } from '../app.ts';
import { agentConversations, agentItems, agentRuns, changesets } from '../db/schema.ts';
import { AppError } from '../http/errors.ts';
import { newId, nowIso } from '../ids.ts';
import { blocksToMarkdown } from '../markdown/markdown.ts';
import { pageBlocks } from '../services/pages.ts';
import { undoChangesets } from '../services/undo.ts';
import { toBlock } from '../store/mappers.ts';

const RunParams = z.object({ runId: z.string().min(1).max(64) });

/** Opens a `text/event-stream` response; returns a writer that ignores a closed socket. */
function openSse(reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  return {
    send(event: string, data: unknown) {
      if (!reply.raw.writableEnded)
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!reply.raw.writableEnded) reply.raw.end();
    },
  };
}

const KEY_MISSING = {
  code: 'agent_key_missing',
  message: 'Add your Anthropic API key to .env as ANTHROPIC_API_KEY, then restart the server.',
};

export function agentRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  const { db, config } = ctx;
  const profiles = () => loadProfiles(config.agentProfilesFile);
  let realClient: ModelClient | null = null;
  /** The model client, or null when no key is set (and fake mode is off). */
  const modelClient = (): ModelClient | null => {
    if (config.agentFake) return new FakeModelClient();
    const key = (process.env.ANTHROPIC_API_KEY ?? '').trim();
    if (!key) return null;
    realClient ??= new AnthropicModelClient(key);
    return realClient;
  };
  const profileById = (id: string): AgentProfile => {
    const p = profiles().find((x) => x.id === id);
    if (!p) {
      throw new AppError(400, 'validation_error', `Unknown agent profile ${id}`, {
        in: 'body',
        issues: [{ path: ['profileId'], message: 'unknown profile' }],
      });
    }
    return p;
  };
  const toConversation = (c: typeof agentConversations.$inferSelect): Conversation => ({
    id: c.id,
    title: c.title,
    profileId: c.profileId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  });
  const getConv = (id: string) => {
    const [c] = db.select().from(agentConversations).where(eq(agentConversations.id, id)).all();
    if (!c) throw new AppError(404, 'not_found', 'Conversation not found');
    return c;
  };

  return async (app) => {
    app.get(
      '/agent/profiles',
      { schema: { response: { 200: AgentProfilesResponse } } },
      async () => {
        const list = profiles();
        return { profiles: list, defaultProfileId: getDefaultProfileId(db, list) };
      },
    );

    app.patch(
      '/agent/profiles/default',
      { schema: { body: SetDefaultProfileRequest, response: { 200: SetDefaultProfileResponse } } },
      async (request) => {
        profileById(request.body.profileId);
        setDefaultProfileId(db, request.body.profileId);
        return { defaultProfileId: request.body.profileId };
      },
    );

    app.get(
      '/agent/conversations',
      { schema: { response: { 200: ListConversationsResponse } } },
      async () => ({
        conversations: db
          .select()
          .from(agentConversations)
          .orderBy(desc(agentConversations.updatedAt), desc(agentConversations.id))
          .all()
          .map(toConversation),
      }),
    );

    app.post(
      '/agent/conversations',
      {
        schema: { body: CreateConversationRequest, response: { 200: CreateConversationResponse } },
      },
      async (request) => {
        const profileId = request.body.profileId ?? getDefaultProfileId(db, profiles());
        profileById(profileId);
        const now = nowIso();
        const id = newId();
        db.insert(agentConversations)
          .values({
            id,
            title: request.body.title ?? '',
            profileId,
            apiMessages: [],
            createdAt: now,
            updatedAt: now,
          })
          .run();
        return toConversation(getConv(id));
      },
    );

    app.get(
      '/agent/conversations/:id',
      { schema: { params: IdParams, response: { 200: GetConversationResponse } } },
      async (request) => {
        const conv = getConv(request.params.id);
        const rows = db
          .select()
          .from(agentItems)
          .where(eq(agentItems.conversationId, conv.id))
          .orderBy(asc(agentItems.seq))
          .all();
        const csIds = rows.flatMap((r) =>
          typeof r.data.changesetId === 'string' ? [r.data.changesetId] : [],
        );
        const undone = new Map(
          csIds.length
            ? db
                .select({ id: changesets.id, undoneAt: changesets.undoneAt })
                .from(changesets)
                .where(and(inArray(changesets.id, csIds), isNotNull(changesets.undoneAt)))
                .all()
                .map((c) => [c.id, c.undoneAt])
            : [],
        );
        const items = rows.map((r) => {
          const base = { id: r.id, runId: r.runId, createdAt: r.createdAt };
          if (r.kind === 'tool_call') {
            const d = r.data as Record<string, unknown>;
            return {
              ...base,
              kind: 'tool_call',
              toolUseId: d.toolUseId,
              name: d.name,
              input: d.input,
              ok: d.ok ?? null,
              summary: d.summary ?? null,
              changesetId: d.changesetId ?? null,
              affected: d.affected ?? { pageIds: [], rowIds: [], databaseIds: [] },
              undoneAt:
                typeof d.changesetId === 'string' ? (undone.get(d.changesetId) ?? null) : null,
            };
          }
          return { ...base, kind: r.kind, ...r.data };
        }) as AgentTranscriptItem[];
        return { conversation: toConversation(conv), items };
      },
    );

    app.patch(
      '/agent/conversations/:id',
      {
        schema: {
          params: IdParams,
          body: UpdateConversationRequest,
          response: { 200: UpdateConversationResponse },
        },
      },
      async (request) => {
        const conv = getConv(request.params.id);
        if (request.body.profileId) profileById(request.body.profileId);
        db.update(agentConversations)
          .set({
            title: request.body.title ?? conv.title,
            profileId: request.body.profileId ?? conv.profileId,
            updatedAt: nowIso(),
          })
          .where(eq(agentConversations.id, conv.id))
          .run();
        return toConversation(getConv(conv.id));
      },
    );

    app.post(
      '/agent/conversations/:id/messages',
      { schema: { params: IdParams, body: SendMessageRequest } },
      async (request, reply) => {
        const conv = getConv(request.params.id);
        const profile = profileById(conv.profileId);
        if (isConversationBusy(conv.id)) {
          throw new AppError(409, 'agent_busy', 'This conversation already has a running reply');
        }
        const model = modelClient();
        const sse = openSse(reply);
        if (!model) {
          sse.send('error', KEY_MISSING);
          sse.end();
          return reply;
        }
        const run = startRun({
          db,
          model,
          profile,
          conversationId: conv.id,
          userName: request.user?.name ?? 'User',
          request: request.body,
          emit: (e) => sse.send(e.event, e.data),
        });
        await run.done;
        sse.end();
        return reply;
      },
    );

    app.post(
      '/agent/runs/:runId/cancel',
      { schema: { params: RunParams, response: { 200: CancelRunResponse } } },
      async (request) => {
        const [run] = db
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.id, request.params.runId))
          .all();
        if (!run) throw new AppError(404, 'not_found', 'Run not found');
        cancelRun(run.id);
        return {};
      },
    );

    app.post(
      '/agent/runs/:runId/undo',
      { schema: { params: RunParams, response: { 200: UndoRunResponse } } },
      async (request) => {
        const [run] = db
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.id, request.params.runId))
          .all();
        if (!run) throw new AppError(404, 'not_found', 'Run not found');
        const ids = db
          .select({ id: changesets.id, undoneAt: changesets.undoneAt })
          .from(changesets)
          .where(eq(changesets.agentRunId, run.id))
          .orderBy(desc(changesets.createdAt), desc(changesets.id))
          .all()
          .filter((c) => c.undoneAt === null)
          .map((c) => c.id);
        if (ids.length) undoChangesets(db, ids, 'Undo agent run');
        return { undoneChangesetIds: ids };
      },
    );

    app.post('/ai/inline', { schema: { body: InlineAiRequest } }, async (request, reply) => {
      const body = request.body;
      const profile = profileById(getDefaultProfileId(db, profiles()));
      const model = modelClient();
      const sse = openSse(reply);
      if (!model) {
        sse.send('error', KEY_MISSING);
        sse.end();
        return reply;
      }
      const all = pageBlocks(db, body.pageId).map(toBlock);
      const chosen = body.blockIds?.length ? all.filter((b) => body.blockIds!.includes(b.id)) : all;
      const source = body.text ?? blocksToMarkdown(chosen);
      const task: Record<typeof body.action, string> = {
        write: `Write new content: ${body.instruction ?? ''}`,
        continue: 'Continue the text naturally from where it ends.',
        summarize: 'Summarize the text in a few sentences.',
        rewrite: 'Rewrite the text to read better, keeping its meaning.',
        shorter: 'Make the text shorter, keeping the key points.',
        longer: 'Expand the text with useful detail.',
        fix_grammar: 'Fix spelling and grammar; change nothing else.',
        custom: body.instruction ?? '',
      };
      const prompt = `${task[body.action]}\nReply with Markdown only, no preface.\n\n<text>\n${source}\n</text>`;
      const controller = new AbortController();
      request.raw.on('close', () => controller.abort());
      try {
        const turn = await model.turn(
          {
            model: profile.model,
            effort: 'low',
            system: 'You are a writing assistant inside a Notion-like editor.',
            tools: [],
            messages: [{ role: 'user', content: prompt }],
            signal: controller.signal,
            maxTokens: 16000,
          },
          (delta) => sse.send('text.delta', { text: delta }),
        );
        sse.send('done', { usage: turn.usage });
      } catch (err) {
        sse.send('error', { code: 'internal_error', message: friendlyError(err) });
      }
      sse.end();
      return reply;
    });
  };
}
