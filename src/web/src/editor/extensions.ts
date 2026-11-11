import { Mark, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Mention } from '@fortnight/shared';
const Kit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      extension.name === 'code' ? extension.extend({ excludes: '' }) : extension,
    );
  },
});
const Reference = Mark.create({
  name: 'reference',
  inclusive: false,
  addAttributes() {
    return { value: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-reference]',
        getAttrs: (element) => {
          try {
            const value = element.getAttribute('data-reference');
            if (!value || !Mention.safeParse(JSON.parse(value)).success) return false;
            return { value };
          } catch {
            return false;
          }
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ class: 'inline-reference', 'data-reference': HTMLAttributes.value }),
      0,
    ];
  },
});
export function createEditorExtensions() {
  return [
    Kit.configure({
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      codeBlock: false,
      horizontalRule: false,
      trailingNode: false,
      link: { openOnClick: false },
    }),
    Reference,
  ];
}
