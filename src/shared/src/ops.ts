import { z } from 'zod';
import { Id, Position } from './common.ts';
import { blockVariants } from './model.ts';

/**
 * Block operations for `POST /api/pages/:id/ops` and `POST /api/rows/:id/ops`.
 *
 * - A batch is all-or-nothing: if any op is invalid, nothing changes and the server returns 400.
 * - Ops apply in order, so a batch may insert a block and then insert its children.
 * - `insert`: the client chooses the id (UUIDv7). `parentId` must be a block on the same page
 *   (or null). Inserting an existing id is a 400.
 * - `update`: replaces `type` and the whole `content`. Both are required (send the current type to
 *   keep it), so the pair is validated as one `{ type, content }` variant.
 * - `move`: new parent (same page) and position. Moving a block under itself or its descendant
 *   is a 400.
 * - `delete`: removes the block and all its descendants; undoable through the changeset.
 * Blocks are last-writer-wins per block in v1 (single user); there is no block version.
 */
export const InsertBlockOp = z.object({
  op: z.literal('insert'),
  block: z.discriminatedUnion(
    'type',
    blockVariants({ id: Id, parentId: Id.nullable(), position: Position }),
  ),
});
export type InsertBlockOp = z.infer<typeof InsertBlockOp>;

export const UpdateBlockOp = z.discriminatedUnion(
  'type',
  blockVariants({ op: z.literal('update'), id: Id }),
);
export type UpdateBlockOp = z.infer<typeof UpdateBlockOp>;

export const MoveBlockOp = z.object({
  op: z.literal('move'),
  id: Id,
  parentId: Id.nullable(),
  position: Position,
});
export type MoveBlockOp = z.infer<typeof MoveBlockOp>;

export const DeleteBlockOp = z.object({ op: z.literal('delete'), id: Id });
export type DeleteBlockOp = z.infer<typeof DeleteBlockOp>;

export const BlockOp = z.union([InsertBlockOp, UpdateBlockOp, MoveBlockOp, DeleteBlockOp]);
export type BlockOp = z.infer<typeof BlockOp>;

/** Max ops in one batch. */
export const MAX_OPS_PER_BATCH = 500;
