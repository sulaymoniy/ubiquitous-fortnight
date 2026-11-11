import { z } from 'zod';
import { Color, Id, IsoDate, IsoDateTime, Position, TimeZone, Timestamp } from './common.ts';
import { Filter, Sort } from './filters.ts';
import { parseRecurrence } from './recurrence.ts';

/* ------------------------------------------------------------------ workspace and users */

export const WorkspaceSettings = z.object({
  /** All-day dates, relative date filters and recurrence expand in this zone. */
  timeZone: TimeZone,
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

export const Workspace = z.object({
  id: Id,
  name: z.string().min(1).max(200),
  settings: WorkspaceSettings,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Workspace = z.infer<typeof Workspace>;

/**
 * Mock login user (decision D2). Not a real account: derived from the login name, kept only in
 * server memory, gone after a server restart. Same name gives the same id, initials and color.
 */
export const MockUser = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  /** One or two uppercase characters for the avatar. */
  initials: z.string().min(1).max(2),
  color: Color,
});
export type MockUser = z.infer<typeof MockUser>;

/* ------------------------------------------------------------------ rich text */

export const TEXT_MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const;
export const TextMark = z.enum(TEXT_MARKS);
export type TextMark = z.infer<typeof TextMark>;

export const Mention = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), pageId: Id }),
  z.object({ type: z.literal('date'), date: z.union([IsoDate, IsoDateTime]) }),
]);
export type Mention = z.infer<typeof Mention>;

/** One run of text with the same formatting. A block's text is an array of runs. */
export const RichText = z.object({
  text: z.string().max(100_000),
  marks: z.array(TextMark).optional(),
  href: z.string().min(1).max(2048).optional(),
  mention: Mention.optional(),
});
export type RichText = z.infer<typeof RichText>;

/* ------------------------------------------------------------------ blocks */

export const BLOCK_TYPES = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'code',
  'quote',
  'divider',
  'image',
  'database_view',
] as const;
export const BlockType = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof BlockType>;

export const RichContent = z.strictObject({ rich: z.array(RichText) });
export const ToDoContent = z.strictObject({ rich: z.array(RichText), checked: z.boolean() });
export const CodeContent = z.strictObject({
  text: z.string().max(200_000),
  language: z.string().max(40),
});
export const ImageContent = z.strictObject({
  /** `/uploads/<id>` for uploaded files, or an absolute http(s) URL. */
  url: z.string().min(1).max(2048),
  caption: z.array(RichText),
  /** Display width in CSS pixels; null = natural width. */
  width: z.number().int().positive().max(4000).nullable(),
});
export const DividerContent = z.strictObject({});
export const DatabaseViewContent = z.strictObject({ databaseId: Id, viewId: Id });

/**
 * Content objects are strict: unknown keys are rejected, so content sent with the wrong `type`
 * fails instead of silently losing fields. The same holds for property configs.
 *
 * Builds the 13 `{ type, content }` variants with extra fields, so `type` and `content` always
 * agree at the schema level. Used for Block, new blocks in ops, and update ops.
 */
function blockVariantsWith<S extends Record<string, z.ZodType>>(shape: S) {
  return [
    z.object({ ...shape, type: z.literal('paragraph'), content: RichContent }),
    z.object({ ...shape, type: z.literal('heading_1'), content: RichContent }),
    z.object({ ...shape, type: z.literal('heading_2'), content: RichContent }),
    z.object({ ...shape, type: z.literal('heading_3'), content: RichContent }),
    z.object({ ...shape, type: z.literal('bulleted_list_item'), content: RichContent }),
    z.object({ ...shape, type: z.literal('numbered_list_item'), content: RichContent }),
    z.object({ ...shape, type: z.literal('to_do'), content: ToDoContent }),
    z.object({ ...shape, type: z.literal('toggle'), content: RichContent }),
    z.object({ ...shape, type: z.literal('code'), content: CodeContent }),
    z.object({ ...shape, type: z.literal('quote'), content: RichContent }),
    z.object({ ...shape, type: z.literal('divider'), content: DividerContent }),
    z.object({ ...shape, type: z.literal('image'), content: ImageContent }),
    z.object({ ...shape, type: z.literal('database_view'), content: DatabaseViewContent }),
  ] as const;
}
export const blockVariants = blockVariantsWith;

/** `{ type, content }` pair with matching content for the type. */
export const BlockTypeContent = z.discriminatedUnion('type', blockVariantsWith({}));
export type BlockTypeContent = z.infer<typeof BlockTypeContent>;
export type BlockContent<T extends BlockType> = Extract<BlockTypeContent, { type: T }>['content'];

/**
 * A block. `pageId` is the page or row whose body holds it. `parentId` is another block
 * (toggle children, nested list items) or null for top level. Siblings are ordered by `position`.
 */
export const Block = z.discriminatedUnion(
  'type',
  blockVariantsWith({
    id: Id,
    pageId: Id,
    parentId: Id.nullable(),
    position: Position,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  }),
);
export type Block = z.infer<typeof Block>;

/* ------------------------------------------------------------------ pages */

export const PageKind = z.enum(['page', 'database']);
export type PageKind = z.infer<typeof PageKind>;

/**
 * A sidebar page. Database rows are never returned as `Page`; they use `Row` (rows have bodies,
 * but they do not appear in the sidebar).
 */
export const Page = z.object({
  id: Id,
  /** Null = top level of the sidebar. */
  parentId: Id.nullable(),
  kind: PageKind,
  /** For `kind: 'database'`, the database shown by this page; null for normal pages. */
  databaseId: Id.nullable(),
  title: z.string().max(2000),
  /** An emoji or `/uploads/<id>`; null = no icon. */
  icon: z.string().max(2048).nullable(),
  /** `/uploads/<id>` or an http(s) URL; null = no cover. */
  cover: z.string().max(2048).nullable(),
  position: Position,
  /** Set when archived (soft-deleted). Archiving cascades to child pages. */
  archivedAt: Timestamp.nullable(),
  /** Incremented on every page change; send it back on PATCH to detect conflicts. */
  version: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Page = z.infer<typeof Page>;

/* ------------------------------------------------------------------ dates */

const DateOrDateTime = z.union([IsoDate, IsoDateTime]);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Value of a `date` property.
 *
 * - All-day (`allDay: true`): `start` and `end` are `YYYY-MM-DD` dates in the workspace time zone.
 *   `end` is EXCLUSIVE: a two-day event on Nov 11–12 has `start: '2026-11-11', end: '2026-11-13'`.
 *   `end: null` means a single day.
 * - Timed (`allDay: false`): `start` and `end` are ISO date-times with an offset. `end` is
 *   exclusive; `end: null` means a point in time. The server stores the values as sent.
 * - `end` must be after `start`.
 * - `recurrence` is an RRULE subset (see `recurrence.ts`), or null for a single event.
 */
export const DateValue = z
  .object({
    start: DateOrDateTime,
    end: DateOrDateTime.nullable(),
    allDay: z.boolean(),
    recurrence: z.string().max(500).nullable(),
  })
  .superRefine((v, ctx) => {
    const isDate = (s: string) => DATE_ONLY.test(s);
    if (v.allDay) {
      if (!isDate(v.start))
        ctx.addIssue({
          code: 'custom',
          path: ['start'],
          message: 'all-day start must be YYYY-MM-DD',
        });
      if (v.end !== null && !isDate(v.end))
        ctx.addIssue({ code: 'custom', path: ['end'], message: 'all-day end must be YYYY-MM-DD' });
    } else {
      if (isDate(v.start))
        ctx.addIssue({
          code: 'custom',
          path: ['start'],
          message: 'timed start needs a date-time with offset',
        });
      if (v.end !== null && isDate(v.end))
        ctx.addIssue({
          code: 'custom',
          path: ['end'],
          message: 'timed end needs a date-time with offset',
        });
    }
    if (v.end !== null && Date.parse(v.end) <= Date.parse(v.start)) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'end must be after start' });
    }
    if (v.recurrence !== null) {
      const parsed = parseRecurrence(v.recurrence);
      if (!parsed.ok) ctx.addIssue({ code: 'custom', path: ['recurrence'], message: parsed.error });
    }
  });
export type DateValue = z.infer<typeof DateValue>;

/* ------------------------------------------------------------------ databases and properties */

export const Database = z.object({
  id: Id,
  /** The `Page` (kind `database`) that shows this database in the sidebar. */
  pageId: Id,
  title: z.string().max(2000),
  /** The property of type `title`; its value is `Row.title`. */
  titlePropertyId: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Database = z.infer<typeof Database>;

export const PROPERTY_TYPES = [
  'title',
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'relation',
] as const;
export const PropertyType = z.enum(PROPERTY_TYPES);
export type PropertyType = z.infer<typeof PropertyType>;

export const SelectOption = z.object({
  id: Id,
  name: z.string().min(1).max(200),
  color: Color,
});
export type SelectOption = z.infer<typeof SelectOption>;

export const EmptyConfig = z.strictObject({});
export const NumberConfig = z.strictObject({ format: z.enum(['number', 'percent', 'currency']) });
export const SelectConfig = z.strictObject({ options: z.array(SelectOption).max(500) });
export const RelationConfig = z.strictObject({ targetDatabaseId: Id });
export const PropertyConfig = z.union([NumberConfig, SelectConfig, RelationConfig, EmptyConfig]);
export type PropertyConfig = z.infer<typeof PropertyConfig>;

/** Builds the 9 `{ type, config }` property variants with extra fields. */
function propertyVariantsWith<S extends Record<string, z.ZodType>>(shape: S) {
  return [
    z.object({ ...shape, type: z.literal('title'), config: EmptyConfig }),
    z.object({ ...shape, type: z.literal('text'), config: EmptyConfig }),
    z.object({ ...shape, type: z.literal('number'), config: NumberConfig }),
    z.object({ ...shape, type: z.literal('select'), config: SelectConfig }),
    z.object({ ...shape, type: z.literal('multi_select'), config: SelectConfig }),
    z.object({ ...shape, type: z.literal('date'), config: EmptyConfig }),
    z.object({ ...shape, type: z.literal('checkbox'), config: EmptyConfig }),
    z.object({ ...shape, type: z.literal('url'), config: EmptyConfig }),
    z.object({ ...shape, type: z.literal('relation'), config: RelationConfig }),
  ] as const;
}
export const propertyVariants = propertyVariantsWith;

/** `{ type, config }` pair with matching config. Used when creating properties. */
export const PropertyDefinition = z.discriminatedUnion(
  'type',
  propertyVariantsWith({ name: z.string().min(1).max(200) }),
);
export type PropertyDefinition = z.infer<typeof PropertyDefinition>;

export const Property = z.discriminatedUnion(
  'type',
  propertyVariantsWith({
    id: Id,
    databaseId: Id,
    name: z.string().min(1).max(200),
    position: Position,
  }),
);
export type Property = z.infer<typeof Property>;

/**
 * Value stored for one property on a row, by property type:
 * text, url: string | null · number: number | null · checkbox: boolean ·
 * select: option id | null · multi_select: option id[] · relation: row id[] ·
 * date: DateValue | null. The `title` property is not stored here; it is `Row.title`.
 * The server checks each value against its property's type.
 */
export const PropertyValue = z.union([
  z.null(),
  z.string().max(100_000),
  z.number().finite(),
  z.boolean(),
  z.array(Id).max(1000),
  DateValue,
]);
export type PropertyValue = z.infer<typeof PropertyValue>;

/**
 * A database row. Stored like a page (it can have a body of blocks, read with `GET /api/rows/:id`),
 * but never listed in the sidebar and never parsed as `Page`.
 */
export const Row = z.object({
  id: Id,
  databaseId: Id,
  position: Position,
  title: z.string().max(2000),
  /** Keyed by property id. Missing keys mean "empty" for that property. */
  properties: z.record(Id, PropertyValue),
  archivedAt: Timestamp.nullable(),
  version: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Row = z.infer<typeof Row>;

/* ------------------------------------------------------------------ views */

export const VIEW_TYPES = ['table', 'board', 'list', 'gallery', 'calendar'] as const;
export const ViewType = z.enum(VIEW_TYPES);
export type ViewType = z.infer<typeof ViewType>;

export const ViewConfig = z.object({
  filter: Filter.optional(),
  sorts: z.array(Sort).max(20).optional(),
  visiblePropertyIds: z.array(Id).optional(),
  /** Column widths in CSS pixels by property id (table). */
  propertyWidths: z.record(Id, z.number().int().min(40).max(2000)).optional(),
  /** Board: a `select` property. */
  groupByPropertyId: Id.optional(),
  /** Gallery: a property id, or `'page_cover'` for the row's cover. */
  coverPropertyId: z.string().min(1).max(64).optional(),
  /** Calendar: a `date` property. */
  datePropertyId: Id.optional(),
  calendarMode: z.enum(['month', 'week', 'day']).optional(),
});
export type ViewConfig = z.infer<typeof ViewConfig>;

export const View = z.object({
  id: Id,
  databaseId: Id,
  name: z.string().min(1).max(200),
  position: Position,
  type: ViewType,
  config: ViewConfig,
});
export type View = z.infer<typeof View>;

/* ------------------------------------------------------------------ calendar */

/**
 * One occurrence of a row with a date value, as returned by `GET /api/calendar/events`.
 *
 * - `start`, `end`, `allDay`, `recurrence` are the row's stored DateValue (the series).
 * - `occurrenceStart`, `occurrenceEnd` are this occurrence. For a non-recurring event they equal
 *   `start` and `end`. For recurring events `occurrenceEnd` keeps the series duration.
 *   Formats follow `allDay` (dates or date-times); expanded date-times carry the workspace
 *   time zone's offset at that occurrence.
 * - Identity: `rowId` + `occurrenceStart`, also given as `id` = `${rowId}:${occurrenceStart}`.
 * - Reschedule by PATCHing the row's date property (`PATCH /api/rows/:id`); for a recurring
 *   event that moves the whole series.
 */
export const EventOccurrence = z.object({
  id: z.string().min(1),
  rowId: Id,
  databaseId: Id,
  datePropertyId: Id,
  title: z.string(),
  start: DateOrDateTime,
  end: DateOrDateTime.nullable(),
  allDay: z.boolean(),
  recurring: z.boolean(),
  recurrence: z.string().nullable(),
  occurrenceStart: DateOrDateTime,
  occurrenceEnd: DateOrDateTime.nullable(),
});
export type EventOccurrence = z.infer<typeof EventOccurrence>;

/* ------------------------------------------------------------------ undo log */

export const ENTITY_KINDS = [
  'workspace',
  'page',
  'row',
  'block',
  'database',
  'property',
  'view',
] as const;
export const EntityKind = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof EntityKind>;

/**
 * One stored-state change in a changeset. `put` writes the complete stored state of an entity
 * (insert or replace); `remove` deletes it. Applying `inverse` in order undoes `ops`.
 * `value` is the server's stored representation and is informational for clients.
 */
export const ChangeOp = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('put'),
    entity: EntityKind,
    id: Id,
    value: z.record(z.string(), z.unknown()),
  }),
  z.object({ kind: z.literal('remove'), entity: EntityKind, id: Id }),
]);
export type ChangeOp = z.infer<typeof ChangeOp>;

export const ChangesetSource = z.enum(['user', 'agent', 'ai_inline']);
export type ChangesetSource = z.infer<typeof ChangesetSource>;

/** Undo log entry. Every mutation writes exactly one changeset. */
export const Changeset = z.object({
  id: Id,
  source: ChangesetSource,
  /** Short human label, e.g. "Edit page", "Agent: create_event", "AI: summarize". */
  label: z.string().max(200),
  agentRunId: Id.nullable(),
  toolUseId: z.string().max(128).nullable(),
  ops: z.array(ChangeOp),
  inverse: z.array(ChangeOp),
  createdAt: Timestamp,
  undoneAt: Timestamp.nullable(),
});
export type Changeset = z.infer<typeof Changeset>;
