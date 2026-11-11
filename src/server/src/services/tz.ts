/**
 * Time zone helpers built on Intl (no dependencies). Local dates are `YYYY-MM-DD` strings; local
 * date arithmetic uses UTC math on those strings, so it never depends on the server's zone.
 */

export interface LocalDateTime {
  date: string; // YYYY-MM-DD
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Wall-clock date and time of an instant (ms) in `tz`. */
export function toLocal(ms: number, tz: string): LocalDateTime {
  const parts = Object.fromEntries(
    formatter(tz)
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** UTC offset of `tz` at an instant, in minutes (e.g. +300 for UTC+5). */
export function offsetMinutes(ms: number, tz: string): number {
  const l = toLocal(ms, tz);
  const [y, m, d] = l.date.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d, l.hour, l.minute, l.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * Instant for a local wall-clock time in `tz`. A time inside a DST gap moves forward by the gap
 * length; an ambiguous time (DST overlap) resolves to the earlier instant.
 */
export function fromLocal(local: LocalDateTime, tz: string): number {
  const [y, m, d] = local.date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, local.hour, local.minute, local.second);
  const before = offsetMinutes(guess - 12 * 3_600_000, tz);
  const after = offsetMinutes(guess + 12 * 3_600_000, tz);
  const candidates = [...new Set([before, after])]
    .map((off) => guess - off * 60_000)
    .filter((t) => {
      const l = toLocal(t, tz);
      return (
        l.date === local.date &&
        l.hour === local.hour &&
        l.minute === local.minute &&
        l.second === local.second
      );
    });
  if (candidates.length) return Math.min(...candidates);
  return guess - before * 60_000; // gap: lands after the jump
}

/** ISO 8601 with the zone's offset at that instant, e.g. `2026-11-16T10:00:00+05:00`. */
export function formatInZone(ms: number, tz: string): string {
  const l = toLocal(ms, tz);
  const off = offsetMinutes(ms, tz);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${l.date}T${pad(l.hour)}:${pad(l.minute)}:${pad(l.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/* ------------------------------------------------------------------ local date arithmetic */

const toUtcDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const fromUtcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return fromUtcDay(toUtcDay(date) + days * 86_400_000);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcDay(b) - toUtcDay(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return new Date(toUtcDay(date)).getUTCDay();
}

/** First day of the week containing `date`. */
export function startOfWeek(date: string, weekStartsOn: 0 | 1): string {
  return addDays(date, -((weekday(date) - weekStartsOn + 7) % 7));
}

/** Same day in a month `months` later, or null when that month has no such day. */
export function addMonthsExact(date: string, months: number): string | null {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const candidate = new Date(Date.UTC(ny, nm, d));
  if (candidate.getUTCMonth() !== nm) return null;
  return fromUtcDay(candidate.getTime());
}

/** Today's local date in `tz`. */
export function today(tz: string, now = Date.now()): string {
  return toLocal(now, tz).date;
}

/** Local calendar date of a DateValue start (date-only values are already local dates). */
export function localDateOf(value: string, tz: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : toLocal(Date.parse(value), tz).date;
}
