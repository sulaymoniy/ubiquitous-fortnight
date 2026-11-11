import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Fractional-index helpers. A position sorts between its neighbours by plain string comparison,
 * so moving an item rewrites only that item. `null` means "no neighbour on this side".
 */

/** A position strictly between `before` and `after` (either may be null). Throws if before >= after. */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new Error(`position ${before} must sort before ${after}`);
  }
  return generateKeyBetween(before, after);
}

/** `n` increasing positions strictly between `before` and `after`. */
export function positionsBetween(before: string | null, after: string | null, n: number): string[] {
  if (before !== null && after !== null && before >= after) {
    throw new Error(`position ${before} must sort before ${after}`);
  }
  return generateNKeysBetween(before, after, n);
}

/** Position after the last of `siblings` (unordered list of existing positions). */
export function positionAfterLast(siblings: readonly string[]): string {
  let last: string | null = null;
  for (const p of siblings) if (last === null || p > last) last = p;
  return generateKeyBetween(last, null);
}

/** Comparator for positions: code-unit order, the same order SQLite uses for TEXT. */
export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True if `p` is a valid fractional index produced by these helpers. */
export function isValidPosition(p: string): boolean {
  try {
    generateKeyBetween(p, null);
    return true;
  } catch {
    return false;
  }
}
