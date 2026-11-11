import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Send, Square, Undo2, Sparkles } from 'lucide-react';
import type { AgentSseEvent, AgentTranscriptItem } from '@fortnight/shared';
import { agentApi } from '../api/agent';
import { api } from '../api/client';
import { workspaceApi } from '../api/workspace';
import { flushSessions } from '../editor/session';
import { useWorkspace } from '../workspace/WorkspaceProvider';

export function AgentPanel({ hidden, close }: { hidden: boolean; close: () => void }) {
  const client = useQueryClient(), workspace = useWorkspace();
  const profiles = useQuery({ queryKey: ['agent-profiles'], queryFn: agentApi.profiles });
  const chats = useQuery({ queryKey: ['conversations'], queryFn: agentApi.conversations });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.health() });
  const settings = useQuery({ queryKey: ['workspace'], queryFn: agentApi.workspace });
  const [conversation, setConversation] = useState<string | null>(null), [profile, setProfile] = useState('');
  const [draft, setDraft] = useState(''), [items, setItems] = useState<AgentTranscriptItem[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [run, setRun] = useState<{ id: string; changes: string[]; usage?: { inputTokens: number; outputTokens: number } } | null>(null);
  const transcript = useQuery({ queryKey: ['conversation', conversation], queryFn: () => agentApi.conversation(conversation!), enabled: !!conversation });
  const controller = useRef<AbortController | null>(null), currentRun = useRef<string | null>(null), selection = useRef<string[]>([]);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!busy && transcript.data) { setItems(transcript.data.items); setProfile(transcript.data.conversation.profileId); } }, [transcript.data]);
  useEffect(() => { if (!profile && profiles.data) setProfile(profiles.data.defaultProfileId); }, [profiles.data, profile]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [items]);
  useEffect(() => {
    selection.current = [];
    const capture = () => { const selected = window.getSelection(); const node = selected?.anchorNode?.parentElement?.closest<HTMLElement>('[data-block-id]'); if (node?.dataset.blockId) selection.current = [node.dataset.blockId]; };
    document.addEventListener('selectionchange', capture);
    return () => document.removeEventListener('selectionchange', capture);
  }, [workspace.selected]);
  useEffect(() => () => { if (currentRun.current) void agentApi.cancel(currentRun.current).catch(() => {}); controller.current?.abort(); }, []);
  function refresh() {
    void client.invalidateQueries({ queryKey: ['pages'] });
    void client.invalidateQueries({ queryKey: ['page'] });
    void client.invalidateQueries({ queryKey: ['row'] });
    void client.invalidateQueries({ queryKey: ['rows'] });
    void client.invalidateQueries({ queryKey: ['database'] });
    void client.invalidateQueries({ queryKey: ['databases'] });
    void client.invalidateQueries({ queryKey: ['calendar'] });
  }
  async function reload(id: string) {
    const result = await client.fetchQuery({ queryKey: ['conversation', id], queryFn: () => agentApi.conversation(id) });
    setItems(result.items); void client.invalidateQueries({ queryKey: ['conversations'] });
  }
  function receive(event: AgentSseEvent) {
    const now = new Date().toISOString();
    switch (event.event) {
      case 'run.started':
        currentRun.current = event.data.runId; setRun({ id: event.data.runId, changes: [] }); break;
      case 'text.delta': {
        const text = event.data.text;
        setItems((old) => { const last = old.at(-1); return last?.kind === 'assistant_text' && last.runId === currentRun.current ? [...old.slice(0, -1), { ...last, text: last.text + text }] : [...old, { kind: 'assistant_text', id: crypto.randomUUID(), runId: currentRun.current ?? 'pending', text, createdAt: now }]; }); break;
      }
      case 'tool.started': {
        const data = event.data;
        setItems((old) => [...old, { kind: 'tool_call', id: crypto.randomUUID(), runId: currentRun.current ?? 'pending', toolUseId: data.toolUseId, name: data.name, input: data.input, ok: null, summary: null, changesetId: null, affected: { pageIds: [], rowIds: [], databaseIds: [] }, undoneAt: null, createdAt: now }]); break;
      }
      case 'tool.finished': {
        const data = event.data;
        setItems((old) => old.map((item) => item.kind === 'tool_call' && item.toolUseId === data.toolUseId ? { ...item, ok: data.ok, summary: data.summary, changesetId: data.changesetId, affected: data.affected } : item));
        if (data.changesetId) setRun((old) => old ? { ...old, changes: [...old.changes, data.changesetId!] } : old);
        refresh(); break;
      }
      case 'run.finished':
        setRun({ id: event.data.runId, changes: event.data.changesetIds, usage: event.data.usage }); currentRun.current = null; refresh(); break;
      case 'error':
        setError(event.data.message); currentRun.current = null; break;
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault(); if (!draft.trim() || busy) return;
    const text = draft.trim(); setError(''); setBusy(true);
    try {
      await flushSessions();
      let id = conversation;
      if (!id) { const created = await agentApi.create(profile || profiles.data!.defaultProfileId, text.slice(0, 80)); id = created.id; setConversation(id); }
      setDraft(''); setItems((old) => [...old, { kind: 'user_message', id: crypto.randomUUID(), runId: 'pending', text, createdAt: new Date().toISOString() }]);
      controller.current = new AbortController();
      await agentApi.send(id, { text, context: { ...(workspace.selected ? { pageId: workspace.selected } : {}), selectedBlockIds: selection.current, now: new Date().toISOString(), timeZone: settings.data?.settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone } }, receive, controller.current.signal);
      await reload(id);
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : 'The assistant could not respond. Try again.'); }
    finally { setBusy(false); controller.current = null; currentRun.current = null; }
  }
  async function undo(changeId: string, all = false) {
    try { await flushSessions(); if (all) await agentApi.undoRun(changeId); else await workspaceApi.undo(changeId); refresh(); if (conversation) await reload(conversation); if (all) setRun(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not undo this change.'); }
  }
  async function switchProfile(id: string) {
    try { if (conversation) await agentApi.profile(conversation, id); setProfile(id); void client.invalidateQueries({ queryKey: ['conversation', conversation] }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not switch profile.'); }
  }
  const selectedProfile = profiles.data?.profiles.find((p) => p.id === profile);
  return <aside className="assistant-panel agent-panel" hidden={hidden} aria-label={hidden ? undefined : 'Assistant'}>
    <header className="panel-title"><span><Sparkles size={14} />Assistant</span><div><button className="icon-button" aria-label="New chat" disabled={busy} onClick={() => { setConversation(null); setItems([]); setRun(null); setError(''); }}><Plus size={16} /></button><button className="icon-button" aria-label="Close assistant" onClick={close}><X size={16} /></button></div></header>
    <div className="agent-controls"><label className="visually-hidden" htmlFor="agent-profile">Agent profile</label><select id="agent-profile" value={profile} disabled={busy} onChange={(e) => void switchProfile(e.target.value)}>{profiles.data?.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.tools === 'read_only' ? ' · Read only' : ''}</option>)}</select>
      {selectedProfile && <small>{selectedProfile.model}{selectedProfile.tools === 'read_only' ? ' · Read only' : ''}</small>}
      <button className="agent-text-button" disabled={!profile || busy || profiles.data?.defaultProfileId === profile} onClick={() => void agentApi.defaultProfile(profile).then(() => client.invalidateQueries({ queryKey: ['agent-profiles'] })).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not set default.'))}>Set as default</button>
      <select aria-label="Earlier chats" disabled={busy} value={conversation ?? ''} onChange={(e) => { setItems([]); setRun(null); setError(''); setConversation(e.target.value || null); }}><option value="">New conversation</option>{chats.data?.conversations.map((chat) => <option key={chat.id} value={chat.id}>{chat.title || 'Untitled chat'}</option>)}</select>
    </div>
    <div className="agent-messages" ref={scroll} aria-live="polite">
      {!items.length && <div className="agent-welcome"><Sparkles size={28} /><h2>A little help with your workspace.</h2><p>Ask me to write, find a note, or plan your week.</p></div>}
      {items.map((item) => item.kind === 'tool_call' ? <article className="tool-card" key={item.id} data-tool-id={item.toolUseId}><header><strong>{item.name.replaceAll('_', ' ')}</strong><span>{item.undoneAt ? 'Undone' : item.ok === null ? 'Working…' : item.ok ? 'Done' : 'Failed'}</span></header><details><summary>Input</summary><pre>{JSON.stringify(item.input, null, 2)}</pre></details>{item.summary && <p>{item.summary}</p>}{item.changesetId && !item.undoneAt && <button disabled={busy} onClick={() => void undo(item.changesetId!)}><Undo2 size={13} />Undo</button>}</article> : item.kind === 'run_error' ? <p className="error" key={item.id}>{item.message}</p> : <div className={'chat-message ' + (item.kind === 'user_message' ? 'from-user' : 'from-assistant')} key={item.id}><span>{item.kind === 'user_message' ? 'You' : 'Assistant'}</span><p>{item.text}</p></div>)}
      {busy && <p className="agent-thinking" role="status">Working on it…</p>}
    </div>
    {run && <div className="agent-run">{run.usage && <small>{run.usage.inputTokens + run.usage.outputTokens} tokens</small>}{!!run.changes.length && <button disabled={busy} onClick={() => void undo(run.id, true)}><Undo2 size={13} />Undo all</button>}{busy && <button onClick={() => { if (currentRun.current) void agentApi.cancel(currentRun.current).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not stop this run.')); }}><Square size={12} />Stop</button>}</div>}
    {error && <p className="agent-error" role="alert">{error}</p>}
    {profiles.isError && <p className="agent-error" role="alert">Profiles could not load. <button onClick={() => void profiles.refetch()}>Try again</button></p>}
    {health.data?.agentKeyConfigured === false ? <div className="agent-key-notice">Add your key to .env<br /><small>Set ANTHROPIC_API_KEY on the server, then restart it.</small></div> : <form className="agent-composer" onSubmit={(e) => void send(e)}><textarea aria-label="Message assistant" placeholder="Ask about your workspace…" value={draft} maxLength={20000} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(e); } }} disabled={busy} /><button type="submit" aria-label="Send message" disabled={busy || !draft.trim() || !profiles.data}><Send size={16} /></button></form>}
  </aside>;
}
