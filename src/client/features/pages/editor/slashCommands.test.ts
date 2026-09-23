import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createPageEditorExtensions } from './editorExtensions';
import {
  filterSlashCommands,
  findSlashCommandQuery,
  slashCommandDefinitions,
} from './slashCommands';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('slash commands', () => {
  it('filters the complete allowlisted command set by label and aliases', () => {
    expect(filterSlashCommands('')).toHaveLength(slashCommandDefinitions.length);
    expect(filterSlashCommands('heading').map((command) => command.id)).toEqual([
      'heading-1',
      'heading-2',
      'heading-3',
    ]);
    expect(filterSlashCommands('attach').map((command) => command.id)).toEqual(['file']);
    expect(filterSlashCommands('template').map((command) => command.id)).toEqual(['template']);
    expect(filterSlashCommands('daily').map((command) => command.id)).toEqual(['daily-note']);
    expect(filterSlashCommands('unknown')).toEqual([]);
  });

  it('only detects a slash query that occupies an empty paragraph', () => {
    editor = new Editor({
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '/head' }] }],
      },
      extensions: createPageEditorExtensions(),
    });
    editor.commands.setTextSelection(6);

    expect(findSlashCommandQuery(editor)).toEqual({ from: 1, query: 'head', to: 6 });

    editor.commands.insertContentAt(1, 'before ');
    expect(findSlashCommandQuery(editor)).toBeNull();
  });
});
