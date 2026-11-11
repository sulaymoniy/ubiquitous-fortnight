import { parseRecurrence, WEEKDAYS, type DateValue } from '@fortnight/shared';
import {
  addDays,
  addMonthsExact,
  daysBetween,
  formatInZone,
  fromLocal,
  startOfWeek,
  toLocal,
  weekday,
  type LocalDateTime,
} from './tz.ts';

export interface Occurrence {
  /** Formatted like the series: `YYYY-MM-DD` (all-day) or ISO with the zone's offset. */
  start: string;
  end: string | null;
  /** Instants for overlap checks and sorting. */
  startMs: number;
  endMs: number;
}

export interface ExpandOptions {
  timeZone: string;
  weekStartsOn: 0 | 1;
  /** Half-open range [fromMs, toMs). */
  fromMs: number;
  toMs: number;
  /** Safety cap on generated candidates. */
  maxIterations?: number;
}

const RRULE_DAY_TO_JS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Expands a date value into its occurrences overlapping [from, to), following the rules in
 * `@fortnight/shared` recurrence.ts: first occurrence is `start`; wall-clock time kept across DST in
 * the workspace zone; WEEKLY weeks start on `weekStartsOn`; MONTHLY skips months without the day;
 * COUNT includes the first occurrence; UNTIL is inclusive.
 */
export function expandOccurrences(value: DateValue, opts: ExpandOptions): Occurrence[] {
  const tz = opts.timeZone;
  const allDay = value.allDay;

  // Series start as a local date (+ time), and the duration to apply to each occurrence.
  const startMs = allDay
    ? fromLocal({ date: value.start, hour: 0, minute: 0, second: 0 }, tz)
    : Date.parse(value.start);
  const startLocal: LocalDateTime = allDay
    ? { date: value.start, hour: 0, minute: 0, second: 0 }
    : toLocal(startMs, tz);
  const durationDays = allDay ? (value.end ? daysBetween(value.start, value.end) : 1) : 0;
  const durationMs = allDay ? 0 : value.end ? Date.parse(value.end) - startMs : 0;

  const make = (date: string, first: boolean): Occurrence => {
    if (allDay) {
      const s = fromLocal({ date, hour: 0, minute: 0, second: 0 }, tz);
      const endDate = addDays(date, durationDays);
      const e = fromLocal({ date: endDate, hour: 0, minute: 0, second: 0 }, tz);
      return { start: date, end: value.end === null ? null : endDate, startMs: s, endMs: e };
    }
    const s = first ? startMs : fromLocal({ ...startLocal, date }, tz);
    const e = s + durationMs;
    return {
      start: first ? value.start : formatInZone(s, tz),
      end: value.end === null ? null : first ? value.end : formatInZone(e, tz),
      startMs: s,
      endMs: e,
    };
  };

  const overlaps = (o: Occurrence) =>
    allDay || value.end !== null
      ? o.startMs < opts.toMs && o.endMs > opts.fromMs
      : o.startMs >= opts.fromMs && o.startMs < opts.toMs;

  if (!value.recurrence) {
    const o = make(startLocal.date, true);
    return overlaps(o) ? [o] : [];
  }
  const parsed = parseRecurrence(value.recurrence);
  if (!parsed.ok) {
    const o = make(startLocal.date, true);
    return overlaps(o) ? [o] : [];
  }
  const rule = parsed.rule;
  const untilDate = rule.until && rule.until.length === 10 ? rule.until : null;
  const untilMs = rule.until && rule.until.length > 10 ? Date.parse(rule.until) : null;

  const out: Occurrence[] = [];
  let count = 0;
  const max = opts.maxIterations ?? 50_000;

  /** Returns false when the series is over (count, until or past the range). */
  const emit = (date: string, first: boolean): boolean => {
    if (untilDate !== null && date > untilDate) return false;
    const o = make(date, first);
    if (untilMs !== null && o.startMs > untilMs) return false;
    if (o.startMs >= opts.toMs) return false;
    count++;
    if (overlaps(o)) out.push(o);
    return rule.count === null || count < rule.count;
  };

  const startDate = startLocal.date;
  if (!emit(startDate, true)) return out;

  let iterations = 0;
  if (rule.freq === 'DAILY') {
    for (let k = 1; iterations++ < max; k++) {
      if (!emit(addDays(startDate, k * rule.interval), false)) break;
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = (rule.byDay ?? [WEEKDAYS[(weekday(startDate) + 6) % 7]!]).map(
      (d) => RRULE_DAY_TO_JS[d]!,
    );
    const week0 = startOfWeek(startDate, opts.weekStartsOn);
    outer: for (let w = 0; iterations++ < max; w += rule.interval) {
      const weekStart = addDays(week0, w * 7);
      for (let i = 0; i < 7; i++) {
        const date = addDays(weekStart, i);
        if (date <= startDate || !days.includes(weekday(date))) continue;
        if (!emit(date, false)) break outer;
      }
    }
  } else {
    for (let k = rule.interval; iterations++ < max; k += rule.interval) {
      const date = addMonthsExact(startDate, k);
      if (date === null) {
        // Skipped month; stop if even the month start is past the range or UNTIL.
        const probe = addMonthsExact(startDate.slice(0, 8) + '01', k)!;
        if (untilDate !== null && probe > untilDate) break;
        if (fromLocal({ date: probe, hour: 0, minute: 0, second: 0 }, tz) >= opts.toMs) break;
        continue;
      }
      if (!emit(date, false)) break;
    }
  }
  return out;
}
