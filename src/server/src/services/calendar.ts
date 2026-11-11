import type { DateValue, EventOccurrence } from '@fortnight/shared';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { databases, properties, workspace } from '../db/schema.ts';
import { byPosition } from '../store/mappers.ts';
import { liveRows } from './databases.ts';
import { expandOccurrences } from './recurrence.ts';

/**
 * GET /api/calendar/events: occurrences of every row with a date value in [from, to), from the
 * given databases (or every database with a date property). Each database uses its first date
 * property by position.
 */
export function calendarEvents(
  db: AppDatabase,
  fromIso: string,
  toIso: string,
  databaseIds?: string[],
): EventOccurrence[] {
  const [ws] = db.select().from(workspace).limit(1).all();
  const timeZone = ws?.settings.timeZone ?? 'UTC';
  const weekStartsOn = ws?.settings.weekStartsOn ?? 1;
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);

  const dbs = databaseIds
    ? databaseIds.flatMap((id) => db.select().from(databases).where(eq(databases.id, id)).all())
    : db.select().from(databases).all();

  const events: (EventOccurrence & { sortMs: number })[] = [];
  for (const d of dbs) {
    const dateProp = db
      .select()
      .from(properties)
      .where(and(eq(properties.databaseId, d.id), eq(properties.type, 'date')))
      .all()
      .sort(byPosition)[0];
    if (!dateProp) continue;
    for (const row of liveRows(db, d.id)) {
      const value = row.properties?.[dateProp.id] as DateValue | null | undefined;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      for (const o of expandOccurrences(value, { timeZone, weekStartsOn, fromMs, toMs })) {
        events.push({
          id: `${row.id}:${o.start}`,
          rowId: row.id,
          databaseId: d.id,
          datePropertyId: dateProp.id,
          title: row.title,
          start: value.start,
          end: value.end,
          allDay: value.allDay,
          recurring: value.recurrence !== null,
          recurrence: value.recurrence,
          occurrenceStart: o.start,
          occurrenceEnd: o.end,
          sortMs: o.startMs,
        });
      }
    }
  }
  events.sort(
    (a, b) => a.sortMs - b.sortMs || (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0),
  );
  return events.map(({ sortMs: _s, ...e }) => e);
}
