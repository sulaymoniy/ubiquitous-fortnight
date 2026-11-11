import {
  comparePositions,
  isValidPosition,
  parseRecurrence,
  positionAfterLast,
  positionBetween,
  positionsBetween,
  Position,
} from '@fortnight/shared';
import { describe, expect, it } from 'vitest';

describe('fractional positions', () => {
  it('generates keys strictly between neighbours', () => {
    const a = positionBetween(null, null);
    const c = positionBetween(a, null);
    const b = positionBetween(a, c);
    expect([c, a, b].sort(comparePositions)).toEqual([a, b, c]);
    expect(a < b && b < c).toBe(true);
  });

  it('stays ordered after 1,000 random inserts and every key is a valid Position', () => {
    // Deterministic pseudo-random sequence.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const list: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const at = Math.floor(rand() * (list.length + 1));
      const key = positionBetween(list[at - 1] ?? null, list[at] ?? null);
      list.splice(at, 0, key);
    }
    expect([...list].sort(comparePositions)).toEqual(list);
    expect(new Set(list).size).toBe(list.length);
    for (const k of list) expect(Position.safeParse(k).success).toBe(true);
  });

  it('generates n keys and appends after the last sibling', () => {
    const keys = positionsBetween(null, null, 5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort(comparePositions)).toEqual(keys);
    const after = positionAfterLast([keys[2]!, keys[4]!, keys[0]!]);
    expect(after > keys[4]!).toBe(true);
    expect(positionAfterLast([])).toBe(positionBetween(null, null));
  });

  it('validates positions', () => {
    expect(isValidPosition('a0')).toBe(true);
    expect(isValidPosition('a0V')).toBe(true);
    expect(isValidPosition('')).toBe(false);
    expect(() => positionBetween('a1', 'a0')).toThrow();
  });
});

describe('parseRecurrence', () => {
  it('parses the supported subset', () => {
    expect(parseRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=10')).toEqual({
      ok: true,
      rule: { freq: 'WEEKLY', interval: 2, byDay: ['MO', 'FR'], count: 10, until: null },
    });
    expect(parseRecurrence('RRULE:FREQ=MONTHLY;UNTIL=20261231')).toEqual({
      ok: true,
      rule: { freq: 'MONTHLY', interval: 1, byDay: null, count: null, until: '2026-12-31' },
    });
    expect(parseRecurrence('freq=daily;until=20261231T235959Z')).toEqual({
      ok: true,
      rule: {
        freq: 'DAILY',
        interval: 1,
        byDay: null,
        count: null,
        until: '2026-12-31T23:59:59Z',
      },
    });
  });

  it.each([
    ['', 'empty'],
    ['INTERVAL=2', 'FREQ is required'],
    ['FREQ=YEARLY', 'FREQ must be'],
    ['FREQ=DAILY;BYDAY=MO', 'BYDAY is only supported'],
    ['FREQ=WEEKLY;BYDAY=XX', 'BYDAY must list'],
    ['FREQ=WEEKLY;BYDAY=MO,MO', 'duplicate BYDAY'],
    ['FREQ=DAILY;COUNT=0', 'COUNT must be'],
    ['FREQ=DAILY;INTERVAL=1000', 'INTERVAL must be'],
    ['FREQ=DAILY;COUNT=2;UNTIL=20261231', 'cannot both'],
    ['FREQ=DAILY;UNTIL=2026-12-31', 'UNTIL must be'],
    ['FREQ=DAILY;FREQ=WEEKLY', 'duplicate FREQ'],
    ['FREQ=DAILY;BYMONTH=1', 'unsupported part BYMONTH'],
    ['FREQ', 'malformed'],
  ])('rejects %j (%s)', (rule, message) => {
    const r = parseRecurrence(rule);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });
});
