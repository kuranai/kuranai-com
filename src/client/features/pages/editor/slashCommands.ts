import type { Editor } from '@tiptap/core';

export type SlashCommandId =
  | 'text'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bullet-list'
  | 'ordered-list'
  | 'checklist'
  | 'quote'
  | 'inline-code'
  | 'code-block'
  | 'divider'
  | 'wiki-link'
  | 'image'
  | 'file'
  | 'template'
  | 'daily-note';

export interface SlashCommandDefinition {
  description: string;
  id: SlashCommandId;
  keywords: string[];
  label: string;
}

export interface SlashCommandQuery {
  from: number;
  query: string;
  to: number;
}

export const slashCommandDefinitions: SlashCommandDefinition[] = [
  {
    description: 'Start a plain text paragraph.',
    id: 'text',
    keywords: ['paragraph', 'plain'],
    label: 'Text',
  },
  {
    description: 'Use a large section heading.',
    id: 'heading-1',
    keywords: ['heading', 'title', 'h1'],
    label: 'Heading 1',
  },
  {
    description: 'Use a medium section heading.',
    id: 'heading-2',
    keywords: ['heading', 'h2'],
    label: 'Heading 2',
  },
  {
    description: 'Use a small section heading.',
    id: 'heading-3',
    keywords: ['heading', 'h3'],
    label: 'Heading 3',
  },
  {
    description: 'Create a bulleted list.',
    id: 'bullet-list',
    keywords: ['bullet', 'list', 'unordered'],
    label: 'Bullet List',
  },
  {
    description: 'Create a numbered list.',
    id: 'ordered-list',
    keywords: ['numbered', 'ordered', 'list'],
    label: 'Ordered List',
  },
  {
    description: 'Track tasks with checkboxes.',
    id: 'checklist',
    keywords: ['check', 'checkbox', 'task', 'todo', 'list'],
    label: 'Checklist',
  },
  {
    description: 'Set this paragraph apart as a quote.',
    id: 'quote',
    keywords: ['blockquote', 'quotation'],
    label: 'Quote',
  },
  {
    description: 'Write the next words as inline code.',
    id: 'inline-code',
    keywords: ['code', 'inline', 'monospace'],
    label: 'Inline Code',
  },
  {
    description: 'Start a fenced code block.',
    id: 'code-block',
    keywords: ['code', 'block', 'preformatted'],
    label: 'Code Block',
  },
  {
    description: 'Insert a horizontal divider.',
    id: 'divider',
    keywords: ['horizontal', 'rule', 'separator'],
    label: 'Divider',
  },
  {
    description: 'Link another page in this workspace.',
    id: 'wiki-link',
    keywords: ['wiki', 'link', 'page', 'internal'],
    label: 'Wiki Link',
  },
  {
    description: 'Upload and insert an image.',
    id: 'image',
    keywords: ['picture', 'photo', 'upload', 'asset'],
    label: 'Image',
  },
  {
    description: 'Upload and attach a file.',
    id: 'file',
    keywords: ['attachment', 'document', 'upload', 'asset'],
    label: 'File',
  },
  {
    description: 'Open the reusable page template settings.',
    id: 'template',
    keywords: ['templates', 'settings', 'reusable', 'page'],
    label: 'Template',
  },
  {
    description: 'Open or create today’s daily note.',
    id: 'daily-note',
    keywords: ['daily', 'today', 'journal', 'note'],
    label: 'Daily Note',
  },
];

function normalizedQuery(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function filterSlashCommands(query: string) {
  const normalized = normalizedQuery(query);
  if (normalized.length === 0) {
    return slashCommandDefinitions;
  }

  return slashCommandDefinitions.filter((command) =>
    [command.label, command.description, ...command.keywords].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    ),
  );
}

export function findSlashCommandQuery(editor: Editor): SlashCommandQuery | null {
  const { selection } = editor.state;
  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  if ($from.parent.type.name !== 'paragraph') {
    return null;
  }

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\u0000', '\u0000');
  const textAfter = $from.parent.textBetween(
    $from.parentOffset,
    $from.parent.content.size,
    '\u0000',
    '\u0000',
  );
  if (textAfter.length > 0) {
    return null;
  }

  const match = textBefore.match(/^\/(.*)$/u);
  if (!match) {
    return null;
  }

  return {
    from: selection.from - textBefore.length,
    query: match[1] ?? '',
    to: selection.from,
  };
}
