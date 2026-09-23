import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPageEditorExtensions,
  isAllowedLinkHref,
  serializeEditorDocument,
} from './editorExtensions';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('editor link safety and autolink', () => {
  it('allows only safe link protocols and rejects control characters', () => {
    expect(isAllowedLinkHref('http://example.com')).toBe(true);
    expect(isAllowedLinkHref('https://example.com/docs')).toBe(true);
    expect(isAllowedLinkHref('mailto:person@example.com')).toBe(true);
    expect(isAllowedLinkHref('javascript:alert(1)')).toBe(false);
    expect(isAllowedLinkHref('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isAllowedLinkHref('https://example.com/line\nfeed')).toBe(false);
  });

  it('autolinks safe web and email addresses after a completion space', () => {
    editor = new Editor({
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      extensions: createPageEditorExtensions(),
    });

    editor.commands.insertContent('http://example.com ');
    editor.commands.insertContent('person@example.com ');
    editor.commands.insertContent('ftp://example.com ');

    const document = editor.getJSON();
    expect(serializeEditorDocument(document)).not.toBeNull();
    const textNodes = document.content?.[0]?.content ?? [];
    expect(textNodes).toContainEqual({
      marks: [{ attrs: expect.objectContaining({ href: 'http://example.com' }), type: 'link' }],
      text: 'http://example.com',
      type: 'text',
    });
    expect(textNodes).toContainEqual({
      marks: [
        { attrs: expect.objectContaining({ href: 'mailto:person@example.com' }), type: 'link' },
      ],
      text: 'person@example.com',
      type: 'text',
    });
    expect(
      textNodes.find(
        (node) => node.type === 'text' && 'text' in node && node.text === 'ftp://example.com',
      )?.marks,
    ).toBeUndefined();
  });
});
