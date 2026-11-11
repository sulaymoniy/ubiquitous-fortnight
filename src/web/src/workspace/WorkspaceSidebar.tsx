import { useState } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable, closestCenter, useDndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, FileText, GripVertical, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { positionBetween, type Page } from '@fortnight/shared';
import { descendants, orderedChildren } from '../editor/adapter';
import { useWorkspace, endPosition } from './WorkspaceProvider';
function TreeRow({ page, level, collapsed, toggle }: { page: Page; level: number; collapsed: Set<string>; toggle: (id: string) => void }) {
  const state = useWorkspace();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(page.title);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  const nest = useDroppable({ id: 'nest:' + page.id });
  const dragging = useDndContext().active !== null;
  const children = orderedChildren(state.pages, page.id);
  const invalidParents = descendants(state.pages, page.id);
  async function rename() {
    if (!renaming) return;
    setRenaming(false);
    if (title !== page.title) await state.updatePage(page.id, { title }).catch(() => {});
  }
  return <li role="treeitem" aria-expanded={children.length ? !collapsed.has(page.id) : undefined} aria-selected={state.selected === page.id}>
    <div ref={setNodeRef} className={'tree-row' + (state.selected === page.id ? ' selected' : '') + (isDragging ? ' dragging' : '')} style={{ paddingLeft: 'calc(var(--space-2) + ' + level + ' * var(--space-4))', transform: CSS.Transform.toString(transform), transition }}>
      <button className="tree-grip icon-button" aria-label={'Drag page ' + page.title} {...attributes} {...listeners}><GripVertical size={13} /></button>
      <button className="tree-chevron icon-button" aria-label={(collapsed.has(page.id) ? 'Expand ' : 'Collapse ') + page.title} onClick={() => toggle(page.id)} disabled={!children.length}><ChevronRight size={13} className={!collapsed.has(page.id) ? 'expanded' : ''} /></button>
      {renaming ? <input className="tree-rename" aria-label="Rename page" autoFocus maxLength={2000} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') { setRenaming(false); setTitle(page.title); } }} /> : <button ref={nest.setNodeRef} className={'tree-label' + (nest.isOver ? ' nesting' : '')} onClick={() => void state.navigate(page.id)} title={dragging ? 'Drop to nest here' : page.title}><FileText size={14} aria-hidden="true" /><span>{page.title || 'Untitled'}</span></button>}
      <div className="tree-actions"><button className="icon-button" aria-label={'Rename ' + page.title} onClick={() => { setTitle(page.title); setRenaming(true); }}><Pencil size={12} /></button><button className="icon-button" aria-label={'Add child page to ' + page.title} onClick={() => { if (collapsed.has(page.id)) toggle(page.id); void state.createPage(page.id); }}><Plus size={13} /></button><details className="tree-more"><summary aria-label={'Page actions for ' + page.title}>⋯</summary><div className="tree-menu"><label>Move to<select aria-label={'Parent of ' + page.title} value={page.parentId ?? ''} onChange={(e) => void state.updatePage(page.id, { parentId: e.target.value || null, position: endPosition(state.pages, e.target.value || null) }).catch(() => {})}><option value="">Top level</option>{state.pages.filter((p) => !invalidParents.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.title || 'Untitled'}</option>)}</select></label><button onClick={() => void state.archivePage(page.id)}><Trash2 size={13} />Move to trash</button></div></details></div>
    </div>
    {!!children.length && !collapsed.has(page.id) && <ul role="group">{children.map((child) => <TreeRow key={child.id} page={child} level={level + 1} collapsed={collapsed} toggle={toggle} />)}</ul>}
  </li>;
}
export function WorkspaceSidebar() {
  const state = useWorkspace();
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  async function moved(event: DragEndEvent) {
    if (!event.over) return;
    const id = String(event.active.id), target = String(event.over.id);
    if (id === target) return;
    if (target.startsWith('nest:')) {
      const parentId = target.slice(5);
      if (descendants(state.pages, id).has(parentId)) return;
      await state.updatePage(id, { parentId, position: endPosition(state.pages, parentId) }).catch(() => {});
    } else {
      const over = state.pages.find((p) => p.id === target); if (!over) return;
      if (over.parentId && descendants(state.pages, id).has(over.parentId)) return;
      const siblings = orderedChildren(state.pages.filter((p) => p.id !== id), over.parentId);
      const index = siblings.findIndex((p) => p.id === over.id);
      const position = positionBetween(siblings[index - 1]?.position ?? null, over.position);
      await state.updatePage(id, { parentId: over.parentId, position }).catch(() => {});
    }
  }
  return <div className="page-tree-section"><button className="sidebar-search" onClick={state.openSearch}><Search size={15} />Search<span>⌘ K</span></button>
    <div className="section-heading"><span className="eyebrow">YOUR PAGES</span><button className="icon-button" aria-label="Create page" onClick={() => void state.createPage()}><Plus size={16} /></button></div>
    {state.loading ? <div className="tree-loading" aria-label="Loading pages"><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line short" /></div> : state.error ? <div className="tree-empty"><p>Could not load your pages.</p><button onClick={state.refresh}>Try again</button></div> : !state.pages.length ? <div className="tree-empty"><p>A little space for your next idea.</p><button onClick={() => void state.createPage()}>Create your first page</button></div> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void moved(event)}><SortableContext items={state.pages.map((p) => p.id)}><ul className="page-tree" role="tree" aria-label="Pages">{orderedChildren(state.pages, null).map((page) => <TreeRow key={page.id} page={page} level={0} collapsed={collapsed} toggle={(id) => setCollapsed((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />)}</ul></SortableContext></DndContext>}
  </div>;
}
