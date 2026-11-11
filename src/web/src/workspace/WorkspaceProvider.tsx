import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Page,
  type Block,
  positionAfterLast,
  type CreatePageRequest,
} from '@fortnight/shared';
import { workspaceApi } from '../api/workspace';
import { activeSession, flushSessions, hasDirtySessions } from '../editor/session';
import { useShell } from '../store';
type Notice = { text: string; undo?: () => Promise<void> };
interface WorkspaceState {
  selected: string | null;
  pages: Page[];
  loading: boolean;
  error: unknown;
  searchOpen: boolean;
  navigate: (id: string | null) => Promise<void>;
  createPage: (parentId?: string | null) => Promise<void>;
  updatePage: (
    id: string,
    patch: { title?: string; parentId?: string | null; position?: string },
  ) => Promise<void>;
  archivePage: (id: string) => Promise<void>;
  refresh: () => void;
  notify: (text: string, undo?: () => Promise<void>) => void;
  openSearch: () => void;
  closeSearch: () => void;
}
const Context = createContext<WorkspaceState | null>(null);
function selectedFromUrl() {
  const match = window.location.hash.match(/^#page\/(.+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(selectedFromUrl);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const pages = useQuery({
    queryKey: ['pages'],
    queryFn: ({ signal }) => workspaceApi.pages(signal),
  });
  const notify = useCallback(
    (text: string, undo?: () => Promise<void>) => setNotice({ text, ...(undo ? { undo } : {}) }),
    [],
  );
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['pages'] });
  }, [client]);
  const navigate = useCallback(
    async (id: string | null) => {
      try {
        await activeSession(selected)?.flush();
        refresh();
        setSelected(id);
        window.history.pushState(null, '', id ? '#page/' + encodeURIComponent(id) : '#workspace');
        useShell.setState({ sidebarOpen: false });
      } catch (error) {
        notify(
          error instanceof Error ? error.message : 'Save your changes before leaving this page.',
        );
      }
    },
    [selected, refresh, notify],
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    const leave = (event: BeforeUnloadEvent) => {
      if (hasDirtySessions()) {
        event.preventDefault();
      }
    };
    const history = () => {
      const next = selectedFromUrl();
      if (next !== selected) void navigate(next);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', leave);
    window.addEventListener('popstate', history);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('popstate', history);
    };
  }, [selected, navigate]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.undo ? 12000 : 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function createPage(parentId: string | null = null) {
    try {
      await flushSessions();
      const siblings =
        pages.data?.pages.filter((page) => page.parentId === parentId && !page.archivedAt) ?? [];
      const last = siblings.sort((a, b) => (a.position < b.position ? -1 : 1)).at(-1);
      const body: CreatePageRequest = {
        title: 'Untitled',
        parentId,
        ...(last ? { afterId: last.id } : {}),
      };
      const page = await workspaceApi.create(body);
      client.setQueryData(['pages'], { pages: [...(pages.data?.pages ?? []), page] });
      await navigate(page.id);
      notify('Page created');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create a page. Try again.');
    }
  }
  async function updatePage(
    id: string,
    patch: { title?: string; parentId?: string | null; position?: string },
  ) {
    try {
      await activeSession(id)?.flush();
      const before = await workspaceApi.page(id);
      const old = before.page;
      const page = await workspaceApi.update(id, { version: old.version, ...patch });
      client.setQueryData(['pages'], {
        pages: (pages.data?.pages ?? []).map((p) => (p.id === page.id ? page : p)),
      });
      const loaded = client.getQueryData<{
        page: Page;
        blocks: Block[];
      }>(['page', id]);
      if (loaded) client.setQueryData(['page', id], { page, blocks: before.blocks });
      refresh();
      notify(patch.title !== undefined ? 'Page renamed' : 'Page moved', async () => {
        const current = (await workspaceApi.page(id)).page;
        if (current.version !== page.version)
          throw new Error('This page changed again. Undo the later changes first.');
        await workspaceApi.update(id, {
          version: current.version,
          title: old.title,
          parentId: old.parentId,
          position: old.position,
        });
        refresh();
        void client.invalidateQueries({ queryKey: ['page', id] });
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update this page. Try again.');
      throw error;
    }
  }
  async function archivePage(id: string) {
    try {
      await flushSessions();
      await workspaceApi.archive(id);
      if (selected === id) await navigate(null);
      refresh();
      notify('Page moved to trash', async () => {
        await workspaceApi.restore(id);
        refresh();
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not archive this page. Try again.');
    }
  }
  return (
    <Context.Provider
      value={{
        selected,
        pages: pages.data?.pages.filter((p) => !p.archivedAt) ?? [],
        loading: pages.isPending,
        error: pages.error,
        navigate,
        createPage,
        updatePage,
        archivePage,
        refresh,
        notify,
        searchOpen,
        openSearch: () => setSearchOpen(true),
        closeSearch: () => setSearchOpen(false),
      }}
    >
      {children}
      {notice && (
        <div className="toast" role="status">
          <span>{notice.text}</span>
          {notice.undo && (
            <button
              onClick={() => {
                void notice.undo!()
                  .then(() => notify('Change undone'))
                  .catch((e: unknown) =>
                    notify(e instanceof Error ? e.message : 'Could not undo this change.'),
                  );
              }}
            >
              Undo
            </button>
          )}
          <button aria-label="Dismiss notification" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('Workspace provider missing');
  return value;
}
export function endPosition(pages: Page[], parentId: string | null) {
  return positionAfterLast(pages.filter((p) => p.parentId === parentId).map((p) => p.position));
}
