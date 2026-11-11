import {
  blocksToMarkdown,
  markdownToNodes,
  markdownToRich,
  nodesToMarkdown,
  normalizeRich,
  richToMarkdown,
  SEED_IDS,
  type BlockNode,
} from '@fortnight/server';
import { BlockTypeContent, GetPageResponse, type RichText, type TextMark } from '@fortnight/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { client } from './api-helpers.ts';
import { createTestApp, login, type TestContext } from './helpers.ts';

const p = (...rich: RichText[]): BlockNode => ({
  type: 'paragraph',
  content: { rich },
  children: [],
});
const n = (type: BlockNode['type'], text: string, children: BlockNode[] = []): BlockNode =>
  ({ type, content: { rich: text ? [{ text }] : [] }, children }) as BlockNode;

/** Strips ids so trees compare by content only, and checks every node against the contract. */
function plainTree(nodes: BlockNode[]): BlockNode[] {
  return nodes.map((x) => {
    BlockTypeContent.parse({ type: x.type, content: x.content });
    return { type: x.type, content: x.content, children: plainTree(x.children) } as BlockNode;
  });
}
const roundTrip = (nodes: BlockNode[]) => plainTree(markdownToNodes(nodesToMarkdown(nodes)));
/** The canonical form of a tree: adjacent runs with the same formatting merged. */
const normalizeTree = (nodes: BlockNode[]): BlockNode[] =>
  nodes.map((x) => {
    const content =
      'rich' in x.content ? { ...x.content, rich: normalizeRich(x.content.rich) } : x.content;
    return { ...x, content, children: normalizeTree(x.children) } as BlockNode;
  });

describe('markdown → blocks', () => {
  it('parses every supported block form', () => {
    const md = [
      '# Title',
      '## Sub',
      '#### Deep',
      'Plain **bold** *it* ~~gone~~ `code` <u>under</u> [link](https://x.test/a)',
      '- one',
      '  - nested',
      '- [ ] todo',
      '- [x] done',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '> more',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '---',
      '',
      '![A cat](/uploads/abc)',
      '',
      '<details>',
      '<summary>Open me</summary>',
      '',
      'hidden',
      '',
      '</details>',
    ].join('\n');
    const nodes = plainTree(markdownToNodes(md));
    expect(nodes.map((x) => x.type)).toEqual([
      'heading_1',
      'heading_2',
      'heading_3',
      'paragraph',
      'bulleted_list_item',
      'to_do',
      'to_do',
      'numbered_list_item',
      'numbered_list_item',
      'quote',
      'code',
      'divider',
      'image',
      'toggle',
    ]);
    expect(nodes[3]!.content).toEqual({
      rich: [
        { text: 'Plain ' },
        { text: 'bold', marks: ['bold'] },
        { text: ' ' },
        { text: 'it', marks: ['italic'] },
        { text: ' ' },
        { text: 'gone', marks: ['strike'] },
        { text: ' ' },
        { text: 'code', marks: ['code'] },
        { text: ' ' },
        { text: 'under', marks: ['underline'] },
        { text: ' ' },
        { text: 'link', href: 'https://x.test/a' },
      ],
    });
    expect(nodes[4]!.children.map((c) => c.type)).toEqual(['bulleted_list_item']);
    expect(nodes[6]!.content).toEqual({ rich: [{ text: 'done' }], checked: true });
    expect(nodes[9]!.content).toEqual({ rich: [{ text: 'quoted\nmore' }] });
    expect(nodes[10]!.content).toEqual({ text: 'const a = 1;', language: 'ts' });
    expect(nodes[12]!.content).toEqual({
      url: '/uploads/abc',
      caption: [{ text: 'A cat' }],
      width: null,
    });
    expect(nodes[13]!.children).toEqual([p({ text: 'hidden' })]);
  });

  it('handles Windows line endings and empty input', () => {
    expect(plainTree(markdownToNodes('a\r\n\r\nb'))).toEqual([p({ text: 'a' }), p({ text: 'b' })]);
    expect(markdownToNodes('')).toEqual([]);
  });

  it('keeps unknown HTML as text instead of dropping it', () => {
    expect(plainTree(markdownToNodes('<div>hi</div>'))).toEqual([p({ text: '<div>hi</div>' })]);
  });
});

describe('blocks → markdown → blocks round trip', () => {
  it('keeps every block type, nesting, numbering and list boundaries', () => {
    const tree: BlockNode[] = [
      n('heading_1', 'H1'),
      n('heading_2', 'H2'),
      n('heading_3', 'H3'),
      p({ text: 'Para' }),
      n('bulleted_list_item', 'b1', [
        n('bulleted_list_item', 'b1.1', [
          { type: 'to_do', content: { rich: [{ text: 'deep' }], checked: false }, children: [] },
        ]),
      ]),
      n('bulleted_list_item', 'b2'),
      n('numbered_list_item', 'n1', [n('numbered_list_item', 'n1.1')]),
      n('numbered_list_item', 'n2'),
      { type: 'to_do', content: { rich: [{ text: 't1' }], checked: true }, children: [] },
      { type: 'to_do', content: { rich: [{ text: 't2' }], checked: false }, children: [] },
      n('numbered_list_item', 'after todos'),
      n('quote', 'Quote\nsecond line'),
      { type: 'code', content: { text: 'a ``` b\n  indented', language: 'md' }, children: [] },
      { type: 'code', content: { text: 'plain', language: '' }, children: [] },
      { type: 'divider', content: {}, children: [] },
      {
        type: 'image',
        content: { url: '/uploads/x', caption: [{ text: 'cap [1]' }], width: null },
        children: [],
      },
      {
        type: 'image',
        content: { url: 'https://x.test/a.png?a=1&b="2"', caption: [{ text: 'w' }], width: 320 },
        children: [],
      },
      n('toggle', 'Outer', [
        p({ text: 'inside' }),
        n('toggle', 'Inner', [n('bulleted_list_item', 'in list')]),
      ]),
      n('toggle', 'Empty toggle'),
      { type: 'database_view', content: { databaseId: 'db1', viewId: 'v1' }, children: [] },
    ];
    expect(roundTrip(tree)).toEqual(tree);
  });

  it('keeps inline formatting, links, mentions, line breaks and special characters', () => {
    const rich: RichText[] = [
      { text: '1. not a list # * _ [x] <b> ~ | & \\ end' },
      { text: ' ' },
      { text: 'bold', marks: ['bold'] },
      { text: ' ' },
      { text: 'all', marks: ['bold', 'italic', 'underline', 'strike'] },
      { text: ' ' },
      { text: 'a`tick', marks: ['code'] },
      { text: ' ' },
      { text: '`edge`', marks: ['code', 'bold'] },
      { text: ' ' },
      { text: 'site', marks: ['italic'], href: 'https://example.com/a_b?c=1&d=(2)' },
      { text: ' ' },
      { text: 'My page', mention: { type: 'page', pageId: SEED_IDS.ideas } },
      { text: ' ' },
      { text: 'Nov 11', mention: { type: 'date', date: '2026-11-11' } },
      { text: '\nnext line' },
    ];
    const expected = normalizeRich(rich); // merges the first two runs, canonical mark order
    expect(expected).toHaveLength(rich.length - 1);
    expect(markdownToRich(richToMarkdown(rich))).toEqual(expected);
    expect(roundTrip([p(...rich)])).toEqual([p(...expected)]);
  });

  it('lifts children of blocks that Markdown cannot nest', () => {
    const tree = [
      n('heading_1', 'H', [p({ text: 'child' })]),
      n('quote', 'Q', [p({ text: 'qc' })]),
    ];
    expect(roundTrip(tree)).toEqual([
      n('heading_1', 'H'),
      p({ text: 'child' }),
      n('quote', 'Q'),
      p({ text: 'qc' }),
    ]);
  });

  it('survives 1,000 random documents', () => {
    let seed = 2026;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const CHARS = 'abcXYZ019 *_~`[]()<>#&|\\!-+=.:;"\'/ éß日本';
    const word = () => {
      let s = '';
      const len = 1 + Math.floor(rand() * 8);
      for (let i = 0; i < len; i++) s += pick([...CHARS]);
      return s.trim() || 'w';
    };
    const MARKS: TextMark[] = ['bold', 'italic', 'underline', 'strike', 'code'];
    const richText = (): RichText[] => {
      const runs: RichText[] = [];
      const count = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < count; i++) {
        if (i > 0) runs.push({ text: ' ' });
        const marks = MARKS.filter(() => rand() < 0.25);
        let text = word();
        if (marks.includes('code')) text = text.replace(/`/g, '') || 'c';
        const run: RichText = { text };
        if (marks.length) run.marks = marks;
        const r = rand();
        if (r < 0.1) run.href = `https://ex.test/${Math.floor(rand() * 100)}?q=a_b`;
        else if (r < 0.15) run.mention = { type: 'page', pageId: `p${Math.floor(rand() * 9)}` };
        runs.push(run);
      }
      return runs;
    };
    const LEAF = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'quote'] as const;
    const NESTING = ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle'] as const;
    const makeNodes = (depth: number): BlockNode[] => {
      const out: BlockNode[] = [];
      const count = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < count; i++) {
        const r = rand();
        if (r < 0.45 || depth >= 3) {
          const type = pick(LEAF);
          out.push({ type, content: { rich: richText() }, children: [] } as BlockNode);
        } else if (r < 0.85) {
          const type = pick(NESTING);
          const children = rand() < 0.5 ? makeNodes(depth + 1) : [];
          const listChildren =
            type === 'toggle'
              ? children
              : children.filter((c) => NESTING.includes(c.type as (typeof NESTING)[number]));
          const content =
            type === 'to_do' ? { rich: richText(), checked: rand() < 0.5 } : { rich: richText() };
          out.push({ type, content, children: listChildren } as BlockNode);
        } else if (r < 0.9) {
          out.push({ type: 'divider', content: {}, children: [] });
        } else {
          out.push({
            type: 'code',
            content: { text: `${word()}\n${word()}`, language: pick(['', 'ts', 'py']) },
            children: [],
          });
        }
      }
      return out;
    };
    for (let i = 0; i < 1000; i++) {
      const tree = makeNodes(0);
      const md = nodesToMarkdown(tree);
      expect(roundTrip(tree), md).toEqual(normalizeTree(tree));
    }
  });
});

describe('seeded page', () => {
  let t: TestContext;
  beforeEach(async () => {
    t = await createTestApp({ seed: true });
  });
  afterEach(async () => {
    await t.close();
  });

  it('round-trips "Getting started" (every block type) through Markdown', async () => {
    const api = client(t.app, await login(t.app));
    const { blocks } = await api.ok(
      GetPageResponse,
      'GET',
      `/api/pages/${SEED_IDS.gettingStarted}`,
    );
    const md = blocksToMarkdown(blocks);
    expect(md).toContain('# Welcome to Fortnight');
    expect(md).toContain('<details>');
    expect(md).toContain('<!-- database_view');
    const back = plainTree(markdownToNodes(md));
    const expected = plainTree(markdownToNodes(blocksToMarkdown(blocks)));
    expect(back).toEqual(expected);
    // Same tree as the stored blocks (ids aside).
    const count = (ns: BlockNode[]): number => ns.reduce((s, x) => s + 1 + count(x.children), 0);
    expect(count(back)).toBe(blocks.length);
  });
});
