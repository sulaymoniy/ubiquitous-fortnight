import { isValidPosition, type BlockOp, type ChangesetSource } from '@fortnight/shared';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { blocks, pages } from '../db/schema.ts';
import { AppError } from '../http/errors.ts';
import { nowIso } from '../ids.ts';
import { ChangeRecorder, inTransaction } from '../store/changes.ts';
import { toBlock, type BlockRow } from '../store/mappers.ts';
import { blockIdsInUse } from './pages.ts';
import { reindexPages } from './search.ts';

export interface OpsResult {
  changesetId: string;
  blocks: ReturnType<typeof toBlock>[];
  deletedBlockIds: string[];
}

export interface OpsOptions {
  label?: string;
  source?: ChangesetSource;
  agentRunId?: string | null;
  toolUseId?: string | null;
}

function invalidOp(index: number, path: (string | number)[], message: string): AppError {
  return new AppError(400, 'validation_error', `ops[${index}]: ${message}`, {
    in: 'body',
    issues: [{ path: ['ops', index, ...path], message }],
  });
}

/**
 * Applies a batch of block ops to the body of a page or row, all or nothing (contract `ops.ts`).
 * The batch is validated and applied in memory first; only a fully valid batch is written, in one
 * transaction with its changeset and search index update. The page's `updatedAt` changes, its
 * `version` does not (blocks are last-writer-wins; `version` guards title and parent only).
 */
export function applyBlockOps(
  db: AppDatabase,
  pageId: string,
  ops: BlockOp[],
  options: OpsOptions = {},
): OpsResult {
  return inTransaction(db, () => {
    const existing = db.select().from(blocks).where(eq(blocks.pageId, pageId)).all();
    const original = new Map(existing.map((b) => [b.id, b]));
    const state = new Map<string, BlockRow>(existing.map((b) => [b.id, { ...b }]));
    const touched = new Set<string>();
    const deleted: string[] = [];
    const deletedSet = new Set<string>();
    const now = nowIso();

    const insertIds = ops.flatMap((op) => (op.op === 'insert' ? [op.block.id] : []));
    const takenElsewhere = blockIdsInUse(db, insertIds);

    const isDescendantOrSelf = (candidate: string, ancestor: string): boolean => {
      let cur: string | null = candidate;
      for (let guard = 0; cur !== null && guard <= state.size; guard++) {
        if (cur === ancestor) return true;
        cur = state.get(cur)?.parentId ?? null;
      }
      return false;
    };

    ops.forEach((op, i) => {
      switch (op.op) {
        case 'insert': {
          const b = op.block;
          if (state.has(b.id) || deletedSet.has(b.id) || takenElsewhere.has(b.id)) {
            throw invalidOp(i, ['block', 'id'], 'a block with this id already exists');
          }
          if (b.parentId !== null && !state.has(b.parentId)) {
            throw invalidOp(i, ['block', 'parentId'], 'parent block not found on this page');
          }
          if (!isValidPosition(b.position)) {
            throw invalidOp(i, ['block', 'position'], 'invalid position');
          }
          state.set(b.id, {
            id: b.id,
            pageId,
            parentId: b.parentId,
            type: b.type,
            position: b.position,
            content: b.content,
            createdAt: now,
            updatedAt: now,
          });
          touched.add(b.id);
          break;
        }
        case 'update': {
          const cur = state.get(op.id);
          if (!cur) throw invalidOp(i, ['id'], 'block not found on this page');
          state.set(op.id, { ...cur, type: op.type, content: op.content, updatedAt: now });
          touched.add(op.id);
          break;
        }
        case 'move': {
          const cur = state.get(op.id);
          if (!cur) throw invalidOp(i, ['id'], 'block not found on this page');
          if (op.parentId !== null) {
            if (!state.has(op.parentId)) {
              throw invalidOp(i, ['parentId'], 'parent block not found on this page');
            }
            if (isDescendantOrSelf(op.parentId, op.id)) {
              throw invalidOp(i, ['parentId'], 'cannot move a block under itself or its children');
            }
          }
          if (!isValidPosition(op.position)) throw invalidOp(i, ['position'], 'invalid position');
          state.set(op.id, {
            ...cur,
            parentId: op.parentId,
            position: op.position,
            updatedAt: now,
          });
          touched.add(op.id);
          break;
        }
        case 'delete': {
          if (!state.has(op.id)) throw invalidOp(i, ['id'], 'block not found on this page');
          const stack = [op.id];
          while (stack.length) {
            const id = stack.pop()!;
            for (const b of state.values()) if (b.parentId === id) stack.push(b.id);
            state.delete(id);
            touched.delete(id);
            if (!deletedSet.has(id)) {
              deletedSet.add(id);
              deleted.push(id);
            }
          }
          break;
        }
      }
    });

    const rec = new ChangeRecorder(db);
    rec.touch('page', pageId);
    // Deletes first (children before parents is not needed: blocks.parent_id has no FK).
    for (const id of deleted) {
      if (!original.has(id)) continue;
      rec.touch('block', id);
      db.delete(blocks).where(eq(blocks.id, id)).run();
    }
    for (const id of touched) {
      const row = state.get(id)!;
      rec.touch('block', id);
      db.insert(blocks).values(row).onConflictDoUpdate({ target: blocks.id, set: row }).run();
    }
    db.update(pages).set({ updatedAt: now }).where(eq(pages.id, pageId)).run();
    reindexPages(db, [pageId]);

    const changesetId = rec.commit({
      source: options.source ?? 'user',
      label: options.label ?? 'Edit page',
      agentRunId: options.agentRunId ?? null,
      toolUseId: options.toolUseId ?? null,
    });
    return {
      // The page's updatedAt always changes, so a changeset is always written.
      changesetId: changesetId!,
      blocks: [...touched].map((id) => toBlock(state.get(id)!)),
      deletedBlockIds: deleted,
    };
  });
}
