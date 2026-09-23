import { mergeAttributes, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

import { normalizeWikiLinkTitle, pageIdSchema } from '../../../../shared/pages';

export interface WikiLinkQuery {
  from: number;
  query: string;
  to: number;
}

function pageIdFromAttribute(value: unknown) {
  return pageIdSchema.safeParse(value).success && typeof value === 'string' ? value : null;
}

function titleFromAttribute(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export const WikiLink = Node.create({
  name: 'wikiLink',

  group: 'inline',

  inline: true,

  atom: true,

  selectable: true,

  addAttributes() {
    return {
      targetPageId: {
        default: null,
        rendered: false,
      },
      targetTitle: {
        default: '',
        rendered: false,
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const targetPageId = pageIdFromAttribute(node.attrs.targetPageId);
    const targetTitle = titleFromAttribute(node.attrs.targetTitle);
    const commonAttributes = {
      'aria-label': targetPageId
        ? `Wiki link: ${targetTitle}`
        : `Unresolved wiki link: ${targetTitle}`,
      class: targetPageId ? 'wiki-link' : 'wiki-link wiki-link-unresolved',
      contenteditable: 'false',
      'data-dovari-wiki-link-title': targetTitle,
    };

    if (targetPageId) {
      return [
        'a',
        mergeAttributes(HTMLAttributes, commonAttributes, {
          'data-dovari-wiki-link-id': targetPageId,
          href: `/app/pages/${encodeURIComponent(targetPageId)}`,
        }),
        `[[${targetTitle}]]`,
      ];
    }

    return [
      'span',
      mergeAttributes(HTMLAttributes, commonAttributes, {
        'data-dovari-wiki-link-unresolved': 'true',
      }),
      `[[${targetTitle}]]`,
    ];
  },
});

export function findWikiLinkQuery(editor: Editor): WikiLinkQuery | null {
  const { selection } = editor.state;
  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.name === 'codeBlock') {
    return null;
  }

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\u0000', '\u0000');
  const match = textBefore.match(/\[\[([^\]]*)$/u);
  if (!match) {
    return null;
  }

  if (match[1]?.includes('[')) {
    return null;
  }

  const source = match[0];
  return {
    from: selection.from - source.length,
    query: match[1] ?? '',
    to: selection.from,
  };
}

export function normalizedWikiLinkQuery(value: string) {
  return normalizeWikiLinkTitle(value);
}

export function wikiLinkTitle(value: string) {
  return value.trim().replace(/\s+/gu, ' ');
}
