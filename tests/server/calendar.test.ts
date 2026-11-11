import { SEED_IDS } from '@fortnight/server';
import { CalendarEventsResponse, UpdateRowResponse, type DateValue } from '@fortnight/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandOccurrences } from '../../src/server/src/services/recurrence.ts';
import { fromLocal } from '../../src/server/src/services/tz.ts';
import { client } from './api-helpers.ts';
import { createTestApp, login, type TestContext } from './helpers.ts';

const timed = (start: string, end: string | null, recurrence: string | null = null): DateValue => ({
  start,
  end,
  allDay: false,
  recurrence,
});
const range = (from: string, to: string, timeZone = 'UTC', weekStartsOn: 0 | 1 = 1) => ({
  timeZone,
  weekStartsOn,
  fromMs: Date.parse(from),
  toMs: Date.parse(to),
});
const starts = (v: DateValue, r: ReturnType<typeof range>) =>
  expandOccurrences(v, r).map((o) => o.start);

describe('time zones', () => {
  it('resolves DST gaps forward and overlaps to the earlier instant', () => {
    // Europe/Berlin: 2026-03-29 02:00 → 03:00; 2026-10-25 03:00 → 02:00.
    const gap = fromLocal({ date: '2026-03-29', hour: 2, minute: 30, second: 0 }, 'Europe/Berlin');
    expect(new Date(gap).toISOString()).toBe('2026-03-29T01:30:00.000Z'); // 03:30 local
    const overlap = fromLocal(
      { date: '2026-10-25', hour: 2, minute: 30, second: 0 },
      'Europe/Berlin',
    );
    expect(new Date(overlap).toISOString()).toBe('2026-10-25T00:30:00.000Z'); // first 02:30
  });
});

describe('recurrence expansion', () => {
  it('keeps the local wall-clock time across a DST change', () => {
    const v = timed('2026-03-23T09:00:00+01:00', '2026-03-23T10:00:00+01:00', 'FREQ=WEEKLY');
    const occ = expandOccurrences(
      v,
      range('2026-03-20T00:00:00Z', '2026-04-10T00:00:00Z', 'Europe/Berlin'),
    );
    expect(occ.map((o) => o.start)).toEqual([
      '2026-03-23T09:00:00+01:00',
      '2026-03-30T09:00:00+02:00',
      '2026-04-06T09:00:00+02:00',
    ]);
    expect(occ.map((o) => o.end)).toEqual([
      '2026-03-23T10:00:00+01:00',
      '2026-03-30T10:00:00+02:00',
      '2026-04-06T10:00:00+02:00',
    ]);
  });

  it('respects COUNT, including occurrences before the range', () => {
    const v = timed('2026-11-01T08:00:00Z', null, 'FREQ=DAILY;COUNT=5');
    expect(starts(v, range('2026-11-03T00:00:00Z', '2026-12-01T00:00:00Z'))).toEqual([
      '2026-11-03T08:00:00+00:00',
      '2026-11-04T08:00:00+00:00',
      '2026-11-05T08:00:00+00:00',
    ]);
  });

  it('respects UNTIL as an inclusive date and as an instant', () => {
    const d = timed('2026-11-02T08:00:00Z', null, 'FREQ=DAILY;INTERVAL=2;UNTIL=20261106');
    expect(starts(d, range('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'))).toEqual([
      '2026-11-02T08:00:00Z',
      '2026-11-04T08:00:00+00:00',
      '2026-11-06T08:00:00+00:00',
    ]);
    const i = timed('2026-11-02T08:00:00Z', null, 'FREQ=DAILY;UNTIL=20261103T075959Z');
    expect(starts(i, range('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'))).toEqual([
      '2026-11-02T08:00:00Z',
    ]);
  });

  it('expands WEEKLY BYDAY within weeks and INTERVAL', () => {
    const v = timed('2026-11-04T12:00:00Z', null, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR');
    expect(
      starts(v, range('2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z')).map((s) => s.slice(0, 10)),
    ).toEqual([
      '2026-11-04', // start (Wed)
      '2026-11-06', // Fri same week
      '2026-11-16', // two weeks later: Mon, Wed, Fri
      '2026-11-18',
      '2026-11-20',
    ]);
  });

  it('MONTHLY skips months without the day', () => {
    const v: DateValue = {
      start: '2026-01-31',
      end: null,
      allDay: true,
      recurrence: 'FREQ=MONTHLY;COUNT=4',
    };
    expect(starts(v, range('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
  });

  it('includes all-day and multi-day events that overlap the range (end exclusive)', () => {
    const conf: DateValue = {
      start: '2026-11-18',
      end: '2026-11-21',
      allDay: true,
      recurrence: null,
    };
    expect(starts(conf, range('2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z'))).toEqual([
      '2026-11-18',
    ]);
    expect(starts(conf, range('2026-11-21T00:00:00Z', '2026-11-22T00:00:00Z'))).toEqual([]);
    // In UTC+5, the all-day event starts at local midnight = 19:00Z the day before.
    expect(
      starts(conf, range('2026-11-17T19:00:00Z', '2026-11-17T20:00:00Z', 'Asia/Tashkent')),
    ).toEqual(['2026-11-18']);
  });

  it('includes a point-in-time event only when its start is in [from, to)', () => {
    const v = timed('2026-11-10T10:00:00Z', null);
    expect(starts(v, range('2026-11-10T10:00:00Z', '2026-11-10T11:00:00Z'))).toHaveLength(1);
    expect(starts(v, range('2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'))).toHaveLength(0);
  });
});

describe('GET /api/calendar/events', () => {
  let t: TestContext;
  let api: ReturnType<typeof client>;
  beforeEach(async () => {
    t = await createTestApp({ seed: true });
    api = client(t.app, await login(t.app));
  });
  afterEach(async () => {
    await t.close();
  });
  const events = (from: string, to: string, extra = '') =>
    api.ok(
      CalendarEventsResponse,
      'GET',
      `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${extra}`,
    );

  it('returns timed, all-day, multi-day and recurring seeded events, sorted', async () => {
    const { events: list } = await events('2026-11-16T00:00:00Z', '2026-11-23T00:00:00Z');
    const byTitle = (title: string) => list.filter((e) => e.title === title);
    expect(byTitle('Team sync')).toHaveLength(1);
    expect(byTitle('Conference')[0]).toMatchObject({
      allDay: true,
      occurrenceStart: '2026-11-18',
      occurrenceEnd: '2026-11-21',
    });
    expect(byTitle('Weekly review').map((e) => e.occurrenceStart)).toEqual([
      '2026-11-20T16:00:00+00:00',
    ]);
    expect(byTitle('Weekly review')[0]).toMatchObject({
      recurring: true,
      start: '2026-01-02T16:00:00Z',
    });
    expect(byTitle('Morning run')).toHaveLength(3); // Nov 16–18, COUNT=10 from Nov 9
    const ids = list.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...list].sort(
      (a, b) => Date.parse(a.occurrenceStart) - Date.parse(b.occurrenceStart),
    );
    expect(list.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
  });

  it('shows a reschedule in the next range query', async () => {
    await api.ok(UpdateRowResponse, 'PATCH', `/api/rows/${SEED_IDS.rowDentist}`, {
      version: 0,
      properties: {
        [SEED_IDS.propDate]: { start: '2026-12-02', end: null, allDay: true, recurrence: null },
      },
    });
    const nov = await events('2026-11-23T00:00:00Z', '2026-11-30T00:00:00Z');
    expect(nov.events.map((e) => e.title)).not.toContain('Dentist');
    const dec = await events('2026-11-30T00:00:00Z', '2026-12-07T00:00:00Z');
    expect(dec.events.find((e) => e.title === 'Dentist')?.occurrenceStart).toBe('2026-12-02');
  });

  it('filters by database and validates the range', async () => {
    const none = await events('2026-11-16T00:00:00Z', '2026-11-23T00:00:00Z', '&databaseIds=nope');
    expect(none.events).toEqual([]);
    const bad = await api.call(
      'GET',
      '/api/calendar/events?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z',
    );
    expect(bad.status).toBe(400);
  });
});
