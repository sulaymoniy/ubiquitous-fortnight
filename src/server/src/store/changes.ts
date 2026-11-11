import type { ChangeOp, ChangesetSource, EntityKind } from '@fortnight/shared';
import type { AppDatabase } from '../db/client.ts';
import { changesets } from '../db/schema.ts';
import { newId, nowIso } from '../ids.ts';
import { getStored, sameStored, type StoredRow } from './entities.ts';

export interface ChangesetMeta {
  source: ChangesetSource;
  label: string;
  agentRunId?: string | null;
  toolUseId?: string | null;
}

/**
 * Records one changeset for a mutation. Call `touch(entity, id)` BEFORE changing an entity; it
 * remembers the entity's stored state the first time. `commit` compares with the state after the
 * change and writes a changeset whose `ops` are the new states and whose `inverse` (in reverse
 * order) restores the old ones. Use inside a transaction together with the change itself.
 */
export class ChangeRecorder {
  private readonly db: AppDatabase;
  private readonly before = new Map<
    string,
    { entity: EntityKind; id: string; value: StoredRow | null }
  >();

  constructor(db: AppDatabase) {
    this.db = db;
  }

  touch(entity: EntityKind, id: string): void {
    const key = `${entity}:${id}`;
    if (!this.before.has(key)) {
      this.before.set(key, { entity, id, value: getStored(this.db, entity, id) });
    }
  }

  /** Entities touched so far, in order. */
  touched(): { entity: EntityKind; id: string }[] {
    return [...this.before.values()].map(({ entity, id }) => ({ entity, id }));
  }

  /** Writes the changeset and returns its id, or null when nothing actually changed. */
  commit(meta: ChangesetMeta): string | null {
    const ops: ChangeOp[] = [];
    const inverse: ChangeOp[] = [];
    for (const { entity, id, value: before } of this.before.values()) {
      const after = getStored(this.db, entity, id);
      if (sameStored(before, after)) continue;
      ops.push(after ? { kind: 'put', entity, id, value: after } : { kind: 'remove', entity, id });
      inverse.push(
        before ? { kind: 'put', entity, id, value: before } : { kind: 'remove', entity, id },
      );
    }
    if (ops.length === 0) return null;
    inverse.reverse();
    const id = newId();
    this.db
      .insert(changesets)
      .values({
        id,
        source: meta.source,
        label: meta.label,
        agentRunId: meta.agentRunId ?? null,
        toolUseId: meta.toolUseId ?? null,
        ops,
        inverse,
        createdAt: nowIso(),
        undoneAt: null,
      })
      .run();
    return id;
  }
}

/** Runs `fn` in one SQLite transaction (synchronous; rolls back on throw). */
export function inTransaction<R>(db: AppDatabase, fn: () => R): R {
  return db.$client.transaction(fn)();
}
