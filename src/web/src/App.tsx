import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, unauthorizedEvent } from './api/client';
import type { MockUser, SessionResponse } from './api/contract';
import { useShell } from './store';

function Mark() { return <span className="brand-mark" aria-hidden="true">f<span>•</span></span>; }
function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
function Login() {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({ mutationFn: api.login, onSuccess: (session) => { client.setQueryData(['session'], session); } });
  function submit(event: FormEvent) { event.preventDefault(); if (name.trim()) login.mutate({ name: name.trim(), password }); }
  return <div className="login-page">
    <header className="login-brand"><Mark /><span>fortnight</span><span className="demo-badge">DEMO WORKSPACE</span></header>
    <main className="login-layout">
      <section className="login-story"><p className="eyebrow">A LITTLE ROOM FOR EVERYTHING</p><h1>Make space<br />for your next<br /><em>good idea.</em></h1><p>Notes, plans, and the days in between.<br />A calmer place to bring it all together.</p><div className="story-note"><span aria-hidden="true">✳</span><div>Start with a little space.<small>See where it takes you.</small></div></div></section>
      <section className="login-card" aria-labelledby="login-title"><span className="card-symbol" aria-hidden="true">↗</span><h2 id="login-title">Welcome to your space.</h2><p>Choose a name and settle in.</p>
        <form onSubmit={submit}><label htmlFor="name">Your name</label><input id="name" name="name" autoComplete="name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we call you?" required maxLength={100} />
          <label htmlFor="password">Password <span>any value works</span></label><input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="This is just a demo" />
          {login.isError && <p className="error" role="alert">{message(login.error)}</p>}
          <button className="primary" type="submit" disabled={!name.trim() || login.isPending}>{login.isPending ? 'Opening your workspace…' : <>Enter workspace <span aria-hidden="true">→</span></>}</button>
        </form><p className="demo-notice">Demo login · No account or real password needed.<br />Everyone shares this workspace.</p>
      </section>
    </main><footer className="login-footer"><span>A place to think. A little more clearly.</span><span>FORTNIGHT / 01</span></footer>
  </div>;
}
function Shell({ user }: { user: MockUser }) {
  const client = useQueryClient();
  const { assistantOpen, sidebarOpen, toggleAssistant, toggleSidebar } = useShell();
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal), refetchInterval: 30000 });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { client.clear(); client.setQueryData(['session'], null); } });
  return <div className={'app-shell' + (sidebarOpen ? ' sidebar-open' : '')}>
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <aside className="sidebar" aria-label="Workspace navigation"><div className="workspace-brand"><Mark /><strong>fortnight</strong><span className="workspace-tag">DEMO</span></div>
      <div className="workspace-picker"><span className="workspace-avatar">F</span><div>My workspace<small>Room for your ideas</small></div></div>
      <nav aria-label="Main"><a href="#workspace" className="nav-item active" aria-current="page"><span aria-hidden="true">⌂</span>Workspace</a></nav>
      <div className="sidebar-section"><span>YOUR SPACE</span><small>Pages will live here.</small><p>Your notes and plans,<br />all within reach.</p></div>
      <div className="sidebar-bottom"><div className="user-profile"><span className="avatar" style={{ backgroundColor: user.color }}>{user.initials}</span><div><strong>{user.name}</strong><small>Demo member</small></div></div><button className="logout" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? 'Signing out…' : 'Log out'}<span aria-hidden="true">↗</span></button>{logout.isError && <p className="error" role="alert">{message(logout.error)}</p>}</div>
    </aside>
    <div className="workspace-body"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-expanded={sidebarOpen} onClick={toggleSidebar}>☰</button><span>My workspace</span><span className="slash">/</span><strong>Home</strong></div><button className={'assistant-toggle' + (assistantOpen ? ' selected' : '')} onClick={toggleAssistant} aria-expanded={assistantOpen} aria-controls="assistant-panel"><span aria-hidden="true">✳</span> Assistant</button></header>
      <div className="workspace-columns"><main id="workspace" className="workspace-main" tabIndex={-1}><div className="page-heading"><span className="eyebrow">YOUR WORKSPACE, AT A GLANCE</span><span className="home-icon" aria-hidden="true">⌂</span><h1>A fresh beginning.</h1><p>Welcome, {user.name}.<br />A little space to collect what matters.</p></div>
        <section className="welcome-note" aria-labelledby="welcome-heading"><span aria-hidden="true">↗</span><div><h2 id="welcome-heading">Good things start with a blank page.</h2><p>Your workspace is taking shape. Soon, your notes, projects, and calendar will feel right at home here.</p></div></section>
        <section className="foundation" aria-label="Workspace status"><div><span className="eyebrow">THE FOUNDATION</span><h2>A quiet place to build.</h2></div><div className="health-card"><div className="health-title"><span className={'status-dot ' + (health.isSuccess ? 'online' : health.isError ? 'offline' : '')} /><strong role="status">{health.isPending ? 'Connecting to workspace…' : health.isError ? 'Workspace API unavailable' : 'Workspace API connected'}</strong></div><p>{health.data ? 'Contract ' + health.data.contractVersion + ' · Ready for what comes next.' : 'Your connection to the workspace service.'}</p>{health.isError && <button className="text-button" onClick={() => void health.refetch()}>Try again</button>}</div></section>
        <footer className="workspace-footer"><span>Built for the way your mind wanders.</span><span aria-hidden="true">✳</span></footer>
      </main>
      {assistantOpen && <aside id="assistant-panel" className="assistant-panel" aria-label="Assistant"><div className="panel-title"><span>✳ Assistant</span><button className="icon-button" aria-label="Close assistant" onClick={toggleAssistant}>×</button></div><div className="assistant-empty"><span className="assistant-symbol" aria-hidden="true">✳</span><h2>A little help,<br />when you need it.</h2><p>A space for your thinking partner.<br />The assistant will be available in a later milestone.</p><span className="coming-soon">COMING SOON</span></div></aside>}
      </div>
    </div>
  </div>;
}
export function App() {
  const client = useQueryClient();
  useEffect(() => {
    const expire = () => client.setQueryData(['session'], null);
    window.addEventListener(unauthorizedEvent, expire);
    return () => window.removeEventListener(unauthorizedEvent, expire);
  }, [client]);
  const session = useQuery<SessionResponse | null>({
    queryKey: ['session'],
    queryFn: async ({ signal }) => { try { return await api.session(signal); } catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; } },
    retry: false,
  });
  if (session.isPending) return <main className="loading-screen"><Mark /><p role="status">Opening your space…</p></main>;
  if (session.isError) return <main className="loading-screen"><Mark /><h1>We couldn’t reach your workspace.</h1><p>Check your connection and try again.</p><button className="primary" onClick={() => void session.refetch()}>Try again</button></main>;
  return session.data ? <Shell user={session.data.user} /> : <Login />;
}

