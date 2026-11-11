import { z } from 'zod';

/**
 * Entity id. New server-created entities use UUIDv7 strings; the web client generates
 * UUIDv7 ids for new blocks so inserts can be optimistic.
 */
export const Id = z.string().min(1).max(64);
export type Id = z.infer<typeof Id>;

/** Entity timestamp: ISO 8601 in UTC with a `Z` suffix, e.g. `2026-11-11T10:00:00.000Z`. */
export const Timestamp = z.iso.datetime();
export type Timestamp = z.infer<typeof Timestamp>;

/** ISO 8601 date-time with an explicit offset or `Z`, e.g. `2026-11-11T09:00:00+05:00`. */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Calendar date `YYYY-MM-DD` (no time zone; interpreted in the workspace time zone). */
export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;

/**
 * Fractional index used for ordering siblings (pages, blocks, rows, properties, views, options).
 * Compare with plain string comparison (`a < b`), never `localeCompare`. Generate with the helpers
 * in `positions.ts`.
 */
export const Position = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[0-9A-Za-z]+$/, 'position must be a base62 fractional index');
export type Position = z.infer<typeof Position>;

/** IANA time zone name, e.g. `Asia/Tashkent`, `Europe/Berlin`, `UTC`. */
export const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'unknown IANA time zone');
export type TimeZone = z.infer<typeof TimeZone>;

/** Named colors for select options and user avatars; the web app maps them to theme colors. */
export const COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export const Color = z.enum(COLORS);
export type Color = z.infer<typeof Color>;

/** Every error code the API returns. Adding a code is a minor contract version bump. */
export const ERROR_CODES = [
  'validation_error', // 400: request body, params or query failed its schema
  'unauthorized', // 401: no valid `fsid` session cookie
  'not_found', // 404: unknown route or entity
  'version_conflict', // 409: stale `version`; details: VersionConflictDetails
  'undo_conflict', // 409: entities changed since the changeset; details: UndoConflictDetails
  'payload_too_large', // 413: upload over the limit
  'unsupported_media_type', // 415: upload is not an allowed image type
  'agent_key_missing', // 400 (or SSE `error`): ANTHROPIC_API_KEY is empty
  'agent_busy', // 409: the conversation already has a running agent run
  'internal_error', // 500
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Error body for every non-2xx JSON response: `{ error: { code, message, details? } }`. */
export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** `details` of a 400 `validation_error`. `path` points into the request part named by `in`. */
export const ValidationErrorDetails = z.object({
  in: z.enum(['body', 'params', 'query', 'headers']),
  issues: z.array(
    z.object({
      path: z.array(z.union([z.string(), z.number()])),
      message: z.string(),
    }),
  ),
});
export type ValidationErrorDetails = z.infer<typeof ValidationErrorDetails>;

/** Empty JSON object response, e.g. logout and delete routes. */
export const EmptyResponse = z.strictObject({});
export type EmptyResponse = z.infer<typeof EmptyResponse>;
