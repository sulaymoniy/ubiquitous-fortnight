import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  positionsBetween,
  type BlockTypeContent,
  type PropertyValue,
  type RichText,
  type ViewConfig,
} from '@fortnight/shared';
import { rebuildSearchIndex } from '../services/search.ts';
import type { AppDatabase } from './client.ts';
import * as t from './schema.ts';

/**
 * Deterministic, idempotent seed: fixed ids, fixed timestamps, `INSERT ... ON CONFLICT DO NOTHING`.
 * Running it again changes nothing, and it never overwrites a user's edits to seeded entities.
 */

const SEED_TIME = '2026-01-01T00:00:00.000Z';

/** Fixed UUIDv7-shaped ids so tests and e2e can refer to seeded entities. */
function seedId(n: number): string {
  return `01940000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

export const SEED_IDS = {
  workspace: seedId(0x1),
  gettingStarted: seedId(0x10),
  projects: seedId(0x11),
  fortnightApp: seedId(0x12),
  ideas: seedId(0x13),
  calendarPage: seedId(0x14),
  calendarDb: seedId(0x20),
  propName: seedId(0x21),
  propDate: seedId(0x22),
  propTags: seedId(0x23),
  propNotes: seedId(0x24),
  optWork: seedId(0x25),
  optPersonal: seedId(0x26),
  optFocus: seedId(0x27),
  viewCalendar: seedId(0x28),
  viewTable: seedId(0x29),
  rowTeamSync: seedId(0x30),
  rowConference: seedId(0x31),
  rowDentist: seedId(0x32),
  rowWeeklyReview: seedId(0x33),
  rowMorningRun: seedId(0x34),
  upload: seedId(0x40),
} as const;

/** A 1x1 PNG used for the seeded image block. */
const SEED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export interface SeedOptions {
  /** Time zone for the workspace, used only when the workspace is created. */
  timeZone: string;
  /** Where the seeded image file goes (`<dataDir>/uploads`). */
  uploadsDir: string;
}

export interface SeedResult {
  /** True when this run created the workspace (first seed on this database). */
  createdWorkspace: boolean;
}

const txt = (text: string, marks?: RichText['marks']): RichText =>
  marks ? { text, marks } : { text };
const rich = (...runs: RichText[]) => ({ rich: runs });

interface SeedBlock {
  id: string;
  parentId: string | null;
  block: BlockTypeContent;
}

export function seedDatabase(db: AppDatabase, options: SeedOptions): SeedResult {
  const ids = SEED_IDS;
  let blockCounter = 0x1000;
  const nextBlockId = () => seedId(blockCounter++);

  const result = db.transaction((tx) => {
    const created = tx
      .insert(t.workspace)
      .values({
        id: ids.workspace,
        name: 'Fortnight',
        settings: { timeZone: options.timeZone, weekStartsOn: 1 },
        createdAt: SEED_TIME,
        updatedAt: SEED_TIME,
      })
      .onConflictDoNothing()
      .run();

    const [p0, p1, p2] = positionsBetween(null, null, 3) as [string, string, string];
    const insertPage = (v: Omit<typeof t.pages.$inferInsert, 'createdAt' | 'updatedAt'>) =>
      tx
        .insert(t.pages)
        .values({ version: 0, ...v, createdAt: SEED_TIME, updatedAt: SEED_TIME })
        .onConflictDoNothing()
        .run();

    insertPage({
      id: ids.gettingStarted,
      parentId: null,
      kind: 'page',
      title: 'Getting started',
      icon: '👋',
      position: p0,
    });
    insertPage({
      id: ids.projects,
      parentId: null,
      kind: 'page',
      title: 'Projects',
      icon: '📁',
      position: p1,
    });
    insertPage({
      id: ids.fortnightApp,
      parentId: ids.projects,
      kind: 'page',
      title: 'Fortnight app',
      position: p0,
    });
    insertPage({
      id: ids.ideas,
      parentId: ids.fortnightApp,
      kind: 'page',
      title: 'Ideas',
      position: p0,
    });
    insertPage({
      id: ids.calendarPage,
      parentId: null,
      kind: 'database',
      databaseId: ids.calendarDb,
      title: 'Calendar',
      icon: '📅',
      position: p2,
    });

    // Upload for the image block.
    mkdirSync(options.uploadsDir, { recursive: true });
    const uploadFile = path.join(options.uploadsDir, ids.upload);
    if (!existsSync(uploadFile)) writeFileSync(uploadFile, SEED_PNG);
    tx.insert(t.uploads)
      .values({
        id: ids.upload,
        fileName: 'welcome.png',
        mimeType: 'image/png',
        size: SEED_PNG.length,
        createdAt: SEED_TIME,
      })
      .onConflictDoNothing()
      .run();

    // Calendar database: Name, Date, Tags, Notes.
    tx.insert(t.databases)
      .values({
        id: ids.calendarDb,
        pageId: ids.calendarPage,
        title: 'Calendar',
        titlePropertyId: ids.propName,
        createdAt: SEED_TIME,
        updatedAt: SEED_TIME,
      })
      .onConflictDoNothing()
      .run();
    const propPositions = positionsBetween(null, null, 4);
    const propDefs: Pick<typeof t.properties.$inferInsert, 'id' | 'name' | 'type' | 'config'>[] = [
      { id: ids.propName, name: 'Name', type: 'title', config: {} },
      { id: ids.propDate, name: 'Date', type: 'date', config: {} },
      {
        id: ids.propTags,
        name: 'Tags',
        type: 'multi_select',
        config: {
          options: [
            { id: ids.optWork, name: 'Work', color: 'blue' },
            { id: ids.optPersonal, name: 'Personal', color: 'green' },
            { id: ids.optFocus, name: 'Focus', color: 'purple' },
          ],
        },
      },
      { id: ids.propNotes, name: 'Notes', type: 'text', config: {} },
    ];
    const props = propDefs.map((p, i) => ({
      ...p,
      databaseId: ids.calendarDb,
      position: propPositions[i]!,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    }));
    tx.insert(t.properties).values(props).onConflictDoNothing().run();

    const viewConfigs: [string, string, 'calendar' | 'table', ViewConfig][] = [
      [
        ids.viewCalendar,
        'Calendar',
        'calendar',
        { datePropertyId: ids.propDate, calendarMode: 'month' },
      ],
      [
        ids.viewTable,
        'All events',
        'table',
        { sorts: [{ propertyId: ids.propDate, direction: 'asc' }] },
      ],
    ];
    const viewPositions = positionsBetween(null, null, viewConfigs.length);
    tx.insert(t.views)
      .values(
        viewConfigs.map(([id, name, type, config], i) => ({
          id,
          databaseId: ids.calendarDb,
          name,
          type,
          config,
          position: viewPositions[i]!,
          createdAt: SEED_TIME,
          updatedAt: SEED_TIME,
        })),
      )
      .onConflictDoNothing()
      .run();

    // Events: timed, multi-day all-day, single all-day, and two recurring series.
    const event = (
      id: string,
      title: string,
      date: PropertyValue,
      tags: string[],
      notes: string | null,
    ) => ({
      id,
      title,
      properties: { [ids.propDate]: date, [ids.propTags]: tags, [ids.propNotes]: notes },
    });
    const events = [
      event(
        ids.rowTeamSync,
        'Team sync',
        {
          start: '2026-11-16T10:00:00Z',
          end: '2026-11-16T11:00:00Z',
          allDay: false,
          recurrence: null,
        },
        [ids.optWork],
        'Agenda in the Projects page.',
      ),
      event(
        ids.rowConference,
        'Conference',
        { start: '2026-11-18', end: '2026-11-21', allDay: true, recurrence: null },
        [ids.optWork],
        'Three days, Nov 18–20 (end date is exclusive).',
      ),
      event(
        ids.rowDentist,
        'Dentist',
        { start: '2026-11-25', end: null, allDay: true, recurrence: null },
        [ids.optPersonal],
        null,
      ),
      event(
        ids.rowWeeklyReview,
        'Weekly review',
        {
          start: '2026-01-02T16:00:00Z',
          end: '2026-01-02T17:00:00Z',
          allDay: false,
          recurrence: 'FREQ=WEEKLY;BYDAY=FR',
        },
        [ids.optWork, ids.optFocus],
        'Every Friday.',
      ),
      event(
        ids.rowMorningRun,
        'Morning run',
        {
          start: '2026-11-09T06:30:00Z',
          end: '2026-11-09T07:15:00Z',
          allDay: false,
          recurrence: 'FREQ=DAILY;COUNT=10',
        },
        [ids.optPersonal],
        null,
      ),
    ];
    const rowPositions = positionsBetween(null, null, events.length);
    events.forEach((e, i) =>
      insertPage({
        id: e.id,
        parentId: null,
        kind: 'row',
        databaseId: ids.calendarDb,
        title: e.title,
        properties: e.properties,
        position: rowPositions[i]!,
      }),
    );

    // Blocks. "Getting started" has every block type, including nested ones.
    const gs: SeedBlock[] = [];
    const add = (parentId: string | null, block: BlockTypeContent) => {
      const id = nextBlockId();
      gs.push({ id, parentId, block });
      return id;
    };
    add(null, { type: 'heading_1', content: rich(txt('Welcome to Fortnight')) });
    add(null, {
      type: 'paragraph',
      content: {
        rich: [
          txt('A workspace with '),
          txt('pages', ['bold']),
          txt(', '),
          txt('databases', ['italic']),
          txt(' and a '),
          { text: 'calendar', mention: { type: 'page', pageId: ids.calendarPage } },
          txt('. Press '),
          txt('/', ['code']),
          txt(' for blocks.'),
        ],
      },
    });
    add(null, { type: 'heading_2', content: rich(txt('Lists')) });
    const bullet = add(null, { type: 'bulleted_list_item', content: rich(txt('A bullet')) });
    add(bullet, { type: 'bulleted_list_item', content: rich(txt('A nested bullet')) });
    add(null, { type: 'numbered_list_item', content: rich(txt('First step')) });
    add(null, { type: 'numbered_list_item', content: rich(txt('Second step')) });
    add(null, { type: 'to_do', content: { rich: [txt('Try the editor')], checked: true } });
    add(null, {
      type: 'to_do',
      content: { rich: [txt('Ask the agent something')], checked: false },
    });
    add(null, { type: 'heading_3', content: rich(txt('More blocks')) });
    const toggle = add(null, { type: 'toggle', content: rich(txt('Click to open')) });
    add(toggle, { type: 'paragraph', content: rich(txt('Hidden inside a toggle.')) });
    add(null, {
      type: 'code',
      content: { text: 'console.log("hello, fortnight");', language: 'typescript' },
    });
    add(null, {
      type: 'quote',
      content: rich(txt('Every change is observable and undoable.')),
    });
    add(null, { type: 'divider', content: {} });
    add(null, {
      type: 'image',
      content: { url: `/uploads/${ids.upload}`, caption: [txt('A tiny image')], width: null },
    });
    add(null, {
      type: 'database_view',
      content: { databaseId: ids.calendarDb, viewId: ids.viewTable },
    });

    const pageBlocks: [string, SeedBlock[]][] = [[ids.gettingStarted, gs]];
    const simple = (pageId: string, ...paragraphs: string[]) => {
      pageBlocks.push([
        pageId,
        paragraphs.map((p) => ({
          id: nextBlockId(),
          parentId: null,
          block: { type: 'paragraph', content: rich(txt(p)) },
        })),
      ]);
    };
    simple(ids.projects, 'Projects live here. Open "Fortnight app" for a nested page.');
    simple(ids.fortnightApp, 'Notion-like workspace with a calendar and a Claude agent.');
    simple(ids.ideas, 'Templates', 'Dark mode', 'Export to Markdown');
    simple(ids.rowWeeklyReview, 'Look back at the week and plan the next one.');

    for (const [pageId, list] of pageBlocks) {
      // Positions per parent, in insertion order.
      const byParent = new Map<string | null, SeedBlock[]>();
      for (const b of list) byParent.set(b.parentId, [...(byParent.get(b.parentId) ?? []), b]);
      for (const siblings of byParent.values()) {
        const positions = positionsBetween(null, null, siblings.length);
        tx.insert(t.blocks)
          .values(
            siblings.map((b, i) => ({
              id: b.id,
              pageId,
              parentId: b.parentId,
              type: b.block.type,
              content: b.block.content,
              position: positions[i]!,
              createdAt: SEED_TIME,
              updatedAt: SEED_TIME,
            })),
          )
          .onConflictDoNothing()
          .run();
      }
    }

    tx.insert(t.appSettings)
      .values({ key: 'defaultAgentProfileId', value: 'sonnet-full' })
      .onConflictDoNothing()
      .run();

    // Derived data: rebuilt from scratch, so it is identical on every run.
    rebuildSearchIndex(db); // same connection, inside this transaction

    return { createdWorkspace: created.changes > 0 };
  });

  return result;
}
