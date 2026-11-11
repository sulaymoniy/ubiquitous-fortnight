import {
  AgentProfilesResponse, CreateConversationResponse, UpdateConversationResponse, GetConversationResponse, ListConversationsResponse,
  SetDefaultProfileResponse, CancelRunResponse, UndoRunResponse, SendMessageRequest, InlineAiRequest, AGENT_SSE_EVENTS, INLINE_SSE_EVENTS,
  type AgentSseEvent, type InlineSseEvent, GetWorkspaceResponse,
} from '@fortnight/shared';
import { request, ApiError, unauthorizedEvent } from './client';

export async function readSse(response: Response, receive: (event: string, data: unknown) => void) {
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(unauthorizedEvent));
    throw new ApiError(response.status, 'stream_error', 'The assistant could not connect. Please try again.');
  }
  if (!response.body) throw new Error('The assistant returned an empty stream.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', event = '', data: string[] = [], completed = false;
  function line(value: string) {
    const text = value.replace(/\r$/, '');
    if (!text) {
      if (data.length) { receive(event || 'message', JSON.parse(data.join('\n')) as unknown); if (['run.finished', 'error', 'done'].includes(event)) completed = true; }
      event = ''; data = []; return;
    }
    if (text.startsWith('event:')) event = text.slice(6).trim();
    if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, ''));
  }
  try {
    for (;;) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      let split: number;
      while ((split = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, split)); buffer = buffer.slice(split + 1); }
      if (next.done) break;
    }
    if (buffer) line(buffer);
    if (data.length) line('');
    if (!completed) throw new Error('The connection ended before the reply finished. Reopen the conversation to recover saved messages.');
  } finally { reader.releaseLock(); }
}
async function stream(path: string, body: unknown, receive: (name: string, value: unknown) => void, signal?: AbortSignal) {
  const response = await fetch('/api' + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal });
  await readSse(response, receive);
}
export const agentApi = {
  profiles: () => request('/agent/profiles', AgentProfilesResponse),
  conversations: () => request('/agent/conversations', ListConversationsResponse),
  conversation: (id: string) => request('/agent/conversations/' + encodeURIComponent(id), GetConversationResponse),
  create: (profileId: string, title?: string) => request('/agent/conversations', CreateConversationResponse, { method: 'POST', body: JSON.stringify({ profileId, title }) }),
  profile: (id: string, profileId: string) => request('/agent/conversations/' + encodeURIComponent(id), UpdateConversationResponse, { method: 'PATCH', body: JSON.stringify({ profileId }) }),
  defaultProfile: (profileId: string) => request('/agent/profiles/default', SetDefaultProfileResponse, { method: 'PATCH', body: JSON.stringify({ profileId }) }),
  cancel: (id: string) => request('/agent/runs/' + encodeURIComponent(id) + '/cancel', CancelRunResponse, { method: 'POST' }),
  undoRun: (id: string) => request('/agent/runs/' + encodeURIComponent(id) + '/undo', UndoRunResponse, { method: 'POST' }),
  workspace: () => request('/workspace', GetWorkspaceResponse),
  send: (id: string, body: SendMessageRequest, receive: (event: AgentSseEvent) => void, signal?: AbortSignal) => stream('/agent/conversations/' + encodeURIComponent(id) + '/messages', SendMessageRequest.parse(body), (name, value) => {
    if (Object.hasOwn(AGENT_SSE_EVENTS, name)) { const event = name as keyof typeof AGENT_SSE_EVENTS; receive({ event, data: AGENT_SSE_EVENTS[event].parse(value) } as AgentSseEvent); }
  }, signal),
  inline: (body: InlineAiRequest, receive: (event: InlineSseEvent) => void, signal?: AbortSignal) => stream('/ai/inline', InlineAiRequest.parse(body), (name, value) => {
    if (Object.hasOwn(INLINE_SSE_EVENTS, name)) { const event = name as keyof typeof INLINE_SSE_EVENTS; receive({ event, data: INLINE_SSE_EVENTS[event].parse(value) } as InlineSseEvent); }
  }, signal),
};
