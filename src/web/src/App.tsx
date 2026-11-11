import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  Home,
  LogOut,
  Menu,
  PanelRight,
  Sparkles,
  CircleCheck,
  WifiOff,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { api, ApiError, unauthorizedEvent } from './api/client';
import type { MockUser, SessionResponse } from '@fortnight/shared';
import { useShell } from './store';
import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceProvider';
import { WorkspaceSidebar } from './workspace/WorkspaceSidebar';
import { SearchPalette } from './workspace/SearchPalette';
import { WorkspacePage } from './editor/PageEditor';
import { AgentPanel } from './agent/AgentPanel';
import { clearSessions, flushSessions } from './editor/session';

function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      f<span>•</span>
    </span>
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
function Login() {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: api.login,
    onSuccess: (session) => {
      client.setQueryData(['session'], session);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) login.mutate({ name: name.trim(), password });
  }
  return (
    <div className="login-page">
      <main className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <Mark />
          <span>fortnight</span>
        </div>
        <span className="demo-badge">DEMO WORKSPACE</span>
        <h1 id="login-title">Welcome to your space.</h1>
        <p className="login-intro">
          Notes, plans, and the days in between.
          <br />A calmer place to bring it all together.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            name="name"
            autoComplete="name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="How should we call you?"
            required
            maxLength={80}
          />
          <label htmlFor="password">
            Password <span>any value works</span>
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={200}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="This is just a demo"
          />
          {login.isError && (
            <p className="error" role="alert">
              {message(login.error)}
            </p>
          )}
          <button className="primary" type="submit" disabled={!name.trim() || login.isPending}>
            {login.isPending ? (
              'Opening your workspace…'
            ) : (
              <>
                Enter workspace <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
          </button>
        </form>
        <p className="demo-notice">
          Demo login · No account or real password needed.
          <br />
          Any name works. Everyone shares this workspace.
        </p>
      </main>
      <footer className="login-footer">A place to think. A little more clearly.</footer>
    </div>
  );
}
function Shell({ user }: { user: MockUser }) {
  const client = useQueryClient();
  const workspace = useWorkspace();
  const { assistantOpen, sidebarOpen, toggleAssistant, toggleSidebar } = useShell();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.health(signal),
    refetchInterval: 30000,
  });
  const logout = useMutation({
    mutationFn: async () => {
      await flushSessions();
      const result = await api.logout();
      clearSessions();
      return result;
    },
    onSuccess: () => {
      client.setQueryData(['session'], null);
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'session',
      });
    },
  });
  return (
    <div className={'app-shell' + (sidebarOpen ? ' sidebar-open' : '')}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      {sidebarOpen && (
        <button
          className="navigation-backdrop"
          aria-label="Close navigation"
          onClick={toggleSidebar}
        />
      )}
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="workspace-brand">
          <Mark />
          <strong>fortnight</strong>
          <span className="workspace-tag">DEMO</span>
        </div>
        <div className="workspace-picker">
          <span className="workspace-avatar">F</span>
          <div>
            My workspace<small>Room for your ideas</small>
          </div>
        </div>
        <nav aria-label="Main">
          <a
            href="#workspace"
            className={'nav-item' + (!workspace.selected ? ' active' : '')}
            aria-current={!workspace.selected ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              void workspace.navigate(null);
            }}
          >
            <Home size={17} aria-hidden="true" />
            Workspace
          </a>
        </nav>
        <WorkspaceSidebar />
        <div className="sidebar-bottom">
          <div className="user-profile">
            <span className="avatar" data-color={user.color}>
              {user.initials}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>Demo member</small>
            </div>
          </div>
          <button className="logout" onClick={() => logout.mutate()} disabled={logout.isPending}>
            {logout.isPending ? 'Signing out…' : 'Log out'}
            <LogOut size={15} aria-hidden="true" />
          </button>
          {logout.isError && (
            <p className="error" role="alert">
              {message(logout.error)}
            </p>
          )}
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={sidebarOpen}
              onClick={toggleSidebar}
            >
              <Menu size={18} />
            </button>
            <span>My workspace</span>
            <span className="slash">/</span>
            <strong>
              {workspace.pages.find((page) => page.id === workspace.selected)?.title || 'Home'}
            </strong>
          </div>
          <button
            className={'assistant-toggle' + (assistantOpen ? ' selected' : '')}
            onClick={toggleAssistant}
            aria-expanded={assistantOpen}
            aria-controls="assistant-panel"
          >
            <PanelRight size={15} aria-hidden="true" />
            Assistant
          </button>
        </header>
        <div className="workspace-columns">
          <main id="workspace" className="workspace-main" tabIndex={-1}>
            {workspace.selected ? (
              <WorkspacePage />
            ) : (
              <div className="page-content">
                <div className="page-heading">
                  <span className="eyebrow">YOUR WORKSPACE, AT A GLANCE</span>
                  <span className="home-icon">
                    <Home size={36} strokeWidth={1.3} aria-hidden="true" />
                  </span>
                  <h1>A fresh beginning.</h1>
                  <p>
                    Welcome, {user.name}.<br />A little space to collect what matters.
                  </p>
                </div>
                <button className="primary home-create" onClick={() => void workspace.createPage()}>
                  Create a page
                  <Plus size={16} aria-hidden="true" />
                </button>
                <section className="welcome-note" aria-labelledby="welcome-heading">
                  <ArrowUpRight size={24} aria-hidden="true" />
                  <div>
                    <h2 id="welcome-heading">Good things start with a blank page.</h2>
                    <p>
                      Your workspace is taking shape. Soon, your notes, projects, and calendar will
                      feel right at home here.
                    </p>
                  </div>
                </section>
                <section className="foundation" aria-label="Workspace status">
                  <div>
                    <span className="eyebrow">THE FOUNDATION</span>
                    <h2>A quiet place to build.</h2>
                  </div>
                  <div className="health-card">
                    <div className="health-title">
                      {health.isSuccess ? (
                        <CircleCheck size={15} aria-hidden="true" />
                      ) : health.isError ? (
                        <WifiOff size={15} aria-hidden="true" />
                      ) : (
                        <span className="skeleton skeleton-icon" />
                      )}
                      <strong role="status">
                        {health.isPending
                          ? 'Connecting to workspace…'
                          : health.isError
                            ? 'Workspace API unavailable'
                            : 'Workspace API connected'}
                      </strong>
                    </div>
                    <p>
                      {health.data
                        ? 'Contract ' +
                          health.data.contractVersion +
                          ' · Ready for what comes next.'
                        : 'Your connection to the workspace service.'}
                    </p>
                    {health.isError && (
                      <button className="text-button" onClick={() => void health.refetch()}>
                        <RefreshCw size={13} aria-hidden="true" />
                        Try again
                      </button>
                    )}
                  </div>
                </section>
                <footer className="workspace-footer">
                  <span>Built for the way your mind wanders.</span>
                  <Sparkles size={20} aria-hidden="true" />
                </footer>
              </div>
            )}
          </main>
          <AgentPanel hidden={!assistantOpen} close={toggleAssistant} />
        </div>
      </div>
      <SearchPalette />
    </div>
  );
}
export function App() {
  const client = useQueryClient();
  useEffect(() => {
    const expire = () => client.setQueryData(['session'], null);
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useShell.setState({ assistantOpen: false, sidebarOpen: false });
    };
    window.addEventListener(unauthorizedEvent, expire);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener(unauthorizedEvent, expire);
      window.removeEventListener('keydown', dismiss);
    };
  }, [client]);
  const session = useQuery<SessionResponse | null>({
    queryKey: ['session'],
    queryFn: async ({ signal }) => {
      try {
        return await api.session(signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
  });
  if (session.isPending)
    return (
      <main className="loading-screen">
        <Mark />
        <p role="status">Opening your space…</p>
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line short" />
      </main>
    );
  if (session.isError)
    return (
      <main className="loading-screen">
        <WifiOff size={30} aria-hidden="true" />
        <h1>We couldn’t reach your workspace.</h1>
        <p>Check your connection and try again.</p>
        <button className="primary" onClick={() => void session.refetch()}>
          Try again
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </main>
    );
  return session.data ? (
    <WorkspaceProvider>
      <Shell user={session.data.user} />
    </WorkspaceProvider>
  ) : (
    <Login />
  );
}
