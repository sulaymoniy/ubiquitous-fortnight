import { SEED_IDS } from '@fortnight/server';
import {
  ApiError,
  ArchivePageResponse,
  CreatePageResponse,
  GetPageResponse,
  GetWorkspaceResponse,
  ListChangesetsResponse,
  ListPagesResponse,
  UpdatePageResponse,
  ValidationErrorDetails,
  VersionConflictError,
  positionBetween,
  type Page,
} from '@fortnight/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { client } from './api-helpers.ts';
import { createTestApp, login, type TestContext } from './helpers.ts';

let t: TestContext;
let api: ReturnType<typeof client>;
beforeEach(async () => {
  t = await createTestApp({ seed: true });
  api = client(t.app, await login(t.app));
});
afterEach(async () => {
  await t.close();
});

const create = (body: object) => api.ok(CreatePageResponse, 'POST', '/api/pages', body);
const list = async (includeArchived = false) =>
  (await api.ok(ListPagesResponse, 'GET', `/api/pages?includeArchived=${includeArchived}`)).pages;
const childrenOf = (pages: Page[], parentId: string | null) =>
  pages
    .filter((p) => p.parentId === parentId)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
    .map((p) => p.title);

describe('workspace', () => {
  it('reads and updates the workspace, merging settings', async () => {
    const ws = await api.ok(GetWorkspaceResponse, 'GET', '/api/workspace');
    expect(ws.settings).toEqual({ timeZone: 'UTC', weekStartsOn: 1 });
    const updated = await api.ok(GetWorkspaceResponse, 'PATCH', '/api/workspace', {
      name: 'Home',
      settings: { timeZone: 'Asia/Tashkent' },
    });
    expect(updated.name).toBe('Home');
    expect(updated.settings).toEqual({ timeZone: 'Asia/Tashkent', weekStartsOn: 1 });
    const bad = await api.call('PATCH', '/api/workspace', { settings: { timeZone: 'Mars/Base' } });
    expect(bad.status).toBe(400);
  });
});

describe('pages', () => {
  it('lists seeded sidebar pages without rows', async () => {
    const pages = await list();
    expect(pages.map((p) => p.id)).toContain(SEED_IDS.calendarPage);
    expect(pages.map((p) => p.id)).not.toContain(SEED_IDS.rowTeamSync);
    const db = pages.find((p) => p.id === SEED_IDS.calendarPage)!;
    expect(db).toMatchObject({ kind: 'database', databaseId: SEED_IDS.calendarDb });
  });

  it('creates nested pages, orders siblings by afterId, and returns blocks', async () => {
    const a = await create({ title: 'A' });
    const b = await create({ title: 'B', afterId: a.id });
    const first = await create({ title: 'First' });
    const child = await create({ title: 'Child', parentId: b.id, icon: '🌱' });
    const grandchild = await create({ title: 'Grandchild', parentId: child.id });
    expect(grandchild.parentId).toBe(child.id);
    expect(child).toMatchObject({ kind: 'page', databaseId: null, version: 0, archivedAt: null });

    const pages = await list();
    const top = childrenOf(pages, null);
    expect(top.indexOf('First')).toBe(0);
    expect(top.indexOf('A')).toBeLessThan(top.indexOf('B'));
    expect(top.indexOf('B')).toBe(top.indexOf('A') + 1);
    expect(childrenOf(pages, child.id)).toEqual(['Grandchild']);
    expect(first.title).toBe('First');

    const got = await api.ok(GetPageResponse, 'GET', `/api/pages/${child.id}`);
    expect(got).toEqual({ page: child, blocks: [] });
  });

  it('rejects a missing or archived parent and a non-sibling afterId', async () => {
    const r1 = await api.call('POST', '/api/pages', { title: 'x', parentId: 'nope' });
    expect(r1.status).toBe(400);
    const d = ValidationErrorDetails.parse(ApiError.parse(r1.body).error.details);
    expect(d.issues[0]?.path).toEqual(['parentId']);
    const r2 = await api.call('POST', '/api/pages', { title: 'x', afterId: SEED_IDS.ideas });
    expect(r2.status).toBe(400);
    const p = await create({ title: 'P' });
    await api.ok(ArchivePageResponse, 'POST', `/api/pages/${p.id}/archive`);
    const r3 = await api.call('POST', '/api/pages', { title: 'x', parentId: p.id });
    expect(r3.status).toBe(400);
    const r4 = await api.call('POST', '/api/pages', { title: 'x', parentId: SEED_IDS.rowTeamSync });
    expect(r4.status).toBe(400);
  });

  it('moves and reorders pages and bumps the version', async () => {
    const a = await create({ title: 'A' });
    const b = await create({ title: 'B', afterId: a.id });
    const moved = await api.ok(UpdatePageResponse, 'PATCH', `/api/pages/${b.id}`, {
      version: b.version,
      parentId: a.id,
    });
    expect(moved).toMatchObject({ parentId: a.id, version: 1 });
    // Move back to top level, before every other top-level page.
    const firstTop = (await list())
      .filter((p) => p.parentId === null)
      .map((p) => p.position)
      .sort()[0]!;
    const back = await api.ok(UpdatePageResponse, 'PATCH', `/api/pages/${b.id}`, {
      version: moved.version,
      parentId: null,
      position: positionBetween(null, firstTop),
    });
    expect(back.parentId).toBeNull();
    const top = childrenOf(await list(), null);
    expect(top.indexOf('B')).toBeLessThan(top.indexOf('A'));
    const renamed = await api.ok(UpdatePageResponse, 'PATCH', `/api/pages/${b.id}`, {
      version: back.version,
      title: 'Bee',
      icon: null,
      cover: '/uploads/x',
    });
    expect(renamed).toMatchObject({ title: 'Bee', icon: null, cover: '/uploads/x', version: 3 });
  });

  it('refuses to move a page under itself or a descendant', async () => {
    const a = await create({ title: 'A' });
    const b = await create({ title: 'B', parentId: a.id });
    for (const parentId of [a.id, b.id]) {
      const r = await api.call('PATCH', `/api/pages/${a.id}`, { version: 0, parentId });
      expect(r.status).toBe(400);
    }
  });

  it('returns 409 with the current page for a stale version', async () => {
    const a = await create({ title: 'A' });
    await api.ok(UpdatePageResponse, 'PATCH', `/api/pages/${a.id}`, { version: 0, title: 'A1' });
    const r = await api.call('PATCH', `/api/pages/${a.id}`, { version: 0, title: 'A2' });
    expect(r.status).toBe(409);
    const err = VersionConflictError.parse(r.body);
    expect(err.error.details).toMatchObject({
      entity: 'page',
      current: { title: 'A1', version: 1 },
    });
  });

  it('404s for unknown pages and for row ids', async () => {
    for (const id of ['missing', SEED_IDS.rowTeamSync]) {
      const r = await api.call('GET', `/api/pages/${id}`);
      expect(r.status).toBe(404);
      expect(ApiError.parse(r.body).error.code).toBe('not_found');
      const ops = await api.call('POST', `/api/pages/${id}/ops`, {
        ops: [{ op: 'delete', id: 'x' }],
      });
      expect(ops.status).toBe(404);
    }
  });

  it('archive cascades to children; restore brings them back', async () => {
    const root = await create({ title: 'Root' });
    const child = await create({ title: 'Child', parentId: root.id });
    const grand = await create({ title: 'Grand', parentId: child.id });
    const early = await create({ title: 'Archived earlier', parentId: root.id });
    await api.ok(ArchivePageResponse, 'POST', `/api/pages/${early.id}/archive`);

    const archived = await api.ok(ArchivePageResponse, 'POST', `/api/pages/${root.id}/archive`);
    expect(archived.archivedAt).not.toBeNull();
    const visible = (await list()).map((p) => p.id);
    for (const id of [root.id, child.id, grand.id, early.id]) expect(visible).not.toContain(id);
    const all = await list(true);
    expect(all.find((p) => p.id === grand.id)?.archivedAt).toBe(archived.archivedAt);
    // Archiving again is a no-op.
    const again = await api.ok(ArchivePageResponse, 'POST', `/api/pages/${root.id}/archive`);
    expect(again).toEqual(archived);

    const restored = await api.ok(ArchivePageResponse, 'POST', `/api/pages/${root.id}/restore`);
    expect(restored.archivedAt).toBeNull();
    const after = await list(true);
    const byId = new Map(after.map((p) => [p.id, p]));
    expect(byId.get(child.id)?.archivedAt).toBeNull();
    expect(byId.get(grand.id)?.archivedAt).toBeNull();
    expect(byId.get(grand.id)?.parentId).toBe(child.id);
    // A child archived separately before stays archived.
    expect(byId.get(early.id)?.archivedAt).not.toBeNull();
  });

  it('restoring a page whose parent is archived moves it to the top level', async () => {
    const parent = await create({ title: 'Parent' });
    const child = await create({ title: 'Child', parentId: parent.id });
    await api.ok(ArchivePageResponse, 'POST', `/api/pages/${child.id}/archive`);
    await api.ok(ArchivePageResponse, 'POST', `/api/pages/${parent.id}/archive`);
    const restored = await api.ok(ArchivePageResponse, 'POST', `/api/pages/${child.id}/restore`);
    expect(restored).toMatchObject({ parentId: null, archivedAt: null });
    expect(childrenOf(await list(), null).at(-1)).toBe('Child');
  });

  it('writes one changeset per mutation with labels', async () => {
    const before = await api.ok(ListChangesetsResponse, 'GET', '/api/changesets?limit=200');
    const a = await create({ title: 'A' });
    await api.ok(UpdatePageResponse, 'PATCH', `/api/pages/${a.id}`, { version: 0, title: 'B' });
    await api.ok(ArchivePageResponse, 'POST', `/api/pages/${a.id}/archive`);
    const after = await api.ok(ListChangesetsResponse, 'GET', '/api/changesets?limit=200');
    const fresh = after.changesets.slice(0, after.changesets.length - before.changesets.length);
    expect(fresh.map((c) => c.label)).toEqual(['Archive page', 'Edit page', 'Create page']);
    expect(fresh.every((c) => c.source === 'user' && c.undoneAt === null)).toBe(true);
    const filtered = await api.ok(ListChangesetsResponse, 'GET', '/api/changesets?source=agent');
    expect(filtered.changesets).toEqual([]);
  });
});
