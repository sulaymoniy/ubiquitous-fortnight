import type { ChangeOp } from '@fortnight/shared';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { changesets, pages } from '../db/schema.ts';
import { AppError } from '../http/errors.ts';
import { nowIso } from '../ids.ts';
import { ChangeRecorder, inTransaction } from '../store/changes.ts';
import {
  getStored,
  putStored,
  removeStored,
  sameStored,
  type StoredRow,
} from '../store/entities.ts';
import { reindexPages } from './search.ts';

/**
 * Undoes changesets by applying their `inverse` ops.
 *
 * - Conflict check: every entity the changeset touched must still be exactly in the state the
 *   changeset left it in (ignoring `version`, see below). Otherwise 409 `undo_conflict` lists the entities and nothing changes.
 * - The prior stored state is restored exactly, with one exception: a page's or row's `version`
 *   keeps counting up (after + 1) so clients holding the newer version still get a 409.
 * - Undo writes its own changeset (source `user`, label `Undo: <label>`), so undo can be undone.
 * - Undoing an already-undone changeset is 409 `undo_conflict` with no conflicts listed.
 */
export function undoChangesets(db: AppDatabase, ids: string[], label?: string): string | null {
  return inTransaction(db, () => {
    const sets = ids.map((id) => {
      const [cs] = db.select().from(changesets).where(eq(changesets.id, id)).all();
      if (!cs) throw new AppError(404, 'not_found', 'Changeset not found');
      if (cs.undoneAt !== null) {
        throw new AppError(409, 'undo_conflict', 'This change was already undone', {
          conflicts: [],
        });
      }
      return cs;
    });

    const rec = new ChangeRecorder(db);
    const pageIds = new Set<string>();
    for (const cs of sets) {
      const conflicts = cs.ops
        .filter((op) => !sameIgnoringVersion(getStored(db, op.entity, op.id), expectedAfter(op)))
        .map((op) => ({ entity: op.entity, id: op.id }));
      if (conflicts.length > 0) {
        throw new AppError(409, 'undo_conflict', 'Some items changed since then', { conflicts });
      }
      for (const inv of cs.inverse) {
        rec.touch(inv.entity, inv.id);
        const current = getStored(db, inv.entity, inv.id);
        if (inv.kind === 'remove') {
          removeStored(db, inv.entity, inv.id);
        } else {
          putStored(db, inv.entity, inv.value);
          if ((inv.entity === 'page' || inv.entity === 'row') && current) {
            db.update(pages)
              .set({ version: Number(current.version) + 1 })
              .where(eq(pages.id, inv.id))
              .run();
          }
        }
        if (inv.entity === 'page' || inv.entity === 'row') pageIds.add(inv.id);
        if (inv.entity === 'block') {
          const pageId = (inv.kind === 'put' ? inv.value.pageId : current?.pageId) as
            string | undefined;
          if (pageId) pageIds.add(pageId);
        }
      }
      db.update(changesets).set({ undoneAt: nowIso() }).where(eq(changesets.id, cs.id)).run();
    }
    reindexPages(db, pageIds);
    const first = sets[0];
    return rec.commit({
      source: 'user',
      label: label ?? (sets.length === 1 && first ? `Undo: ${first.label}` : 'Undo'),
    });
  });
}

/**
 * Undo bumps `version` instead of restoring it, so the conflict check ignores `version`. Any real
 * later edit also changes `updatedAt` (or content), so it is still detected.
 */
function sameIgnoringVersion(a: StoredRow | null, b: StoredRow | null): boolean {
  const strip = (r: StoredRow | null) => (r && 'version' in r ? { ...r, version: 0 } : r);
  return sameStored(strip(a), strip(b));
}

function expectedAfter(op: ChangeOp) {
  return op.kind === 'put' ? op.value : null;
}
