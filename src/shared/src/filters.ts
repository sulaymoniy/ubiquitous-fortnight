import { z } from 'zod';

/**
 * Filter and sort grammar for database queries and saved views.
 *
 * Ops by property type (the server rejects an op that does not fit the property's type):
 * - title, text, url: contains | not_contains | equals | starts_with | is_empty | is_not_empty
 * - number: eq | neq | gt | gte | lt | lte | is_empty | is_not_empty
 * - select: is | is_not | is_empty | is_not_empty (value: option id)
 * - multi_select: contains | not_contains | is_empty | is_not_empty (value: option id)
 * - date: on | before | after | on_or_before | on_or_after (value: `YYYY-MM-DD`),
 *   between (value: `{ start, end }` dates, both inclusive),
 *   past_week | next_week | this_week | this_month | is_empty | is_not_empty (no value)
 * - checkbox: is (value: boolean)
 * - relation: contains | not_contains | is_empty | is_not_empty (value: row id)
 * Text comparisons are case-insensitive. Date ops compare calendar dates in the workspace time
 * zone; relative ops (`this_week`, ...) resolve on the server in that zone using `weekStartsOn`.
 */
export const FILTER_OPS = [
  'contains',
  'not_contains',
  'equals',
  'starts_with',
  'is_empty',
  'is_not_empty',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'is',
  'is_not',
  'on',
  'before',
  'after',
  'on_or_before',
  'on_or_after',
  'between',
  'past_week',
  'next_week',
  'this_week',
  'this_month',
] as const;
export const FilterOp = z.enum(FILTER_OPS);
export type FilterOp = z.infer<typeof FilterOp>;

export const FilterValue = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
  z.object({ start: z.iso.date(), end: z.iso.date() }),
]);
export type FilterValue = z.infer<typeof FilterValue>;

export const FilterCondition = z.strictObject({
  propertyId: z.string().min(1).max(64),
  op: FilterOp,
  value: FilterValue.optional(),
});
export type FilterCondition = z.infer<typeof FilterCondition>;

/** Max nesting depth of and/or groups that the server accepts. */
export const MAX_FILTER_DEPTH = 3;

export type Filter = { and: Filter[] } | { or: Filter[] } | FilterCondition;
export const Filter: z.ZodType<Filter> = z.lazy(() =>
  z.union([
    z.strictObject({ and: z.array(Filter).max(50) }),
    z.strictObject({ or: z.array(Filter).max(50) }),
    FilterCondition,
  ]),
);

/** Sort by a property id, or by the built-in `created_time` / `updated_time`. */
export const Sort = z.object({
  propertyId: z.string().min(1).max(64),
  direction: z.enum(['asc', 'desc']),
});
export type Sort = z.infer<typeof Sort>;
