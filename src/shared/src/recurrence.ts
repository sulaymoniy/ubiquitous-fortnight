/**
 * Recurrence rules (user decision D3): an RRULE subset stored in `DateValue.recurrence`.
 *
 * Supported parts, separated by `;` (order free, each at most once):
 * - `FREQ=DAILY|WEEKLY|MONTHLY` (required)
 * - `INTERVAL=n`, 1..999 (default 1)
 * - `BYDAY=MO,TU,...` weekday list, only with `FREQ=WEEKLY`; default is the weekday of `start`
 * - `COUNT=n`, 1..1000: total occurrences including the first
 * - `UNTIL=YYYYMMDD` or `UNTIL=YYYYMMDDTHHMMSSZ`: last allowed occurrence start, inclusive
 * `COUNT` and `UNTIL` cannot both be set. Neither means the series never ends.
 *
 * Expansion semantics (implemented on the server, `GET /api/calendar/events`):
 * - DTSTART is `DateValue.start`. The first occurrence is `start` itself, even if it does not
 *   match `BYDAY`.
 * - Rules expand in the workspace time zone and keep the local wall-clock time of `start`.
 *   Across a DST change the local time stays the same and the UTC instant shifts.
 *   A local time that does not exist (spring-forward gap) moves forward by the gap length;
 *   an ambiguous local time (fall-back overlap) uses the earlier instant.
 * - `WEEKLY` with `BYDAY`: weeks start on the workspace `weekStartsOn`; `INTERVAL` counts weeks
 *   from the week that contains `start`.
 * - `MONTHLY`: same day of month as `start`; months without that day are skipped (RFC 5545).
 * - `UNTIL` as a date compares with the occurrence's local date; as a UTC date-time it compares
 *   with the occurrence's start instant.
 * - Editing or dragging any occurrence changes the whole series in v1 (no per-occurrence
 *   exceptions).
 */

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  byDay: Weekday[] | null;
  count: number | null;
  /** `YYYY-MM-DD` or a UTC ISO date-time (`YYYY-MM-DDTHH:MM:SSZ`). */
  until: string | null;
}

export type ParseRecurrenceResult =
  { ok: true; rule: RecurrenceRule } | { ok: false; error: string };

const UNTIL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATETIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

function intInRange(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** Parses an RRULE string from the supported subset. Accepts an optional `RRULE:` prefix. */
export function parseRecurrence(input: string): ParseRecurrenceResult {
  const text = input.trim().replace(/^RRULE:/i, '');
  if (text === '') return { ok: false, error: 'empty recurrence rule' };
  const seen = new Set<string>();
  const rule: RecurrenceRule = {
    freq: 'DAILY',
    interval: 1,
    byDay: null,
    count: null,
    until: null,
  };
  let hasFreq = false;

  for (const part of text.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) return { ok: false, error: `malformed part "${part}"` };
    const key = part.slice(0, eq).toUpperCase();
    const value = part.slice(eq + 1).toUpperCase();
    if (seen.has(key)) return { ok: false, error: `duplicate ${key}` };
    seen.add(key);

    switch (key) {
      case 'FREQ':
        if (value !== 'DAILY' && value !== 'WEEKLY' && value !== 'MONTHLY') {
          return { ok: false, error: 'FREQ must be DAILY, WEEKLY or MONTHLY' };
        }
        rule.freq = value;
        hasFreq = true;
        break;
      case 'INTERVAL': {
        const n = intInRange(value, 1, 999);
        if (n === null) return { ok: false, error: 'INTERVAL must be 1..999' };
        rule.interval = n;
        break;
      }
      case 'COUNT': {
        const n = intInRange(value, 1, 1000);
        if (n === null) return { ok: false, error: 'COUNT must be 1..1000' };
        rule.count = n;
        break;
      }
      case 'BYDAY': {
        const days = value.split(',');
        if (days.some((d) => !(WEEKDAYS as readonly string[]).includes(d))) {
          return { ok: false, error: 'BYDAY must list MO,TU,WE,TH,FR,SA,SU' };
        }
        if (new Set(days).size !== days.length) return { ok: false, error: 'duplicate BYDAY day' };
        rule.byDay = days as Weekday[];
        break;
      }
      case 'UNTIL': {
        const d = UNTIL_DATE.exec(value);
        const dt = UNTIL_DATETIME.exec(value);
        if (d) rule.until = `${d[1]}-${d[2]}-${d[3]}`;
        else if (dt) rule.until = `${dt[1]}-${dt[2]}-${dt[3]}T${dt[4]}:${dt[5]}:${dt[6]}Z`;
        else return { ok: false, error: 'UNTIL must be YYYYMMDD or YYYYMMDDTHHMMSSZ' };
        if (Number.isNaN(Date.parse(rule.until))) return { ok: false, error: 'invalid UNTIL' };
        break;
      }
      default:
        return { ok: false, error: `unsupported part ${key}` };
    }
  }

  if (!hasFreq) return { ok: false, error: 'FREQ is required' };
  if (rule.count !== null && rule.until !== null) {
    return { ok: false, error: 'COUNT and UNTIL cannot both be set' };
  }
  if (rule.byDay !== null && rule.freq !== 'WEEKLY') {
    return { ok: false, error: 'BYDAY is only supported with FREQ=WEEKLY' };
  }
  return { ok: true, rule };
}
