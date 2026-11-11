import { v7 } from 'uuid';

/** New entity id (UUIDv7: time-ordered). */
export function newId(): string {
  return v7();
}

/** Current time as an ISO UTC timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}
