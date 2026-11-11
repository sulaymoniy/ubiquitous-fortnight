import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, Undo2, AlertCircle } from 'lucide-react';
import { workspaceApi } from '../api/workspace';
import { orderedChildren, orderedBlocks } from './adapter';
import { pageSession, type PageSession } from './session';
import { BlockRow } from './BlockRow';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import type { Block, GetPageResponse } from '@fortnight/shared';

function EditorBody({ data }: { data: GetPageResponse }) {
  const session = useMemo(() => pageSession(data), [data.page.id]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const workspace = useWorkspace();
  const client = useQueryClient();
  const [focus, setFocus] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  useEffect(() => { session.hydrate(data); }, [data, session]);
  useEffect(() => { if (!session.getSnapshot().blocks.length) setFocus(session.add()); }, [session]);
  useEffect(() => {
    client.setQueryData<{ pages: import('@fortnight/shared').Page[] }>(['pages'], (old) => old ? { pages: old.pages.map((page) => page.id === state.page.id ? { ...page, title: state.title } : page) } : old);
  }, [state.title, state.page.id, client]);
  async function undo() {
    try {
      await session.flush(); const id = session.getSnapshot().lastChangeset; if (!id) return;
      await workspaceApi.undo(id);
      const next = await workspaceApi.page(state.page.id);
      session.hydrate(next); workspace.refresh();
      workspace.notify('Edit undone');
    } catch (error) { workspace.notify(error instanceof Error ? error.message : 'Could not undo this edit.'); }
  }
  function moved(event: DragEndEvent) {
    if (!event.over) return;
    const id = String(event.active.id), over = String(event.over.id);
    if (over === id) return;
    if (over === 'block-root-end') session.move(id, null, orderedChildren(state.blocks.filter((b) => b.id !== id), null).at(-1)?.id ?? null);
    else if (over.startsWith('nest-block:')) {
      const parentId = over.slice(11); session.move(id, parentId, orderedChildren(state.blocks.filter((b) => b.id !== id), parentId).at(-1)?.id ?? null);
    } else {
      const target = state.blocks.find((b) => b.id === over); if (!target) return;
      const siblings = orderedChildren(state.blocks.filter((b) => b.id !== id), target.parentId);
      const index = siblings.findIndex((b) => b.id === target.id);
      session.move(id, target.parentId, siblings[index - 1]?.id ?? null);
    }
  }
  function renderChildren(parentId: string | null): React.ReactNode {
    return orderedChildren(state.blocks, parentId).map((block, index) => <BlockRow key={block.id} block={block} session={session} focusId={focus} setFocus={setFocus} index={index}>{renderChildren(block.id)}</BlockRow>);
  }
  return <article className="document-page">
    <div className="document-toolbar"><span className="eyebrow">PAGE</span><div><span className={'save-status' + (state.error ? ' failed' : '')} role="status">{state.error ? 'Unsaved changes' : state.saving ? 'Saving…' : state.dirty ? 'Unsaved changes' : 'Saved'}</span><button className="icon-button" aria-label="Undo last saved edit" disabled={!state.lastChangeset} onClick={() => void undo()}><Undo2 size={16} /></button></div></div>
    <input className="page-title" aria-label="Page title" placeholder="Untitled" maxLength={2000} value={state.title} onChange={(e) => session.setTitle(e.target.value)} />
    {state.error && <div className="save-error" role="alert"><AlertCircle size={16} /><span>{state.error}</span><button onClick={() => void session.flush().catch(() => {})}>Retry save</button></div>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={moved}><SortableContext items={orderedBlocks(state.blocks).map((b) => b.id)} strategy={verticalListSortingStrategy}><div className="block-list" aria-label="Page blocks">{renderChildren(null)}</div><RootDrop blocks={state.blocks} session={session} focus={setFocus} /></SortableContext></DndContext>
    <p className="editor-footnote">Type / for blocks · Tab to nest · Shift+Tab to move out</p>
  </article>;
}
import { useDroppable } from '@dnd-kit/core';
function RootDrop({ blocks, session, focus }: { blocks: Block[]; session: PageSession; focus: (id: string) => void }) {
  const drop = useDroppable({ id: 'block-root-end' });
  return <button ref={drop.setNodeRef} className={'add-block' + (drop.isOver ? ' over' : '')} onClick={() => focus(session.add(orderedChildren(blocks, null).at(-1)?.id ?? null, 'paragraph', null))}><Plus size={15} />Add a block</button>;
}
export function WorkspacePage() {
  const { selected } = useWorkspace();
  const page = useQuery({ queryKey: ['page', selected], queryFn: ({ signal }) => workspaceApi.page(selected!, signal), enabled: !!selected });
  if (!selected) return null;
  if (page.isPending) return <div className="document-loading" role="status" aria-label="Loading page"><span className="skeleton skeleton-heading" /><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line short" /></div>;
  if (page.isError) return <div className="document-loading"><AlertCircle size={24} /><h1>This page could not be opened.</h1><p>It may have been moved or archived. Your unsaved edits are kept.</p><button className="text-button" onClick={() => void page.refetch()}>Try again</button></div>;
  return <EditorBody key={selected} data={page.data} />;
}
