import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { Block, BLOCK_TYPES, type GetPageResponse, type Page } from '@fortnight/shared';
import {
  blockRich,
  richToEditor,
  editorToRich,
  withRich,
  diffBlocks,
} from '../../src/web/src/editor/adapter';
import { createEditorExtensions } from '../../src/web/src/editor/extensions';
import { PageSession } from '../../src/web/src/editor/session';
import { ApiError } from '../../src/web/src/api/client';
const now = '2026-11-11T00:00:00.000Z';
const page: Page = {
  id: 'p1',
  parentId: null,
  kind: 'page',
  databaseId: null,
  title: 'Notes',
  icon: null,
  cover: null,
  position: 'a0',
  archivedAt: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
};
const rich = [
  {
    text: 'Hello\nworld',
    marks: ['bold', 'italic', 'underline', 'strike', 'code'],
    href: 'https://example.com',
    mention: { type: 'page', pageId: 'p2' },
  },
];
function block(type = 'paragraph', id = 'b1', parentId: string | null = null): Block {
  const content =
    type === 'code'
      ? { text: 'const n = 1;\nnext();', language: 'typescript' }
      : type === 'to_do'
        ? { rich, checked: true }
        : type === 'image'
          ? { url: '/uploads/img1', caption: rich, width: 320 }
          : type === 'divider'
            ? {}
            : type === 'database_view'
              ? { databaseId: 'db1', viewId: 'v1' }
              : { rich };
  return Block.parse({
    id,
    pageId: 'p1',
    parentId,
    position: id === 'b1' ? 'a0' : 'a1',
    type,
    content,
    createdAt: now,
    updatedAt: now,
  });
}
const sessions: PageSession[] = [];
afterEach(() => {
  sessions.forEach((session) => session.dispose());
  sessions.length = 0;
  vi.useRealTimers();
});
function setup() {
  const data: GetPageResponse = { page, blocks: [block()] };
  const transport = {
    ops: vi.fn().mockResolvedValue({ changesetId: 'c1', page, blocks: [], deletedBlockIds: [] }),
    update: vi.fn().mockImplementation(async (_id, patch) => ({
      ...page,
      title: patch.title,
      version: page.version + 1,
    })),
  };
  const session = new PageSession(data, transport);
  sessions.push(session);
  return { session, transport, data };
}
describe('block adapter', () => {
  for (const type of BLOCK_TYPES)
    it('round-trips ' + type + ' through the actual editor without losing metadata', () => {
      const original = block(type);
      const editor = new Editor({
        extensions: createEditorExtensions(),
        content: richToEditor(blockRich(original)),
      });
      try {
        expect(withRich(original, editorToRich(editor.getJSON()))).toEqual(original);
      } finally {
        editor.destroy();
      }
    });
  it('moves a retained child before deleting its old parent', () => {
    const parent = block('toggle'),
      child = block('paragraph', 'b2', parent.id);
    const ops = diffBlocks([parent, child], [{ ...child, parentId: null }]);
    expect(ops.map((op) => op.op)).toEqual(['move', 'delete']);
  });
  it('deletes a parent once instead of deleting already-removed descendants', () => {
    expect(diffBlocks([block('toggle'), block('paragraph', 'b2', 'b1')], [])).toEqual([
      { op: 'delete', id: 'b1' },
    ]);
  });
});
describe('serialized autosave', () => {
  it('saves within 500ms and marks the draft saved only after success', async () => {
    vi.useFakeTimers();
    const { session, transport } = setup();
    session.setTitle('New notes');
    await vi.advanceTimersByTimeAsync(499);
    expect(transport.update).not.toHaveBeenCalled();
    expect(session.getSnapshot().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.update).toHaveBeenCalledOnce();
    expect(session.getSnapshot().dirty).toBe(false);
  });
  it('serializes edits typed during a request and flushes them before navigation', async () => {
    vi.useFakeTimers();
    const { session, transport } = setup();
    let finish!: (value: unknown) => void;
    transport.ops.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    session.setBlock(withRich(block(), [{ text: 'first' }]));
    await vi.advanceTimersByTimeAsync(500);
    session.setBlock(withRich(block(), [{ text: 'second' }]));
    const flushed = session.flush();
    expect(transport.ops).toHaveBeenCalledTimes(1);
    finish({ changesetId: 'c1', page, blocks: [], deletedBlockIds: [] });
    await flushed;
    expect(transport.ops).toHaveBeenCalledTimes(2);
    expect(transport.ops.mock.calls[1]![1][0].content.rich).toEqual([{ text: 'second' }]);
    expect(session.getSnapshot().dirty).toBe(false);
  });
  it('keeps dirty content after 401 or a refetch and retries without losing edits', async () => {
    vi.useFakeTimers();
    const { session, transport, data } = setup();
    transport.ops.mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'Session expired'));
    session.setBlock(withRich(block(), [{ text: 'keep me' }]));
    await expect(session.flush()).rejects.toMatchObject({ status: 401 });
    session.hydrate(data);
    expect(blockRich(session.getSnapshot().blocks[0]!)).toEqual([{ text: 'keep me' }]);
    expect(session.getSnapshot().dirty).toBe(true);
    await session.flush();
    expect(session.getSnapshot().dirty).toBe(false);
  });
  it('does not repeat successful block ops after a title conflict and retries with the current version', async () => {
    vi.useFakeTimers();
    const { session, transport } = setup();
    transport.update.mockRejectedValueOnce(
      new ApiError(409, 'version_conflict', 'Page changed', {
        entity: 'page',
        current: { ...page, version: 4 },
      }),
    );
    session.setTitle('Keep this title');
    session.setBlock(withRich(block(), [{ text: 'new block text' }]));
    await expect(session.flush()).rejects.toMatchObject({ status: 409 });
    expect(session.getSnapshot().title).toBe('Keep this title');
    await session.flush();
    expect(transport.ops).toHaveBeenCalledTimes(1);
    expect(transport.update.mock.calls[1]![1]).toMatchObject({
      version: 4,
      title: 'Keep this title',
    });
  });
});
