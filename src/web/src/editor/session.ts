import { Block, positionBetween, VersionConflictDetails, type GetPageResponse, type Page, type BlockType, type RichText } from '@fortnight/shared';
import { v7 } from 'uuid';
import { workspaceApi } from '../api/workspace';
import { ApiError } from '../api/client';
import { convertBlock, descendants, diffBlocks, orderedChildren, withRich } from './adapter';

export interface DraftState {
  page: Page; title: string; blocks: Block[]; dirty: boolean; saving: boolean; error: string | null; lastChangeset: string | null;
}
type SaveApi = Pick<typeof workspaceApi, 'ops' | 'update'>;
export class PageSession {
  private base: Block[];
  private baseTitle: string;
  private revision = 0;
  private savedRevision = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: Promise<void> | null = null;
  private transport: SaveApi;
  private state: DraftState;
  constructor(data: GetPageResponse, transport: SaveApi = workspaceApi) {
    this.base = data.blocks; this.baseTitle = data.page.title; this.transport = transport;
    this.state = { page: data.page, title: data.page.title, blocks: data.blocks, dirty: false, saving: false, error: null, lastChangeset: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(patch: Partial<DraftState> = {}) {
    this.state = { ...this.state, ...patch, dirty: this.revision > this.savedRevision };
    this.listeners.forEach((listener) => listener());
  }
  hydrate(data: GetPageResponse) {
    if (this.state.dirty || this.state.saving) return;
    this.base = data.blocks; this.baseTitle = data.page.title;
    this.emit({ page: data.page, title: data.page.title, blocks: data.blocks, error: null });
  }
  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(false).catch(() => {}); }, 500);
  }
  private edit(patch: Partial<DraftState>) { this.revision++; this.emit({ ...patch, error: null }); this.schedule(); }
  setTitle(title: string) { if (title !== this.state.title) this.edit({ title }); }
  setBlock(block: Block) {
    const current = this.state.blocks.find((b) => b.id === block.id);
    if (!current || JSON.stringify(current) === JSON.stringify(block)) return;
    this.edit({ blocks: this.state.blocks.map((b) => b.id === block.id ? Block.parse(block) : b) });
  }
  add(afterId: string | null = null, type: BlockType = 'paragraph', parentId?: string | null, rich: RichText[] = []): string {
    const after = this.state.blocks.find((b) => b.id === afterId);
    const parent = parentId === undefined ? (after?.parentId ?? null) : parentId;
    const siblings = orderedChildren(this.state.blocks, parent);
    const index = after ? siblings.findIndex((b) => b.id === after.id) : -1;
    const now = new Date().toISOString();
    const block = convertBlock(Block.parse({
      id: v7(), pageId: this.state.page.id, parentId: parent,
      position: positionBetween(index >= 0 ? siblings[index]!.position : null, siblings[index + 1]?.position ?? null),
      type: 'paragraph', content: { rich }, createdAt: now, updatedAt: now,
    }), type, rich);
    this.edit({ blocks: [...this.state.blocks, block] });
    return block.id;
  }
  remove(id: string) { const removed = descendants(this.state.blocks, id); this.edit({ blocks: this.state.blocks.filter((b) => !removed.has(b.id)) }); }
  move(id: string, parentId: string | null, afterId: string | null) {
    const block = this.state.blocks.find((b) => b.id === id);
    if (!block || (parentId && descendants(this.state.blocks, id).has(parentId))) return;
    const siblings = orderedChildren(this.state.blocks.filter((b) => b.id !== id), parentId);
    const index = afterId ? siblings.findIndex((b) => b.id === afterId) : -1;
    this.setBlock({ ...block, parentId, position: positionBetween(siblings[index]?.position ?? null, siblings[index + 1]?.position ?? null) });
  }
  indent(id: string, out = false) {
    const block = this.state.blocks.find((b) => b.id === id); if (!block) return;
    if (out) {
      const parent = this.state.blocks.find((b) => b.id === block.parentId);
      if (parent) this.move(id, parent.parentId, parent.id);
    } else {
      const siblings = orderedChildren(this.state.blocks, block.parentId);
      const previous = siblings[siblings.findIndex((b) => b.id === id) - 1];
      if (previous) this.move(id, previous.id, orderedChildren(this.state.blocks, previous.id).at(-1)?.id ?? null);
    }
  }
  split(id: string, before: RichText[], after: RichText[]) {
    const block = this.state.blocks.find((b) => b.id === id); if (!block) return null;
    this.setBlock(withRich(block, before));
    return this.add(id, ['bulleted_list_item', 'numbered_list_item', 'to_do'].includes(block.type) ? block.type : 'paragraph', undefined, after);
  }
  async flush(drain = true): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.flight) { await this.flight; if (drain && this.state.dirty) return this.flush(); return; }
    if (!this.state.dirty) return;
    this.flight = this.save();
    try { await this.flight; } finally { this.flight = null; }
    if (this.state.dirty) { if (drain) return this.flush(); this.schedule(); }
  }
  private async save() {
    const revision = this.revision;
    const desired = this.state.blocks;
    const title = this.state.title;
    const titleChanged = title !== this.baseTitle;
    let page = this.state.page;
    let lastChangeset = this.state.lastChangeset;
    this.emit({ saving: true, error: null });
    try {
      const ops = diffBlocks(this.base, desired);
      if (ops.length > 500) throw new Error('This edit is too large to save at once. Please undo part of it and retry.');
      if (ops.length) {
        const result = await this.transport.ops(page.id, ops);
        page = result.page; lastChangeset = result.changesetId;
        const touched = new Map(result.blocks.map((block) => [block.id, block]));
        this.base = desired.map((block) => touched.get(block.id) ?? block);
        this.baseTitle = page.title;
        this.emit({ page });
      } else this.base = desired;
      if (titleChanged) {
        page = await this.transport.update(page.id, { version: page.version, title });
        this.baseTitle = page.title;
      }
      this.savedRevision = revision;
      const unchanged = this.revision === revision;
      this.emit({ page, saving: false, lastChangeset, ...(unchanged ? { blocks: this.base, title: page.title } : {}) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const conflict = VersionConflictDetails.safeParse(error.details);
        if (conflict.success && conflict.data.entity === 'page') page = conflict.data.current;
      }
      const message = error instanceof ApiError && error.status === 401 ? 'Your session expired. Sign in again; your unsaved edits are kept.'
        : error instanceof Error ? error.message : 'Could not save. Your edits are kept; try again.';
      this.emit({ page, saving: false, error: message });
      throw error;
    }
  }
  dispose() { if (this.timer) clearTimeout(this.timer); this.listeners.clear(); }
}
const sessions = new Map<string, PageSession>();
export function pageSession(data: GetPageResponse) {
  let session = sessions.get(data.page.id);
  if (!session) { session = new PageSession(data); sessions.set(data.page.id, session); }
  return session;
}
export function activeSession(id: string | null) { return id ? sessions.get(id) : undefined; }
export async function flushSessions() { for (const session of sessions.values()) await session.flush(); }
export function clearSessions() { sessions.forEach((session) => session.dispose()); sessions.clear(); }
export function hasDirtySessions() { return [...sessions.values()].some((session) => session.getSnapshot().dirty); }
