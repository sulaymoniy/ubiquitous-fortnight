import {
  Block,
  BlockTypeContent,
  BlockOp,
  comparePositions,
  TEXT_MARKS,
  type RichText,
  type BlockType,
} from '@fortnight/shared';
import type { JSONContent } from '@tiptap/core';

const marksToEditor: Record<string, string> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strike',
  code: 'code',
};
export function richToEditor(rich: RichText[]): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: rich.flatMap((run) => {
          if (!run.text) return [];
          const marks: { type: string; attrs?: Record<string, unknown> }[] = (run.marks ?? []).map(
            (mark) => ({ type: marksToEditor[mark]! }),
          );
          if (run.href) marks.push({ type: 'link', attrs: { href: run.href } });
          if (run.mention)
            marks.push({ type: 'reference', attrs: { value: JSON.stringify(run.mention) } });
          const pieces = run.text.split('\n');
          return pieces.flatMap((text, index) => [
            ...(index ? [{ type: 'hardBreak', ...(marks.length ? { marks } : {}) }] : []),
            ...(text ? [{ type: 'text', text, ...(marks.length ? { marks } : {}) }] : []),
          ]);
        }),
      },
    ],
  };
}
export function editorToRich(doc: JSONContent): RichText[] {
  const rich: RichText[] = [];
  function visit(node: JSONContent) {
    if ((node.type === 'text' && node.text) || node.type === 'hardBreak') {
      const run: RichText = { text: node.type === 'hardBreak' ? '\n' : node.text! };
      const marks = (node.marks ?? [])
        .filter((m) => Object.hasOwn(marksToEditor, m.type))
        .map((m) => m.type as NonNullable<RichText['marks']>[number])
        .sort((a, b) => TEXT_MARKS.indexOf(a) - TEXT_MARKS.indexOf(b));
      if (marks.length) run.marks = marks;
      for (const mark of node.marks ?? []) {
        if (mark.type === 'link' && typeof mark.attrs?.href === 'string')
          run.href = mark.attrs.href;
        if (mark.type === 'reference' && typeof mark.attrs?.value === 'string') {
          const parsed: unknown = JSON.parse(mark.attrs.value);
          // BlockTypeContent validates the resulting RichText, including mention payloads.
          run.mention = parsed as RichText['mention'];
        }
      }
      rich.push(run);
      return;
    }
    node.content?.forEach((child, index) => {
      if (node.type === 'doc' && index) rich.push({ text: '\n' });
      visit(child);
    });
  }
  visit(doc);
  return mergeRich(rich);
}
export function mergeRich(rich: RichText[]): RichText[] {
  const result: RichText[] = [];
  for (const run of rich) {
    if (!run.text) continue;
    const last = result.at(-1);
    const { text: _text, ...format } = run;
    const { text: _last, ...lastFormat } = last ?? { text: '' };
    if (last && JSON.stringify(format) === JSON.stringify(lastFormat)) last.text += run.text;
    else result.push({ ...run });
  }
  return result;
}
export function blockRich(block: Block): RichText[] {
  if ('rich' in block.content) return block.content.rich;
  if (block.type === 'code') return [{ text: block.content.text }];
  if (block.type === 'image') return block.content.caption;
  return [];
}
export function plainText(block: Block) {
  return blockRich(block)
    .map((r) => r.text)
    .join('');
}
export function withRich(block: Block, rich: RichText[]): Block {
  let content: unknown = block.content;
  if ('rich' in block.content) content = { ...block.content, rich };
  else if (block.type === 'code')
    content = { ...block.content, text: rich.map((r) => r.text).join('') };
  else if (block.type === 'image') content = { ...block.content, caption: rich };
  return Block.parse({ ...block, content });
}
export function convertBlock(block: Block, type: BlockType, rich = blockRich(block)): Block {
  const text = rich.map((r) => r.text).join('');
  let content: unknown = { rich };
  if (type === 'to_do') content = { rich, checked: false };
  if (type === 'code') content = { text, language: '' };
  if (type === 'divider') content = {};
  if (type === 'image') content = { url: 'https://', caption: rich, width: null };
  if (type === 'database_view') content = { databaseId: '', viewId: '' };
  return Block.parse({ ...block, ...BlockTypeContent.parse({ type, content }) });
}
export function orderedChildren<
  T extends { parentId: string | null; position: string; id: string },
>(items: T[], parentId: string | null) {
  return items
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => comparePositions(a.position, b.position) || a.id.localeCompare(b.id));
}
export function orderedBlocks(blocks: Block[], parentId: string | null = null): Block[] {
  return orderedChildren(blocks, parentId).flatMap((block) => [
    block,
    ...orderedBlocks(blocks, block.id),
  ]);
}
export function descendants(
  items: { id: string; parentId: string | null }[],
  id: string,
): Set<string> {
  const found = new Set<string>([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const item of items)
      if (item.parentId && found.has(item.parentId) && !found.has(item.id)) {
        found.add(item.id);
        changed = true;
      }
  }
  return found;
}
export function diffBlocks(before: Block[], after: Block[]): BlockOp[] {
  const old = new Map(before.map((b) => [b.id, b]));
  const next = new Map(after.map((b) => [b.id, b]));
  const removed = new Set(before.filter((b) => !next.has(b.id)).map((b) => b.id));
  const deletions: BlockOp[] = before
    .filter((b) => removed.has(b.id) && !(b.parentId && removed.has(b.parentId)))
    .map((b) => ({ op: 'delete', id: b.id }));
  const ops: BlockOp[] = [];
  for (const block of orderedBlocks(after)) {
    const previous = old.get(block.id);
    if (!previous) ops.push(BlockOp.parse({ op: 'insert', block }));
    else {
      if (
        previous.type !== block.type ||
        JSON.stringify(previous.content) !== JSON.stringify(block.content)
      )
        ops.push(
          BlockOp.parse({ op: 'update', id: block.id, type: block.type, content: block.content }),
        );
      if (previous.parentId !== block.parentId || previous.position !== block.position)
        ops.push({ op: 'move', id: block.id, parentId: block.parentId, position: block.position });
    }
  }
  return [...ops, ...deletions];
}
