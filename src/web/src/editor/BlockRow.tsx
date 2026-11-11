import { InlineAI } from '../agent/InlineAI';
import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { createEditorExtensions } from './extensions';
import { Block, type RichText } from '@fortnight/shared';
import {
  GripVertical,
  Plus,
  Trash2,
  ChevronRight,
  ImagePlus,
  Bold,
  Italic,
  Underline,
  Link as LinkIcon,
  IndentIncrease,
  IndentDecrease,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  blockRich,
  convertBlock,
  editorToRich,
  plainText,
  richToEditor,
  withRich,
} from './adapter';
import type { PageSession } from './session';
import { workspaceApi } from '../api/workspace';

export const COMMANDS = [
  { type: 'ai', label: 'Ask AI…', hint: 'Write or improve with AI' },
  { type: 'paragraph', label: 'Paragraph', hint: 'Plain text' },
  { type: 'heading_1', label: 'Heading 1', hint: 'Large heading' },
  { type: 'heading_2', label: 'Heading 2', hint: 'Medium heading' },
  { type: 'heading_3', label: 'Heading 3', hint: 'Small heading' },
  { type: 'bulleted_list_item', label: 'Bulleted list', hint: 'A simple list' },
  { type: 'numbered_list_item', label: 'Numbered list', hint: 'Keep things in order' },
  { type: 'to_do', label: 'To-do', hint: 'Check something off' },
  { type: 'toggle', label: 'Toggle', hint: 'A little room for detail' },
  { type: 'code', label: 'Code', hint: 'Code with a language' },
  { type: 'quote', label: 'Quote', hint: 'Make a thought stand out' },
  { type: 'divider', label: 'Divider', hint: 'A quiet separation' },
  { type: 'image', label: 'Image', hint: 'Upload an image' },
] as const;
function splitRich(rich: RichText[], offset: number): [RichText[], RichText[]] {
  const before: RichText[] = [],
    after: RichText[] = [];
  for (const run of rich) {
    const split = Math.max(0, Math.min(offset, run.text.length));
    if (split) before.push({ ...run, text: run.text.slice(0, split) });
    if (split < run.text.length) after.push({ ...run, text: run.text.slice(split) });
    offset -= run.text.length;
  }
  return [before, after];
}
function RichEditor({
  block,
  focus,
  change,
  enter,
  keydown,
  upload,
}: {
  block: Block;
  focus: boolean;
  change: (rich: RichText[]) => void;
  enter: (before: RichText[], after: RichText[]) => void;
  keydown: (event: KeyboardEvent) => boolean;
  upload: (files: File[]) => void;
}) {
  const latest = useRef({ change, enter, keydown, upload });
  latest.current = { change, enter, keydown, upload };
  const [active, setActive] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const editor = useEditor(
    {
      extensions: createEditorExtensions(),
      content: richToEditor(blockRich(block)),
      immediatelyRender: false,
      onFocus: () => setActive(true),
      onBlur: () => setActive(false),
      onUpdate: ({ editor }) => latest.current.change(editorToRich(editor.getJSON())),
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': (COMMANDS.find((c) => c.type === block.type)?.label ?? 'Text') + ' block',
          'aria-multiline': 'true',
          'data-placeholder': "Write something, or type '/' for commands…",
        },
        handleKeyDown: (view, event) => {
          if (latest.current.keydown(event)) return true;
          if (event.key === 'Enter' && !event.shiftKey) {
            if (view.state.selection.from !== view.state.selection.to)
              editor?.commands.deleteSelection();
            const from = view.state.selection.from;
            const offset = view.state.doc.textBetween(0, from, '\n').length;
            const [before, after] = splitRich(editorToRich(editor!.getJSON()), offset);
            latest.current.enter(before, after);
            return true;
          }
          return false;
        },
        handlePaste: (_view, event) => {
          const images = [...(event.clipboardData?.files ?? [])].filter((file) =>
            file.type.startsWith('image/'),
          );
          if (images.length) {
            latest.current.upload(images);
            return true;
          }
          return false;
        },
      },
    },
    [block.id],
  );
  useEffect(() => {
    if (
      editor &&
      JSON.stringify(editorToRich(editor.getJSON())) !== JSON.stringify(blockRich(block))
    )
      editor.commands.setContent(richToEditor(blockRich(block)), { emitUpdate: false });
  }, [block, editor]);
  useEffect(() => {
    if (focus && editor) editor.commands.focus('end');
  }, [focus, editor]);
  useEffect(() => {
    if (editor)
      editor.setOptions({
        editorProps: {
          attributes: {
            role: 'textbox',
            'aria-label': (COMMANDS.find((c) => c.type === block.type)?.label ?? 'Text') + ' block',
            'aria-multiline': 'true',
          },
        },
      });
  }, [block.type, editor]);
  function format(action: (editor: Editor) => void) {
    if (editor) action(editor);
  }
  return (
    <div className="rich-input" data-empty={!plainText(block)}>
      {active && (
        <div
          className="format-toolbar"
          onMouseDown={(e) => e.preventDefault()}
          aria-label="Text formatting"
        >
          <button
            aria-label="Bold"
            onClick={() => format((e) => e.chain().focus().toggleBold().run())}
          >
            <Bold size={13} />
          </button>
          <button
            aria-label="Italic"
            onClick={() => format((e) => e.chain().focus().toggleItalic().run())}
          >
            <Italic size={13} />
          </button>
          <button
            aria-label="Underline"
            onClick={() => format((e) => e.chain().focus().toggleUnderline().run())}
          >
            <Underline size={13} />
          </button>
          <button aria-label="Add link" onClick={() => setLink('https://')}>
            <LinkIcon size={13} />
          </button>
        </div>
      )}
      {link !== null && (
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^(https?:\/\/|mailto:)/.test(link))
              editor?.chain().focus().setLink({ href: link }).run();
            else if (!link) editor?.chain().focus().unsetLink().run();
            setLink(null);
          }}
        >
          <input
            aria-label="Link URL"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            autoFocus
          />
          <button type="submit">Apply</button>
        </form>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
function safeImage(url: string) {
  try {
    return (
      url.startsWith('/uploads/') ||
      (['http:', 'https:'].includes(new URL(url).protocol) && !!new URL(url).hostname)
    );
  } catch {
    return false;
  }
}
export function BlockRow({
  block,
  session,
  children,
  focusId,
  setFocus,
  index,
}: {
  block: Block;
  session: PageSession;
  children: React.ReactNode;
  focusId: string | null;
  setFocus: (id: string | null) => void;
  index: number;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [choice, setChoice] = useState(0);
  const [open, setOpen] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const nest = useDroppable({ id: 'nest-block:' + block.id, disabled: block.type !== 'toggle' });
  const commands = COMMANDS.filter((command) =>
    (command.label + ' ' + command.hint).toLowerCase().includes((query ?? '').toLowerCase()),
  );
  function current() {
    return session.getSnapshot().blocks.find((b) => b.id === block.id) ?? block;
  }
  function change(rich: RichText[]) {
    const value = rich.map((r) => r.text).join('');
    if (value === '/ai') { session.setBlock(withRich(current(), [])); setQuery(null); setAiOpen(true); return; }
    const shortcuts: Record<string, Exclude<(typeof COMMANDS)[number]['type'], 'ai'>> = {
      '# ': 'heading_1',
      '## ': 'heading_2',
      '### ': 'heading_3',
      '- ': 'bulleted_list_item',
      '* ': 'bulleted_list_item',
      '1. ': 'numbered_list_item',
      '[] ': 'to_do',
      '[ ] ': 'to_do',
      '> ': 'quote',
      '```': 'code',
      '---': 'divider',
    };
    if (current().type === 'paragraph' && shortcuts[value]) {
      session.setBlock(convertBlock(current(), shortcuts[value]!, []));
      setQuery(null);
      return;
    }
    session.setBlock(withRich(current(), rich));
    if (value.startsWith('/') && !value.includes('\n') && value.length < 60) {
      setQuery(value.slice(1));
      setChoice(0);
    } else setQuery(null);
  }
  function pick(type: (typeof COMMANDS)[number]['type']) {
    setQuery(null);
    if (type === 'ai') { session.setBlock(withRich(current(), [])); setAiOpen(true); return; }
    if (type === 'image') {
      session.setBlock(withRich(current(), []));
      fileInput.current?.click();
      return;
    }
    session.setBlock(convertBlock(current(), type, []));
    setFocus(block.id);
    if (type === 'divider') setFocus(session.add(block.id));
  }
  async function upload(files: File[]) {
    setUploading(true);
    setError('');
    let after = block.id;
    try {
      for (const file of files) {
        if (
          !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) ||
          file.size > 10 * 1024 * 1024
        )
          throw new Error('Choose a PNG, JPEG, GIF or WebP image under 10 MB.');
        const result = await workspaceApi.upload(file);
        let target = session.getSnapshot().blocks.find((b) => b.id === after)!;
        if (after !== block.id || plainText(target) || target.type === 'image') {
          after = session.add(after);
          target = session.getSnapshot().blocks.find((b) => b.id === after)!;
        }
        session.setBlock(
          Block.parse({
            ...target,
            type: 'image',
            content: { url: result.url, caption: [], width: null },
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  function keydown(event: KeyboardEvent) {
    if (query !== null) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        setChoice(
          (i) =>
            (i + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, commands.length)) %
            Math.max(1, commands.length),
        );
        return true;
      }
      if (event.key === 'Enter' && commands[choice]) {
        pick(commands[choice]!.type);
        return true;
      }
      if (event.key === 'Escape') {
        setQuery(null);
        return true;
      }
    }
    if (event.key === 'Tab') {
      session.indent(block.id, event.shiftKey);
      return true;
    }
    if (
      event.key === 'Backspace' &&
      !plainText(current()) &&
      session.getSnapshot().blocks.length > 1
    ) {
      const previous = session.getSnapshot().blocks[index - 1];
      session.remove(block.id);
      setFocus(previous?.id ?? null);
      return true;
    }
    return false;
  }
  const rich = (
    <RichEditor
      block={block}
      focus={focusId === block.id}
      change={change}
      enter={(before, after) => setFocus(session.split(block.id, before, after))}
      keydown={keydown}
      upload={(files) => void upload(files)}
    />
  );
  return (
    <div
      ref={setNodeRef}
      className={'block-row block-' + block.type + (isDragging ? ' dragging' : '')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-block-id={block.id}
      data-block-type={block.type}
    >
      <div className="block-tools">
        <button
          className="icon-button"
          aria-label="Add block after"
          onClick={() => setFocus(session.add(block.id))}
        >
          <Plus size={14} />
        </button>
        <button
          className="icon-button block-handle"
          aria-label={'Drag ' + block.type + ' block'}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={15} />
        </button>
      </div>
      <div className="block-body">
        <div className="block-line">
          {block.type === 'to_do' && (
            <input
              className="todo-check"
              type="checkbox"
              aria-label="Complete task"
              checked={block.content.checked}
              onChange={(e) =>
                session.setBlock(
                  Block.parse({
                    ...current(),
                    content: { ...current().content, checked: e.target.checked },
                  }),
                )
              }
            />
          )}
          {block.type === 'toggle' && (
            <button
              className="icon-button toggle-block"
              aria-label={open ? 'Collapse toggle' : 'Expand toggle'}
              onClick={() => setOpen(!open)}
            >
              <ChevronRight size={15} className={open ? 'expanded' : ''} />
            </button>
          )}
          {block.type === 'bulleted_list_item' && (
            <span className="list-marker" aria-hidden="true">
              •
            </span>
          )}
          {block.type === 'numbered_list_item' && (
            <span className="list-marker" aria-hidden="true">
              {index + 1}.
            </span>
          )}
          {block.type === 'divider' ? (
            <hr />
          ) : block.type === 'code' ? (
            <div className="code-block">
              <input
                aria-label="Code language"
                maxLength={40}
                placeholder="Plain text"
                value={block.content.language}
                onChange={(e) =>
                  session.setBlock(
                    Block.parse({
                      ...current(),
                      content: { ...current().content, language: e.target.value },
                    }),
                  )
                }
              />
              <textarea
                autoFocus={focusId === block.id}
                aria-label="Code block"
                value={block.content.text}
                onChange={(e) =>
                  session.setBlock(
                    Block.parse({
                      ...current(),
                      content: { ...current().content, text: e.target.value },
                    }),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    setFocus(session.add(block.id));
                  }
                }}
              />
            </div>
          ) : block.type === 'image' ? (
            <figure className="image-block">
              {safeImage(block.content.url) && (
                <img
                  src={block.content.url}
                  alt={
                    block.content.caption.map((r) => r.text).join('') || 'Uploaded workspace image'
                  }
                  style={{ width: block.content.width ?? undefined }}
                />
              )}
              <input
                aria-label="Image caption"
                placeholder="Add a caption…"
                value={block.content.caption.map((r) => r.text).join('')}
                onChange={(e) => session.setBlock(withRich(current(), [{ text: e.target.value }]))}
              />
              <label>
                Width
                <input
                  aria-label="Image width"
                  type="number"
                  min={1}
                  max={4000}
                  value={block.content.width ?? ''}
                  placeholder="Auto"
                  onChange={(e) => {
                    const width = e.target.value ? Number(e.target.value) : null;
                    if (width === null || (width >= 1 && width <= 4000))
                      session.setBlock(
                        Block.parse({ ...current(), content: { ...current().content, width } }),
                      );
                  }}
                />
              </label>
            </figure>
          ) : block.type === 'database_view' ? (
            <div className="database-placeholder">Database view · available with databases</div>
          ) : (
            rich
          )}
        </div>
        {uploading && (
          <p className="block-hint" role="status">
            Uploading image…
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          aria-label="Choose image"
          onChange={(e) => void upload([...(e.target.files ?? [])])}
        />
        <div className="block-actions"><button aria-label="Ask AI for this block" onClick={() => setAiOpen(true)}>AI</button>
          <button aria-label="Upload image" onClick={() => fileInput.current?.click()}>
            <ImagePlus size={13} />
          </button>
          <button aria-label="Indent block" onClick={() => session.indent(block.id)}>
            <IndentIncrease size={13} />
          </button>
          <button aria-label="Outdent block" onClick={() => session.indent(block.id, true)}>
            <IndentDecrease size={13} />
          </button>
          <button aria-label="Delete block" onClick={() => session.remove(block.id)}>
            <Trash2 size={13} />
          </button>
        </div>
        {aiOpen && <InlineAI block={block} session={session} close={() => setAiOpen(false)} />}
        {query !== null && (
          <div className="slash-menu" role="listbox" aria-label="Block types">
            {commands.map((command, i) => (
              <button
                key={command.type}
                role="option"
                aria-selected={choice === i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(command.type)}
                className={choice === i ? 'highlighted' : ''}
              >
                <strong>{command.label}</strong>
                <span>{command.hint}</span>
              </button>
            ))}
            {!commands.length && <p>No matching block type.</p>}
          </div>
        )}
        {block.type === 'toggle' && (
          <div ref={nest.setNodeRef} className={'toggle-drop' + (nest.isOver ? ' over' : '')}>
            Drop a block here to nest
          </div>
        )}
        {(block.type !== 'toggle' || open) && children}
      </div>
    </div>
  );
}
