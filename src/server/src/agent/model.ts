import Anthropic from '@anthropic-ai/sdk';
import type { SendMessageRequest } from '@fortnight/shared';
import { addDays, startOfWeek, toLocal } from '../services/tz.ts';
import type { toolDefinitions } from './tools.ts';

/** One model turn, as the run loop needs it. `content` is replayed unchanged in the history. */
export interface ModelTurn {
  content: Anthropic.ContentBlockParam[];
  toolUses: { id: string; name: string; input: unknown }[];
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ModelRequest {
  model: string;
  effort: 'low' | 'medium' | 'high';
  system: string;
  tools: ReturnType<typeof toolDefinitions>;
  messages: Anthropic.MessageParam[];
  signal: AbortSignal;
  /** The user's context, for the fake model only. */
  context?: SendMessageRequest['context'];
  maxTokens?: number;
}

export interface ModelClient {
  turn(req: ModelRequest, onText: (delta: string) => void): Promise<ModelTurn>;
}

/** Thrown when a tool input could not be parsed; the caller re-issues the turn. */
export class ToolInputJsonError extends Error {}

/**
 * Real Claude client (`@anthropic-ai/sdk`). Streaming Messages API with a manual tool loop:
 * adaptive thinking with explicit effort from the profile, the fixed system prompt and tool list
 * cached as one prefix, eager tool-input streaming (inputs are validated server-side before any
 * tool runs), and server-side refusal fallback (`fallbacks: "default"`; models without fallback
 * support simply run alone). The key is read from the environment by the SDK and never logged.
 */
export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async turn(req: ModelRequest, onText: (delta: string) => void): Promise<ModelTurn> {
    const stream = this.client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens ?? 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: req.effort },
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        ...(req.tools.length ? { tools: req.tools } : {}),
        messages: req.messages as Anthropic.Beta.BetaMessageParam[],
      },
      { signal: req.signal },
    );
    stream.on('text', (delta) => onText(delta));
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIError || req.signal.aborted) throw err;
      throw new ToolInputJsonError((err as Error).message);
    }
    return {
      content: message.content as unknown as Anthropic.ContentBlockParam[],
      toolUses: message.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input })),
      stopReason: message.stop_reason ?? 'end_turn',
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}

/* ------------------------------------------------------------------ fake model */

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

function lastUserText(messages: Anthropic.MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text);
    if (text.length) return text.join('\n');
  }
  return '';
}

/** Tool results returned since the last user text message, in order. */
function toolResultsSoFar(
  messages: Anthropic.MessageParam[],
): { content: string; isError: boolean }[] {
  const out: { content: string; isError: boolean }[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user' || typeof m.content === 'string') break;
    const results = m.content.filter(
      (b) => b.type === 'tool_result',
    ) as Anthropic.ToolResultBlockParam[];
    if (!results.length) break;
    for (const r of results)
      out.unshift({ content: String(r.content ?? ''), isError: !!r.is_error });
  }
  return out;
}

/**
 * Scripted model for `AGENT_FAKE=1`: no network, deterministic. Recognizes the three example
 * prompts from plan M4.1 plus a few test hooks:
 * - "...review every Friday" → create_event (weekly, 1 h, Friday 16:00 local), then a confirmation
 * - "summarize this page" → get_page on the current page, then a summary of its text
 * - "what's on my week" → list_events for the current week, then the list
 * - "bad tool input" → an invalid create_event call, then text (tests is_error handling)
 * - "loop forever" → keeps calling list_pages (tests the iteration cap)
 * - "slow" → streams slowly (tests cancel)
 * Anything else gets an echo reply.
 */
export class FakeModelClient implements ModelClient {
  async turn(req: ModelRequest, onText: (delta: string) => void): Promise<ModelTurn> {
    const text = lastUserText(req.messages).toLowerCase();
    const results = toolResultsSoFar(req.messages);
    const ctx = req.context;
    const say = async (reply: string, chunk = 12, delay = 0): Promise<ModelTurn> => {
      for (let i = 0; i < reply.length; i += chunk) {
        if (delay) await sleep(delay, req.signal);
        if (req.signal.aborted) throw new DOMException('aborted', 'AbortError');
        onText(reply.slice(i, i + chunk));
      }
      return {
        content: [{ type: 'text', text: reply }],
        toolUses: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: reply.length },
      };
    };
    let counter = 0;
    const call = (name: string, input: unknown, preface = ''): ModelTurn => {
      const id = `toolu_fake_${req.messages.length}_${counter++}`;
      if (preface) onText(preface);
      return {
        content: [
          ...(preface ? [{ type: 'text' as const, text: preface }] : []),
          { type: 'tool_use', id, name, input },
        ],
        toolUses: [{ id, name, input }],
        stopReason: 'tool_use',
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    };
    const tz = ctx?.timeZone ?? 'UTC';
    const nowMs = ctx ? Date.parse(ctx.now) : Date.now();
    const offset = ctx?.now.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] ?? 'Z';
    const todayLocal = toLocal(nowMs, tz).date;

    if (text.includes('slow'))
      return say('This reply streams slowly so it can be cancelled. '.repeat(20), 4, 20);
    if (text.includes('loop forever')) return call('list_pages', { depth: 1 });
    if (text.includes('bad tool input')) {
      if (!results.length) return call('create_event', { title: 5 });
      return say(`The tool said: ${results[0]!.content}`);
    }
    if (text.includes('review') && text.includes('friday')) {
      if (!results.length) {
        let friday = todayLocal;
        while (new Date(`${friday}T00:00:00Z`).getUTCDay() !== 5) friday = addDays(friday, 1);
        return call(
          'create_event',
          {
            title: 'Review',
            start: `${friday}T16:00:00${offset}`,
            end: `${friday}T17:00:00${offset}`,
            recurrence: 'FREQ=WEEKLY;BYDAY=FR',
          },
          'Scheduling it. ',
        );
      }
      return say(
        results[0]!.isError
          ? `I could not create it: ${results[0]!.content}`
          : 'Done: a 1-hour "Review" every Friday at 16:00.',
      );
    }
    if (text.includes('summarize')) {
      if (!ctx?.pageId) return say('Open a page first, then ask me to summarize it.');
      if (!results.length) return call('get_page', { pageId: ctx.pageId });
      const page = JSON.parse(results[0]!.content) as {
        title?: string;
        markdown?: string;
        error?: string;
      };
      if (page.error) return say(`I could not read the page: ${page.error}`);
      const lines = (page.markdown ?? '')
        .split('\n')
        .map((l) => l.replace(/^[#>\-\s*\d.[\]x]+/, '').trim())
        .filter(Boolean);
      return say(
        `Summary of "${page.title ?? 'Untitled'}": ${lines.slice(0, 3).join(' · ') || 'the page is empty.'}`,
      );
    }
    if (text.includes('week')) {
      const start = startOfWeek(todayLocal, 1);
      if (!results.length) {
        return call('list_events', {
          from: `${start}T00:00:00${offset}`,
          to: `${addDays(start, 7)}T00:00:00${offset}`,
        });
      }
      const events = JSON.parse(results[0]!.content) as { title: string; start: string }[];
      return say(
        events.length
          ? `This week: ${events.map((e) => `${e.title} (${e.start.slice(0, 16).replace('T', ' ')})`).join('; ')}.`
          : 'Nothing on your calendar this week.',
      );
    }
    return say(`(fake model) You said: ${lastUserText(req.messages).split('\n').at(-1)}`);
  }
}
