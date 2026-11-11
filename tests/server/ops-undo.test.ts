import { SEED_IDS } from '@fortnight/server';
import {
  ApiError,
  ArchivePageResponse,
  CreatePageResponse,
  GetPageResponse,
  ListChangesetsResponse,
  PageOpsResponse,
  UndoChangesetResponse,
  UndoConflictError,
  UpdatePageResponse,
  ValidationErrorDetails,
  positionBetween,
  type Block,
  type BlockOp,
} from '@fortnight/shared';
import { v7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { client, contentSnapshot } from './api-helpers.ts';
import { createTestApp, login, type TestContext } from './helpers.ts';

let t: TestContext;
let api: ReturnType<typeof client>;
let pageId: string;
beforeEach(async () => {
  t = await createTestApp({ seed: true });
  api = client(t.app, await login(t.app));
  pageId = (await api.ok(CreatePageResponse, 'POST', '/api/pages', { title: 'Doc' })).id;
});
afterEach(async () => {
  await t.close();
});

const ops = (list: BlockOp[], id = pageId) =>
  api.ok(PageOpsResponse, 'POST', `/api/pages/${id}/ops`, { ops: list });
const getBlocks = async (id = pageId) =>
  (await api.ok(GetPageResponse, 'GET', `/api/pages/${id}`)).blocks;
const para = (id: string, text: string, parentId: string | null, position: string): BlockOp => ({
  op: 'insert',
  block: { id, parentId, position, type: 'paragraph', content: { rich: [{ text }] } },
});

describe('block ops', () => {
  it('inserts, updates, moves and deletes in one batch and reports what changed', async () => {
    const [a, b, c] = [v7(), v7(), v7()];
    const first = await ops([
      para(a, 'A', null, 'a0'),
      {
        op: 'insert',
        block: { id: b, parentId: null, position: 'a1', type: 'toggle', content: { rich: [] } },
      },
      para(c, 'C', b, 'a0'),
    ]);
    expect(first.blocks.map((x) => x.id).sort()).toEqual([a, b, c].sort());
    expect(first.deletedBlockIds).toEqual([]);
    expect(first.page.id).toBe(pageId);

    const second = await ops([
      { op: 'update', id: a, type: 'to_do', content: { rich: [{ text: 'A!' }], checked: true } },
      { op: 'move', id: a, parentId: b, position: 'a1' },
      { op: 'delete', id: b },
    ]);
    // Deleting the toggle removes its children, including the block just moved into it.
    expect(second.deletedBlockIds.sort()).toEqual([a, b, c].sort());
    expect(second.blocks).toEqual([]);
    expect(await getBlocks()).toEqual([]);
  });

  it('returns blocks flat, ordered by parent then position', async () => {
    const [p, q, r] = [v7(), v7(), v7()];
    await ops([para(q, 'Q', null, 'a1'), para(p, 'P', null, 'a0'), para(r, 'R', q, 'a0')]);
    const blocks = await getBlocks();
    expect(blocks.map((b) => b.id)).toEqual([p, q, r]);
  });

  it('an invalid op anywhere in the batch changes nothing', async () => {
    const a = v7();
    await ops([para(a, 'keep me', null, 'a0')]);
    const before = contentSnapshot(t.db);
    const changesetsBefore = (await api.ok(ListChangesetsResponse, 'GET', '/api/changesets'))
      .changesets.length;
    const cases: [BlockOp[], (string | number)[]][] = [
      [
        [para(v7(), 'x', null, 'a1'), { op: 'delete', id: 'missing' }],
        ['ops', 1, 'id'],
      ],
      [[para(v7(), 'x', 'missing-parent', 'a1')], ['ops', 0, 'block', 'parentId']],
      [[para(a, 'dup', null, 'a1')], ['ops', 0, 'block', 'id']],
      [[{ op: 'move', id: a, parentId: a, position: 'a0' }], ['ops', 0, 'parentId']],
      [[para(v7(), 'x', null, 'a00')], ['ops', 0, 'block', 'position']],
      [
        [
          { op: 'update', id: a, type: 'paragraph', content: { rich: [{ text: 'changed' }] } },
          { op: 'update', id: 'nope', type: 'divider', content: {} },
        ],
        ['ops', 1, 'id'],
      ],
    ];
    for (const [list, path] of cases) {
      const r = await api.call('POST', `/api/pages/${pageId}/ops`, { ops: list });
      expect(r.status).toBe(400);
      const details = ValidationErrorDetails.parse(ApiError.parse(r.body).error.details);
      expect(details.issues[0]?.path).toEqual(path);
    }
    expect(contentSnapshot(t.db)).toEqual(before);
    const changesetsAfter = (await api.ok(ListChangesetsResponse, 'GET', '/api/changesets'))
      .changesets.length;
    expect(changesetsAfter).toBe(changesetsBefore);
  });

  it('rejects type/content mismatches and block ids used on another page', async () => {
    const mismatch = await api.call('POST', `/api/pages/${pageId}/ops`, {
      ops: [{ op: 'update', id: 'x', type: 'divider', content: { rich: [] } }],
    });
    expect(mismatch.status).toBe(400);
    const seededBlock = (await getBlocks(SEED_IDS.gettingStarted))[0]!;
    const r = await api.call('POST', `/api/pages/${pageId}/ops`, {
      ops: [para(seededBlock.id, 'steal', null, 'a0')],
    });
    expect(r.status).toBe(400);
  });

  it('cannot move a block under its own descendant', async () => {
    const [a, b] = [v7(), v7()];
    await ops([para(a, 'A', null, 'a0'), para(b, 'B', a, 'a0')]);
    const r = await api.call('POST', `/api/pages/${pageId}/ops`, {
      ops: [{ op: 'move', id: a, parentId: b, position: 'a0' }],
    });
    expect(r.status).toBe(400);
  });

  it('keeps positions ordered after 1,000 random inserts through the API', async () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const expected: Block['id'][] = [];
    const positions: string[] = [];
    for (let batch = 0; batch < 4; batch++) {
      const list: BlockOp[] = [];
      for (let i = 0; i < 250; i++) {
        const at = Math.floor(rand() * (positions.length + 1));
        const position = positionBetween(positions[at - 1] ?? null, positions[at] ?? null);
        const id = v7();
        positions.splice(at, 0, position);
        expected.splice(at, 0, id);
        list.push(para(id, `#${batch}-${i}`, null, position));
      }
      await ops(list);
    }
    const blocks = await getBlocks();
    expect(blocks).toHaveLength(1000);
    expect(blocks.map((b) => b.id)).toEqual(expected);
  });

  it('accepts every block type, including nested toggles and lists', async () => {
    const seeded = await getBlocks(SEED_IDS.gettingStarted);
    const idMap = new Map(seeded.map((b) => [b.id, v7()]));
    const list: BlockOp[] = seeded.map((b) => ({
      op: 'insert',
      block: {
        id: idMap.get(b.id)!,
        parentId: b.parentId ? idMap.get(b.parentId)! : null,
        position: b.position,
        type: b.type,
        content: b.content,
      } as Extract<BlockOp, { op: 'insert' }>['block'],
    }));
    // Parents must come first.
    list.sort(
      (x, y) =>
        Number(x.op === 'insert' && x.block.parentId !== null) -
        Number(y.op === 'insert' && y.block.parentId !== null),
    );
    const res = await ops(list);
    expect(res.blocks).toHaveLength(seeded.length);
  });

  it('touches updatedAt but not the page version', async () => {
    const before = (await api.ok(GetPageResponse, 'GET', `/api/pages/${pageId}`)).page;
    const res = await ops([para(v7(), 'x', null, 'a0')]);
    expect(res.page.version).toBe(before.version);
    expect(res.page.updatedAt >= before.updatedAt).toBe(true);
  });
});

describe('undo', () => {
  it('undoing a changeset restores the exact prior state', async () => {
    const [a, b] = [v7(), v7()];
    await ops([para(a, 'one', null, 'a0'), para(b, 'two', a, 'a0')]);
    const before = contentSnapshot(t.db, { ignorePageVersion: true });

    const edit = await ops([
      { op: 'update', id: a, type: 'heading_1', content: { rich: [{ text: 'ONE' }] } },
      { op: 'delete', id: b },
      para(v7(), 'three', null, 'a1'),
    ]);
    expect(contentSnapshot(t.db, { ignorePageVersion: true })).not.toEqual(before);

    const undo = await api.ok(
      UndoChangesetResponse,
      'POST',
      `/api/changesets/${edit.changesetId}/undo`,
    );
    expect(contentSnapshot(t.db, { ignorePageVersion: true })).toEqual(before);

    const list = await api.ok(ListChangesetsResponse, 'GET', '/api/changesets?limit=5');
    expect(list.changesets[0]).toMatchObject({
      id: undo.undoChangesetId,
      label: 'Undo: Edit page',
    });
    expect(list.changesets.find((c) => c.id === edit.changesetId)?.undoneAt).not.toBeNull();

    // Undoing the undo is a redo.
    await api.ok(UndoChangesetResponse, 'POST', `/api/changesets/${undo.undoChangesetId}/undo`);
    const blocks = await getBlocks();
    expect(blocks.map((x) => x.type).sort()).toEqual(['heading_1', 'paragraph']);
  });

  it('restores page edits, moves and archives exactly (version keeps counting)', async () => {
    const child = await api.ok(CreatePageResponse, 'POST', '/api/pages', {
      title: 'Child',
      parentId: pageId,
    });
    const before = contentSnapshot(t.db, { ignorePageVersion: true });
    const ids: string[] = [];
    const edited = await api.ok(UpdatePageResponse, 'PATCH', `/api/pages/${pageId}`, {
      version: 0,
      title: 'Renamed',
      parentId: SEED_IDS.projects,
    });
    await api.ok(ArchivePageResponse, 'POST', `/api/pages/${pageId}/archive`);
    const cs = await api.ok(ListChangesetsResponse, 'GET', '/api/changesets?limit=2');
    ids.push(...cs.changesets.map((c) => c.id)); // newest first: archive, edit
    for (const id of ids) await api.ok(UndoChangesetResponse, 'POST', `/api/changesets/${id}/undo`);
    expect(contentSnapshot(t.db, { ignorePageVersion: true })).toEqual(before);

    const page = (await api.ok(GetPageResponse, 'GET', `/api/pages/${pageId}`)).page;
    expect(page.version).toBeGreaterThan(edited.version);
    // A client holding the pre-undo version gets a conflict.
    const stale = await api.call('PATCH', `/api/pages/${pageId}`, {
      version: edited.version,
      title: 'x',
    });
    expect(stale.status).toBe(409);
    expect((await api.ok(GetPageResponse, 'GET', `/api/pages/${child.id}`)).page.archivedAt).toBe(
      null,
    );
  });

  it('refuses with 409 when an entity changed after the changeset, and changes nothing', async () => {
    const a = v7();
    const first = await ops([para(a, 'v1', null, 'a0')]);
    await ops([{ op: 'update', id: a, type: 'paragraph', content: { rich: [{ text: 'v2' }] } }]);
    const before = contentSnapshot(t.db);
    const r = await api.call('POST', `/api/changesets/${first.changesetId}/undo`);
    expect(r.status).toBe(409);
    const err = UndoConflictError.parse(r.body);
    expect(err.error.details.conflicts).toEqual(
      expect.arrayContaining([{ entity: 'block', id: a }]),
    );
    expect(contentSnapshot(t.db)).toEqual(before);
  });

  it('refuses to undo twice and 404s unknown changesets', async () => {
    const res = await ops([para(v7(), 'x', null, 'a0')]);
    await api.ok(UndoChangesetResponse, 'POST', `/api/changesets/${res.changesetId}/undo`);
    const again = await api.call('POST', `/api/changesets/${res.changesetId}/undo`);
    expect(again.status).toBe(409);
    expect(UndoConflictError.parse(again.body).error.details.conflicts).toEqual([]);
    const missing = await api.call('POST', '/api/changesets/nope/undo');
    expect(missing.status).toBe(404);
  });
});
