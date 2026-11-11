import {
  TEXT_MARKS,
  type Block,
  type BlockTypeContent,
  type RichText,
  type TextMark,
} from '@fortnight/shared';
import { Lexer, type Token, type Tokens } from 'marked';

/**
 * Markdown ↔ blocks, for the agent's tools (plan 4.6): pages go in and out as Markdown.
 *
 * Mapping:
 * - `#`, `##`, `###` (deeper headings become heading_3) · paragraphs · `- ` bullets ·
 *   `1. ` numbered items · `- [ ]` / `- [x]` to-dos · `> ` quotes · fenced code with language ·
 *   `---` divider · `![caption](url)` image (`<img src alt width>` when a width is set) ·
 *   `<details><summary>…</summary> … </details>` toggle, its children inside ·
 *   `<!-- database_view {"databaseId":…,"viewId":…} -->` inline database.
 * - Inline: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `<u>underline</u>`, `[text](href)`,
 *   page mention `[text](fortnight:page/<id>)`, date mention `[text](fortnight:date/<date>)`,
 *   line break inside a block `<br>`.
 * - Children are kept for list items, to-dos and toggles (indentation / `<details>`). Children of
 *   other blocks are written after their parent at the same level (Markdown cannot nest them).
 * - Lossy by design: leading/trailing spaces of a block, image caption formatting, and HTML other
 *   than the forms above (kept as plain text).
 */

export type BlockNode = BlockTypeContent & { children: BlockNode[] };

const MARK_ORDER = new Map(TEXT_MARKS.map((m, i) => [m, i]));
const PAGE_LINK = 'fortnight:page/';
const DATE_LINK = 'fortnight:date/';

/* ------------------------------------------------------------------ blocks → Markdown */

function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]<>~|&]/g, '\\$&');
}

/** Escapes characters that would start a block at the beginning of a line. */
function escapeLineStart(md: string): string {
  return md.replace(/^(\s*)([#+=-]|\d+[.)])/, (_m, sp: string, tok: string) =>
    /^\d/.test(tok) ? `${sp}${tok.slice(0, -1)}\\${tok.slice(-1)}` : `${sp}\\${tok}`,
  );
}

function wrapKeepingSpace(text: string, open: string, close: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return m[2] === '' ? text : `${m[1]}${open}${m[2]}${close}${m[3]}`;
}

function runToMarkdown(run: RichText): string {
  const marks = new Set(run.marks ?? []);
  const parts = run.text.split('\n');
  const rendered = parts.map((part) => {
    let s: string;
    if (marks.has('code')) {
      const ticks = part.includes('`') ? '``' : '`';
      const pad = part.startsWith('`') || part.endsWith('`') ? ' ' : '';
      s = part === '' ? '' : `${ticks}${pad}${part}${pad}${ticks}`;
    } else {
      s = escapeText(part);
    }
    if (marks.has('strike')) s = wrapKeepingSpace(s, '~~', '~~');
    if (marks.has('italic')) s = wrapKeepingSpace(s, '*', '*');
    if (marks.has('bold')) s = wrapKeepingSpace(s, '**', '**');
    if (marks.has('underline')) s = wrapKeepingSpace(s, '<u>', '</u>');
    return s;
  });
  let out = rendered.join('<br>');
  const href = run.mention
    ? run.mention.type === 'page'
      ? `${PAGE_LINK}${run.mention.pageId}`
      : `${DATE_LINK}${run.mention.date}`
    : run.href;
  if (href !== undefined) out = `[${out}](<${href.replace(/[<>]/g, encodeURIComponent)}>)`;
  return out;
}

export function richToMarkdown(rich: RichText[]): string {
  return escapeLineStart(rich.map(runToMarkdown).join(''));
}

const indent = (text: string, by: number) =>
  text
    .split('\n')
    .map((l) => (l === '' ? l : ' '.repeat(by) + l))
    .join('\n');

function nodeToMarkdown(node: BlockNode, number: number): string {
  const kids = (by: number) =>
    node.children.length ? '\n' + indent(nodesToMarkdown(node.children), by) : '';
  switch (node.type) {
    case 'paragraph':
      return richToMarkdown(node.content.rich);
    case 'heading_1':
      return `# ${richToMarkdown(node.content.rich)}`;
    case 'heading_2':
      return `## ${richToMarkdown(node.content.rich)}`;
    case 'heading_3':
      return `### ${richToMarkdown(node.content.rich)}`;
    case 'bulleted_list_item':
      return `- ${richToMarkdown(node.content.rich)}${kids(2)}`;
    case 'numbered_list_item': {
      const marker = `${number}. `;
      return `${marker}${richToMarkdown(node.content.rich)}${kids(marker.length)}`;
    }
    case 'to_do':
      return `- [${node.content.checked ? 'x' : ' '}] ${richToMarkdown(node.content.rich)}${kids(2)}`;
    case 'quote':
      return `> ${richToMarkdown(node.content.rich)}`;
    case 'code': {
      const longest = Math.max(2, ...(node.content.text.match(/`+/g) ?? []).map((m) => m.length));
      const fence = '`'.repeat(longest + 1);
      return `${fence}${node.content.language}\n${node.content.text}\n${fence}`;
    }
    case 'divider':
      return '---';
    case 'image': {
      const { url, caption, width } = node.content;
      const alt = caption.map((r) => r.text).join('');
      if (width !== null) {
        const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `<img src="${attr(url)}" alt="${attr(alt)}" width="${width}">`;
      }
      return `![${escapeText(alt)}](<${url}>)`;
    }
    case 'toggle': {
      const inner = node.children.length ? `\n\n${nodesToMarkdown(node.children)}` : '';
      return `<details>\n<summary>${richToMarkdown(node.content.rich)}</summary>${inner}\n\n</details>`;
    }
    case 'database_view':
      return `<!-- database_view ${JSON.stringify(node.content)} -->`;
  }
}

const isListType = (t: BlockNode['type']) =>
  t === 'bulleted_list_item' || t === 'numbered_list_item' || t === 'to_do';
const CHILDREN_KEPT = new Set<BlockNode['type']>([
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
]);

export function nodesToMarkdown(nodes: BlockNode[]): string {
  // Children that Markdown cannot nest are lifted to follow their parent.
  const flat: BlockNode[] = [];
  const lift = (n: BlockNode) => {
    if (CHILDREN_KEPT.has(n.type)) {
      flat.push(n);
    } else {
      flat.push({ ...n, children: [] } as BlockNode);
      n.children.forEach(lift);
    }
  };
  nodes.forEach(lift);

  let out = '';
  let number = 0;
  flat.forEach((node, i) => {
    const prev = flat[i - 1];
    number =
      node.type === 'numbered_list_item' && prev?.type === 'numbered_list_item' ? number + 1 : 1;
    if (i > 0) {
      // Consecutive items of the same list stay tight; everything else is separated by a blank
      // line. A different list type right after a list needs a separator comment.
      const sameList =
        prev &&
        isListType(prev.type) &&
        isListType(node.type) &&
        (prev.type === 'numbered_list_item') === (node.type === 'numbered_list_item');
      if (sameList) out += '\n';
      else if (prev && isListType(prev.type) && isListType(node.type)) out += '\n\n<!-- -->\n\n';
      else out += '\n\n';
    }
    out += nodeToMarkdown(node, number);
  });
  return out;
}

/* ------------------------------------------------------------------ Markdown → blocks */

interface InlineState {
  marks: TextMark[];
  href?: string;
}

function sortMarks(marks: Iterable<TextMark>): TextMark[] {
  return [...new Set(marks)].sort((a, b) => MARK_ORDER.get(a)! - MARK_ORDER.get(b)!);
}

function makeRun(text: string, state: InlineState): RichText {
  const run: RichText = { text };
  const marks = sortMarks(state.marks);
  if (marks.length) run.marks = marks;
  if (state.href !== undefined) {
    if (state.href.startsWith(PAGE_LINK)) {
      run.mention = { type: 'page', pageId: state.href.slice(PAGE_LINK.length) };
    } else if (state.href.startsWith(DATE_LINK)) {
      run.mention = { type: 'date', date: state.href.slice(DATE_LINK.length) };
    } else {
      run.href = state.href;
    }
  }
  return run;
}

function inlineRuns(tokens: Token[] | undefined, state: InlineState, out: RichText[]): void {
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case 'text':
      case 'escape': {
        const t = tok as Tokens.Text;
        if (t.tokens && t.tokens.length) inlineRuns(t.tokens, state, out);
        else out.push(makeRun(t.text, state));
        break;
      }
      case 'strong':
        inlineRuns(
          (tok as Tokens.Strong).tokens,
          { ...state, marks: [...state.marks, 'bold'] },
          out,
        );
        break;
      case 'em':
        inlineRuns((tok as Tokens.Em).tokens, { ...state, marks: [...state.marks, 'italic'] }, out);
        break;
      case 'del':
        inlineRuns(
          (tok as Tokens.Del).tokens,
          { ...state, marks: [...state.marks, 'strike'] },
          out,
        );
        break;
      case 'codespan':
        out.push(
          makeRun((tok as Tokens.Codespan).text, { ...state, marks: [...state.marks, 'code'] }),
        );
        break;
      case 'link': {
        const l = tok as Tokens.Link;
        inlineRuns(l.tokens, { ...state, href: decodeURIComponentSafe(l.href) }, out);
        break;
      }
      case 'br':
        out.push(makeRun('\n', state));
        break;
      case 'html': {
        const html = (tok as Tokens.HTML).text.trim().toLowerCase();
        if (html === '<u>') state.marks.push('underline');
        else if (html === '</u>') {
          const i = state.marks.lastIndexOf('underline');
          if (i >= 0) state.marks.splice(i, 1);
        } else if (/^<br\s*\/?>$/.test(html)) out.push(makeRun('\n', state));
        else out.push(makeRun((tok as Tokens.HTML).text, state));
        break;
      }
      case 'image': {
        const img = tok as Tokens.Image;
        out.push(makeRun(img.text, state));
        break;
      }
      default:
        if ('text' in tok && typeof tok.text === 'string') out.push(makeRun(tok.text, state));
    }
  }
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Merges adjacent runs with the same formatting and drops empty ones. */
export function normalizeRich(rich: RichText[]): RichText[] {
  const out: RichText[] = [];
  const key = (r: RichText) =>
    JSON.stringify([sortMarks(r.marks ?? []), r.href ?? null, r.mention ?? null]);
  for (const r of rich) {
    if (r.text === '') continue;
    const clean = makeRunFrom(r);
    const last = out[out.length - 1];
    if (last && key(last) === key(clean)) last.text += clean.text;
    else out.push(clean);
  }
  return out;
}

function makeRunFrom(r: RichText): RichText {
  const run: RichText = { text: r.text };
  const marks = sortMarks(r.marks ?? []);
  if (marks.length) run.marks = marks;
  if (r.href !== undefined) run.href = r.href;
  if (r.mention !== undefined) run.mention = r.mention;
  return run;
}

export function markdownToRich(md: string): RichText[] {
  const out: RichText[] = [];
  inlineRuns(Lexer.lexInline(md), { marks: [] }, out);
  return normalizeRich(out);
}

const richOf = (tokens: Token[] | undefined): RichText[] => {
  const out: RichText[] = [];
  inlineRuns(tokens, { marks: [] }, out);
  return normalizeRich(out);
};

const node = (b: BlockTypeContent, children: BlockNode[] = []): BlockNode =>
  ({ ...b, children }) as BlockNode;

function parseImgTag(html: string): BlockNode | null {
  const m = /^<img\b([^>]*)\/?>$/i.exec(html.trim());
  if (!m) return null;
  const attr = (name: string) => {
    const a = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(m[1]!);
    return a ? a[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
  };
  const src = attr('src');
  if (!src) return null;
  const width = Number(attr('width'));
  const alt = attr('alt') ?? '';
  return node({
    type: 'image',
    content: {
      url: src,
      caption: alt ? [{ text: alt }] : [],
      width: Number.isInteger(width) && width > 0 ? width : null,
    },
  });
}

function listItems(list: Tokens.List): BlockNode[] {
  return list.items.map((item) => {
    let rich: RichText[] = [];
    const rest: Token[] = [];
    let first = true;
    for (const t of item.tokens) {
      if (t.type === 'checkbox') continue;
      if (first && (t.type === 'text' || t.type === 'paragraph')) {
        rich = richOf((t as Tokens.Text).tokens);
      } else {
        rest.push(t);
      }
      first = false;
    }
    // Parse the remaining tokens together so <details> open and close tags pair up.
    const children = tokensToNodes(rest);
    if (item.task) {
      return node({ type: 'to_do', content: { rich, checked: !!item.checked } }, children);
    }
    return node(
      { type: list.ordered ? 'numbered_list_item' : 'bulleted_list_item', content: { rich } },
      children,
    );
  });
}

function tokensToNodes(tokens: Token[]): BlockNode[] {
  const root: BlockNode[] = [];
  // Open <details> toggles; tokens go into the innermost one.
  const stack: BlockNode[] = [];
  const push = (...nodes: BlockNode[]) => {
    const top = stack[stack.length - 1];
    (top ? top.children : root).push(...nodes);
  };

  for (const tok of tokens) {
    switch (tok.type) {
      case 'space':
        break;
      case 'heading': {
        const h = tok as Tokens.Heading;
        const type = h.depth === 1 ? 'heading_1' : h.depth === 2 ? 'heading_2' : 'heading_3';
        push(node({ type, content: { rich: richOf(h.tokens) } }));
        break;
      }
      case 'paragraph': {
        const p = tok as Tokens.Paragraph;
        const only = p.tokens.filter((t) => !(t.type === 'text' && t.raw.trim() === ''));
        if (only.length === 1 && only[0]!.type === 'image') {
          const img = only[0] as Tokens.Image;
          push(
            node({
              type: 'image',
              content: {
                url: img.href,
                caption: img.text ? [{ text: img.text }] : [],
                width: null,
              },
            }),
          );
        } else {
          push(node({ type: 'paragraph', content: { rich: richOf(p.tokens) } }));
        }
        break;
      }
      case 'list':
        push(...listItems(tok as Tokens.List));
        break;
      case 'blockquote': {
        const q = tok as Tokens.Blockquote;
        const lines: RichText[][] = [];
        const rest: Token[] = [];
        for (const t of q.tokens) {
          if (t.type === 'paragraph') lines.push(richOf((t as Tokens.Paragraph).tokens));
          else if (t.type !== 'space') rest.push(t);
        }
        const rich = normalizeRich(lines.flatMap((l, i) => (i === 0 ? l : [{ text: '\n' }, ...l])));
        push(node({ type: 'quote', content: { rich } }), ...tokensToNodes(rest));
        break;
      }
      case 'code': {
        const c = tok as Tokens.Code;
        push(
          node({ type: 'code', content: { text: c.text, language: (c.lang ?? '').slice(0, 40) } }),
        );
        break;
      }
      case 'hr':
        push(node({ type: 'divider', content: {} }));
        break;
      case 'html': {
        const html = (tok as Tokens.HTML).text.trim();
        const view = /^<!--\s*database_view\s+(\{.*\})\s*-->$/s.exec(html);
        if (view) {
          try {
            const v = JSON.parse(view[1]!) as { databaseId?: unknown; viewId?: unknown };
            if (typeof v.databaseId === 'string' && typeof v.viewId === 'string') {
              push(
                node({
                  type: 'database_view',
                  content: { databaseId: v.databaseId, viewId: v.viewId },
                }),
              );
            }
          } catch {
            // not a valid view comment: ignore it
          }
          break;
        }
        if (/^<!--[\s\S]*-->$/.test(html)) break; // other comments (list separators) vanish
        const open = /^<details\b[^>]*>\s*(?:<summary>([\s\S]*?)<\/summary>)?([\s\S]*)$/i.exec(
          html,
        );
        if (open) {
          const toggle = node({ type: 'toggle', content: { rich: markdownToRich(open[1] ?? '') } });
          push(toggle);
          let rest = open[2] ?? '';
          const closesHere = /<\/details>\s*$/i.test(rest);
          if (closesHere) rest = rest.replace(/<\/details>\s*$/i, '');
          if (rest.trim()) toggle.children.push(...markdownToNodes(rest));
          if (!closesHere) stack.push(toggle);
          break;
        }
        if (/^<\/details>$/i.test(html)) {
          stack.pop();
          break;
        }
        const img = parseImgTag(html);
        if (img) {
          push(img);
          break;
        }
        push(node({ type: 'paragraph', content: { rich: [{ text: html }] } }));
        break;
      }
      default:
        if ('text' in tok && typeof tok.text === 'string' && tok.text.trim()) {
          push(node({ type: 'paragraph', content: { rich: [{ text: tok.text }] } }));
        }
    }
  }
  return root;
}

export function markdownToNodes(md: string): BlockNode[] {
  return tokensToNodes(Lexer.lex(md.replace(/\r\n?/g, '\n')));
}

/* ------------------------------------------------------------------ flat blocks ↔ tree */

export type IdBlockNode = BlockNode & { id: string; children: IdBlockNode[] };

/** Builds the tree from flat blocks (any order); siblings sorted by position, then id. */
export function blocksToTree(blocks: Block[]): IdBlockNode[] {
  const sorted = [...blocks].sort((a, b) =>
    a.position !== b.position ? (a.position < b.position ? -1 : 1) : a.id < b.id ? -1 : 1,
  );
  const nodes = new Map<string, IdBlockNode>(
    sorted.map((b) => [
      b.id,
      { id: b.id, type: b.type, content: b.content, children: [] } as unknown as IdBlockNode,
    ]),
  );
  const roots: IdBlockNode[] = [];
  for (const b of sorted) {
    const n = nodes.get(b.id)!;
    const parent = b.parentId ? nodes.get(b.parentId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  return roots;
}

export function blocksToMarkdown(blocks: Block[]): string {
  return nodesToMarkdown(blocksToTree(blocks));
}
