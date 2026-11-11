import { BUILT_IN_PROFILES, MAX_TOOL_ROUNDS, SEED_IDS, type ModelClient } from '@fortnight/server';
import {
  AGENT_SSE_EVENTS,
  AgentProfilesResponse,
  ApiError,
  CalendarEventsResponse,
  CreateConversationResponse,
  GetConversationResponse,
  INLINE_AI_ACTIONS,
  INLINE_SSE_EVENTS,
  ListChangesetsResponse,
  MUTATING_AGENT_TOOLS,
  SetDefaultProfileResponse,
  UndoRunResponse,
  UpdateConversationResponse,
  type AgentSseEventName,
} from '@fortnight/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startRun } from '../../src/server/src/agent/runner.ts';
import { runTool, toolsForProfile } from '../../src/server/src/agent/tools.ts';
import { client, contentSnapshot } from './api-helpers.ts';
import { createTestApp, login, type TestContext } from './helpers.ts';

const CONTEXT = { now: '2026-11-11T17:00:00+05:00', timeZone: 'Asia/Tashkent' };

type Ev = { event: string; data: Record<string, unknown> };
function parseSse(body: string): Ev[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const event = /^event: (.+)$/m.exec(chunk)?.[1] ?? '';
      const data = JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? '{}') as Record<string, unknown>;
      return { event, data };
    });
}

let t: TestContext;
let api: ReturnType<typeof client>;
let cookie: string;

async function newConversation(profileId?: string) {
  return api.ok(
    CreateConversationResponse,
    'POST',
    '/api/agent/conversations',
    profileId ? { profileId } : {},
  );
}
async function send(conversationId: string, text: string, extra: Record<string, unknown> = {}) {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/agent/conversations/${conversationId}/messages`,
    headers: { cookie },
    payload: { text, context: { ...CONTEXT, ...extra } },
  });
  expect(res.headers['content-type']).toContain('text/event-stream');
  const events = parseSse(res.body);
  // Every event matches its contract schema; the last one ends the run.
  for (const e of events) AGENT_SSE_EVENTS[e.event as AgentSseEventName].parse(e.data);
  expect(['run.finished', 'error']).toContain(events.at(-1)?.event);
  return events;
}
const textOf = (events: Ev[]) =>
  events
    .filter((e) => e.event === 'text.delta')
    .map((e) => e.data.text)
    .join('');

describe('agent (fake model)', () => {
  beforeEach(async () => {
    t = await createTestApp({ seed: true, fakeAgent: true });
    cookie = await login(t.app);
    api = client(t.app, cookie);
  });
  afterEach(async () => {
    await t.close();
  });

  it('lists built-in profiles and stores the default', async () => {
    const list = await api.ok(AgentProfilesResponse, 'GET', '/api/agent/profiles');
    expect(list.profiles.map((p) => [p.id, p.model, p.effort, p.tools])).toEqual([
      ['opus-full', 'claude-opus-5-5', 'high', 'all'],
      ['sonnet-full', 'claude-sonnet-5-5', 'medium', 'all'],
      ['haiku-read', 'claude-haiku-5-5', 'low', 'read_only'],
    ]);
    expect(list.defaultProfileId).toBe('opus-full');
    await api.ok(SetDefaultProfileResponse, 'PATCH', '/api/agent/profiles/default', {
      profileId: 'sonnet-full',
    });
    expect((await newConversation()).profileId).toBe('sonnet-full');
    const bad = await api.call('PATCH', '/api/agent/profiles/default', { profileId: 'nope' });
    expect(bad.status).toBe(400);
  });

  it('"schedule a 1h review every Friday" creates a recurring event as one agent changeset', async () => {
    const conv = await newConversation();
    const events = await send(conv.id, 'Schedule a 1h review every Friday');
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining([
        'run.started',
        'text.delta',
        'tool.started',
        'tool.finished',
        'run.finished',
      ]),
    );
    const finished = events.find((e) => e.event === 'tool.finished')!.data;
    expect(finished).toMatchObject({ ok: true, affected: { databaseIds: [SEED_IDS.calendarDb] } });
    const runId = events[0]!.data.runId as string;
    const done = events.at(-1)!.data;
    expect(done.changesetIds).toEqual([finished.changesetId]);

    const cs = await api.ok(ListChangesetsResponse, 'GET', `/api/changesets?agentRunId=${runId}`);
    expect(cs.changesets).toHaveLength(1);
    expect(cs.changesets[0]).toMatchObject({
      source: 'agent',
      label: 'Agent: create_event',
      agentRunId: runId,
    });

    const cal = await api.ok(
      CalendarEventsResponse,
      'GET',
      `/api/calendar/events?from=${encodeURIComponent('2026-11-16T00:00:00+05:00')}&to=${encodeURIComponent('2026-11-30T00:00:00+05:00')}`,
    );
    const reviews = cal.events.filter((e) => e.title === 'Review');
    // The test workspace is in UTC; compare instants (16:00 in UTC+5 = 11:00Z).
    expect(reviews.map((e) => Date.parse(e.occurrenceStart))).toEqual([
      Date.parse('2026-11-20T16:00:00+05:00'),
      Date.parse('2026-11-27T16:00:00+05:00'),
    ]);
    expect(reviews[0]!.recurrence).toBe('FREQ=WEEKLY;BYDAY=FR');
  });

  it('"summarize this page" reads the current page', async () => {
    const conv = await newConversation();
    const events = await send(conv.id, 'Summarize this page', { pageId: SEED_IDS.gettingStarted });
    expect(events.find((e) => e.event === 'tool.started')?.data.name).toBe('get_page');
    expect(textOf(events)).toContain('Welcome to Fortnight');
  });

  it('"what\'s on my week?" lists this week\'s events', async () => {
    const conv = await newConversation();
    const events = await send(conv.id, "What's on my week?");
    expect(events.find((e) => e.event === 'tool.started')?.data.name).toBe('list_events');
    expect(textOf(events)).toContain('Weekly review');
  });

  it('undoing a run restores the exact prior state', async () => {
    const before = contentSnapshot(t.db);
    const conv = await newConversation();
    const events = await send(conv.id, 'Schedule a 1h review every Friday');
    expect(contentSnapshot(t.db)).not.toEqual(before);
    const runId = events[0]!.data.runId as string;
    const undo = await api.ok(UndoRunResponse, 'POST', `/api/agent/runs/${runId}/undo`);
    expect(undo.undoneChangesetIds).toHaveLength(1);
    expect(contentSnapshot(t.db)).toEqual(before);
    // The transcript shows the tool call as undone; undoing again changes nothing.
    const got = await api.ok(GetConversationResponse, 'GET', `/api/agent/conversations/${conv.id}`);
    const call = got.items.find((i) => i.kind === 'tool_call');
    expect(call && 'undoneAt' in call && call.undoneAt).toBeTruthy();
    expect(
      (await api.ok(UndoRunResponse, 'POST', `/api/agent/runs/${runId}/undo`)).undoneChangesetIds,
    ).toEqual([]);
  });

  it('returns invalid tool input to the model as an error and continues', async () => {
    const conv = await newConversation();
    const events = await send(conv.id, 'bad tool input please');
    const finished = events.find((e) => e.event === 'tool.finished')!.data;
    expect(finished.ok).toBe(false);
    expect(String(finished.summary)).toContain('Invalid input');
    expect(textOf(events)).toContain('Invalid input');
    expect(events.at(-1)!.event).toBe('run.finished');
  });

  it(`stops after ${MAX_TOOL_ROUNDS} tool rounds`, async () => {
    const conv = await newConversation();
    const events = await send(conv.id, 'loop forever');
    expect(events.filter((e) => e.event === 'tool.finished')).toHaveLength(MAX_TOOL_ROUNDS);
    expect(events.at(-1)!.data.stopReason).toBe('iteration_limit');
    // The stored history stays valid: the next message works.
    const next = await send(conv.id, 'hello again');
    expect(next.at(-1)!.data.stopReason).toBe('end_turn');
  });

  it('cancels a running reply', async () => {
    const conv = await newConversation();
    const pending = t.app.inject({
      method: 'POST',
      url: `/api/agent/conversations/${conv.id}/messages`,
      headers: { cookie },
      payload: { text: 'slow please', context: CONTEXT },
    });
    let runId: string | undefined;
    for (let i = 0; i < 200 && !runId; i++) {
      await new Promise((r) => setTimeout(r, 10));
      runId = (
        t.db.$client.prepare("SELECT id FROM agent_runs WHERE status = 'running'").get() as
          { id: string } | undefined
      )?.id;
    }
    expect(runId).toBeTruthy();
    const busy = await api.call('POST', `/api/agent/conversations/${conv.id}/messages`, {
      text: 'x',
      context: CONTEXT,
    });
    expect(busy.status).toBe(409);
    expect(ApiError.parse(busy.body).error.code).toBe('agent_busy');
    await api.call('POST', `/api/agent/runs/${runId}/cancel`);
    const events = parseSse((await pending).body);
    expect(events.at(-1)).toMatchObject({
      event: 'run.finished',
      data: { stopReason: 'cancelled' },
    });
  });

  it('a read-only profile cannot run mutating tools', async () => {
    const conv = await newConversation('haiku-read');
    const before = contentSnapshot(t.db);
    const events = await send(conv.id, 'Schedule a 1h review every Friday');
    const finished = events.find((e) => e.event === 'tool.finished')!.data;
    expect(finished.ok).toBe(false);
    expect(String(finished.summary)).toContain('read-only');
    expect(contentSnapshot(t.db)).toEqual(before);
    expect(
      toolsForProfile('read_only').some((n) =>
        (MUTATING_AGENT_TOOLS as readonly string[]).includes(n),
      ),
    ).toBe(false);
  });

  it('switching the profile mid-conversation applies to the next message', async () => {
    const conv = await newConversation();
    const first = await send(conv.id, 'hi');
    expect(first[0]!.data.model).toBe('claude-opus-5-5');
    await api.ok(UpdateConversationResponse, 'PATCH', `/api/agent/conversations/${conv.id}`, {
      profileId: 'sonnet-full',
    });
    const second = await send(conv.id, 'hi again');
    expect(second[0]!.data).toMatchObject({ model: 'claude-sonnet-5-5', profileId: 'sonnet-full' });
    const got = await api.ok(GetConversationResponse, 'GET', `/api/agent/conversations/${conv.id}`);
    expect(got.items.filter((i) => i.kind === 'user_message')).toHaveLength(2);
    expect(got.conversation.title).toBe('hi');
  });

  it('streams inline AI for every action', async () => {
    for (const action of INLINE_AI_ACTIONS) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/ai/inline',
        headers: { cookie },
        payload: { action, pageId: SEED_IDS.gettingStarted, instruction: 'Be brief' },
      });
      const events = parseSse(res.body);
      for (const e of events) INLINE_SSE_EVENTS[e.event as 'done'].parse(e.data);
      expect(events.at(-1)?.event, action).toBe('done');
      expect(events.some((e) => e.event === 'text.delta')).toBe(true);
    }
  });

  it('tools resolve property and option names, creating missing options', () => {
    const out = runTool(
      t.db,
      'create_row',
      {
        databaseId: SEED_IDS.calendarDb,
        title: 'Lunch',
        properties: { tags: ['Personal', 'Food'], DATE: { start: '2026-11-12' } },
      },
      { access: 'all', agentRunId: 'run-x', toolUseId: 'tool-x' },
    );
    expect(out.ok).toBe(true);
    expect(out.content).toContain('Created option \\"Food\\"');
    const q = runTool(
      t.db,
      'query_database',
      {
        databaseId: SEED_IDS.calendarDb,
        filter: { property: 'Tags', op: 'contains', value: 'food' },
      },
      { access: 'all', agentRunId: 'run-x', toolUseId: 'tool-y' },
    );
    expect(JSON.parse(q.content).rows.map((r: { title: string }) => r.title)).toEqual(['Lunch']);
    const bad = runTool(
      t.db,
      'create_row',
      { databaseId: SEED_IDS.calendarDb, title: 'x', properties: { Nope: 1 } },
      { access: 'all', agentRunId: 'r', toolUseId: 't' },
    );
    expect(bad.ok).toBe(false);
    expect(bad.summary).toContain('Valid names: Name, Date, Tags, Notes');
  });
});

describe('agent without a key', () => {
  beforeEach(async () => {
    t = await createTestApp({ seed: true });
    cookie = await login(t.app);
    api = client(t.app, cookie);
  });
  afterEach(async () => {
    await t.close();
  });

  it('answers with a clear "add your key" error instead of failing', async () => {
    const conv = await newConversation();
    const events = await send(conv.id, 'hello');
    expect(events).toEqual([
      {
        event: 'error',
        data: { code: 'agent_key_missing', message: expect.stringContaining('ANTHROPIC_API_KEY') },
      },
    ]);
  });
});

describe('model requests per profile', () => {
  beforeEach(async () => {
    t = await createTestApp({ seed: true });
  });
  afterEach(async () => {
    await t.close();
  });

  it('each built-in profile sends its own model, effort and tool set, with a cached system prompt', async () => {
    for (const profile of BUILT_IN_PROFILES) {
      const seen: Parameters<ModelClient['turn']>[0][] = [];
      const model: ModelClient = {
        async turn(req) {
          seen.push(req);
          return {
            content: [{ type: 'text', text: 'ok' }],
            toolUses: [],
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      };
      const conv = await client(t.app, await login(t.app)).ok(
        CreateConversationResponse,
        'POST',
        '/api/agent/conversations',
        {
          profileId: profile.id,
        },
      );
      const run = startRun({
        db: t.db,
        model,
        profile,
        conversationId: conv.id,
        userName: 'Ada',
        request: { text: 'hi', context: CONTEXT },
        emit: () => {},
      });
      await run.done;
      expect(seen[0]).toMatchObject({ model: profile.model, effort: profile.effort });
      const names = seen[0]!.tools.map((x) => x.name);
      expect(names).toEqual(toolsForProfile(profile.tools));
      expect(seen[0]!.system).not.toContain(CONTEXT.now); // per-turn context stays out of the cached prefix
      expect(JSON.stringify(seen[0]!.messages)).toContain(CONTEXT.now);
    }
  });
});
