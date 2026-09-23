import { describe, expect, it } from 'vitest';

import {
  collectWikiLinkReferences,
  deriveMarkdown,
  derivePlainText,
  validateTiptapDocument,
  type TiptapDocument,
} from '../../shared/pages';

const assetId = '11111111-1111-4111-8111-111111111111';

const richDocument: TiptapDocument = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Markdown export' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Read ' },
        {
          type: 'text',
          marks: [{ type: 'bold' }, { type: 'italic' }],
          text: 'this',
        },
        { type: 'text', text: ' and ' },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/docs_(1)' } }],
          text: 'guide',
        },
        { type: 'hardBreak' },
        { type: 'text', text: 'next' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'First item' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Nested item' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Three' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Four' }] }],
        },
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Todo' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const fence = `value`;\n```' }],
    },
    { type: 'horizontalRule' },
    {
      type: 'paragraph',
      content: [
        {
          type: 'assetImage',
          attrs: { assetId, alt: 'Screenshot', title: 'A capture' },
        },
        { type: 'text', text: ' and ' },
        {
          type: 'attachment',
          attrs: { assetId, filename: 'notes.txt', title: 'Notes' },
        },
      ],
    },
  ],
};

describe('Tiptap content derivations', () => {
  it('keeps plaintext and Markdown deterministic across a JSON roundtrip', () => {
    expect(validateTiptapDocument(richDocument)).toEqual([]);

    const plainText = derivePlainText(richDocument);
    const markdown = deriveMarkdown(richDocument);
    const roundTripped = JSON.parse(JSON.stringify(richDocument)) as TiptapDocument;

    expect(plainText).toBe(
      'Markdown export\nRead this and guide\nnext\nFirst item\nNested item\nThree\nFour\nTodo\nDone\nQuoted\nconst fence = `value`;\n```\n\nScreenshot and notes.txt',
    );
    expect(markdown).toMatchSnapshot();
    expect(derivePlainText(roundTripped)).toBe(plainText);
    expect(deriveMarkdown(roundTripped)).toBe(markdown);
  });

  it('rejects unknown nodes, invalid list structure, and unsafe links', () => {
    const invalidDocuments: unknown[] = [
      { type: 'paragraph', content: [] },
      {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'not an item' }] }],
          },
        ],
      },
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                text: 'unsafe',
              },
            ],
          },
        ],
      },
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'wikiLink',
                attrs: {
                  targetPageId: 'not-a-uuid',
                  targetTitle: 'Missing target',
                },
              },
            ],
          },
        ],
      },
      { type: 'doc', content: [{ type: 'unknownNode' }] },
    ];

    for (const invalidDocument of invalidDocuments) {
      expect(validateTiptapDocument(invalidDocument)).not.toHaveLength(0);
      expect(() => deriveMarkdown(invalidDocument as TiptapDocument)).toThrow(
        'Cannot render an invalid Tiptap document.',
      );
    }
  });

  it('validates, derives, and de-duplicates stable wiki-link references', () => {
    const targetPageId = '22222222-2222-4222-8222-222222222222';
    const document: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ' },
            {
              type: 'wikiLink',
              attrs: { targetPageId, targetTitle: 'Cloudflare   Workers' },
            },
            { type: 'text', text: ' and ' },
            {
              type: 'wikiLink',
              attrs: { targetPageId: null, targetTitle: 'Cloudflare Workers' },
            },
            { type: 'text', text: '.' },
            {
              type: 'wikiLink',
              attrs: { targetPageId: null, targetTitle: 'Unresolved Page' },
            },
          ],
        },
      ],
    };

    expect(validateTiptapDocument(document)).toEqual([]);
    expect(derivePlainText(document)).toBe(
      'Read Cloudflare   Workers and Cloudflare Workers.Unresolved Page',
    );
    expect(deriveMarkdown(document)).toBe(
      'Read [[Cloudflare   Workers]] and [[Cloudflare Workers]].[[Unresolved Page]]',
    );
    expect(collectWikiLinkReferences(document)).toEqual([
      {
        targetPageId,
        targetTitle: 'Cloudflare Workers',
        targetTitleNormalized: 'cloudflare workers',
      },
      {
        targetPageId: null,
        targetTitle: 'Unresolved Page',
        targetTitleNormalized: 'unresolved page',
      },
    ]);
  });
});
