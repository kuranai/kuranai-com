import type { MouseEvent, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';

import { EDITOR_SHORTCUTS } from './editorShortcuts';

const CODE_BLOCK_LANGUAGES = [
  ['', 'Auto-detect'],
  ['plaintext', 'Plain text'],
  ['bash', 'Bash'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['css', 'CSS'],
  ['diff', 'Diff'],
  ['go', 'Go'],
  ['graphql', 'GraphQL'],
  ['xml', 'HTML / XML'],
  ['java', 'Java'],
  ['javascript', 'JavaScript'],
  ['json', 'JSON'],
  ['kotlin', 'Kotlin'],
  ['lua', 'Lua'],
  ['markdown', 'Markdown'],
  ['php', 'PHP'],
  ['python', 'Python'],
  ['r', 'R'],
  ['ruby', 'Ruby'],
  ['rust', 'Rust'],
  ['scss', 'SCSS'],
  ['sql', 'SQL'],
  ['swift', 'Swift'],
  ['typescript', 'TypeScript'],
  ['yaml', 'YAML'],
] as const;

function normalizedCodeLanguage(language: unknown) {
  if (language === 'js') {
    return 'javascript';
  }
  if (language === 'ts') {
    return 'typescript';
  }
  return typeof language === 'string' ? language : '';
}

interface ToolbarButtonProps {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  shortcut?: string;
  shortcutAria?: string;
}

function ToolbarButton({
  active,
  children,
  disabled = false,
  label,
  onClick,
  shortcut,
  shortcutAria,
}: ToolbarButtonProps) {
  function keepEditorSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  const tooltip = shortcut ? `${label} — ${shortcut}` : label;

  return (
    <button
      aria-label={label}
      aria-keyshortcuts={shortcutAria ?? shortcut}
      aria-pressed={active}
      className={active ? 'editor-toolbar-button is-active' : 'editor-toolbar-button'}
      data-tooltip={tooltip}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={keepEditorSelection}
      title={tooltip}
      type="button"
    >
      {children}
    </button>
  );
}

interface EditorToolbarProps {
  editor: Editor;
  onOpenLink: () => void;
  onOpenWikiLink: () => void;
}

export function EditorToolbar({ editor, onOpenLink, onOpenWikiLink }: EditorToolbarProps) {
  const active = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      blockquote: currentEditor.isActive('blockquote'),
      bold: currentEditor.isActive('bold'),
      bulletList: currentEditor.isActive('bulletList'),
      code: currentEditor.isActive('code'),
      codeBlock: currentEditor.isActive('codeBlock'),
      codeLanguage: normalizedCodeLanguage(currentEditor.getAttributes('codeBlock').language),
      heading1: currentEditor.isActive('heading', { level: 1 }),
      heading2: currentEditor.isActive('heading', { level: 2 }),
      heading3: currentEditor.isActive('heading', { level: 3 }),
      italic: currentEditor.isActive('italic'),
      link: currentEditor.isActive('link'),
      orderedList: currentEditor.isActive('orderedList'),
      paragraph: currentEditor.isActive('paragraph'),
      strike: currentEditor.isActive('strike'),
      taskList: currentEditor.isActive('taskList'),
    }),
  });

  return (
    <div aria-label="Text formatting" className="editor-toolbar" role="toolbar">
      <div className="editor-toolbar-group">
        <ToolbarButton
          active={active.paragraph}
          label="Text"
          onClick={() => editor.chain().focus().setParagraph().run()}
          shortcut={EDITOR_SHORTCUTS.paragraph}
        >
          Text
        </ToolbarButton>
        <ToolbarButton
          active={active.heading1}
          label="Heading 1"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          shortcut={EDITOR_SHORTCUTS.heading1}
        >
          H1
        </ToolbarButton>
        <ToolbarButton
          active={active.heading2}
          label="Heading 2"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          shortcut={EDITOR_SHORTCUTS.heading2}
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          active={active.heading3}
          label="Heading 3"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          shortcut={EDITOR_SHORTCUTS.heading3}
        >
          H3
        </ToolbarButton>
      </div>

      <span aria-hidden="true" className="editor-toolbar-separator" />

      <div className="editor-toolbar-group">
        <ToolbarButton
          active={active.bold}
          label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
          shortcut={EDITOR_SHORTCUTS.bold}
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          active={active.italic}
          label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          shortcut={EDITOR_SHORTCUTS.italic}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          active={active.strike}
          label="Strike"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          shortcut={EDITOR_SHORTCUTS.strike}
        >
          <s>S</s>
        </ToolbarButton>
        <ToolbarButton
          active={active.code}
          label="Inline code"
          onClick={() => editor.chain().focus().toggleCode().run()}
          shortcut={EDITOR_SHORTCUTS.code}
        >
          {'</>'}
        </ToolbarButton>
        <ToolbarButton
          active={active.link}
          label="Link"
          onClick={onOpenLink}
          shortcut={EDITOR_SHORTCUTS.link}
        >
          ↗
        </ToolbarButton>
        <ToolbarButton
          label="Wiki link"
          onClick={onOpenWikiLink}
          shortcut={EDITOR_SHORTCUTS.wikiLink}
        >
          Wiki link
        </ToolbarButton>
      </div>

      <span aria-hidden="true" className="editor-toolbar-separator" />

      <div className="editor-toolbar-group">
        <ToolbarButton
          active={active.bulletList}
          label="Bullet list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          shortcut={EDITOR_SHORTCUTS.bulletList}
        >
          • List
        </ToolbarButton>
        <ToolbarButton
          active={active.orderedList}
          label="Ordered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          shortcut={EDITOR_SHORTCUTS.orderedList}
        >
          1. List
        </ToolbarButton>
        <ToolbarButton
          active={active.taskList}
          label="Checklist"
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          shortcut={EDITOR_SHORTCUTS.taskList}
        >
          ☑ List
        </ToolbarButton>
        <ToolbarButton
          active={active.blockquote}
          label="Quote"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          shortcut={EDITOR_SHORTCUTS.blockquote}
        >
          “ Quote
        </ToolbarButton>
        <ToolbarButton
          active={active.codeBlock}
          label="Code block"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          shortcut={EDITOR_SHORTCUTS.codeBlock}
        >
          Code
        </ToolbarButton>
        {active.codeBlock ? (
          <label className="editor-code-language">
            <span className="visually-hidden">Code language</span>
            <select
              aria-label="Code language"
              onChange={(event) =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes('codeBlock', { language: event.target.value || null })
                  .run()
              }
              title="Code language"
              value={active.codeLanguage}
            >
              {CODE_BLOCK_LANGUAGES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <ToolbarButton
          label="Divider"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          shortcut={EDITOR_SHORTCUTS.divider}
        >
          —
        </ToolbarButton>
      </div>

      <span aria-hidden="true" className="editor-toolbar-separator" />

      <div className="editor-toolbar-group editor-toolbar-history">
        <ToolbarButton
          disabled={!editor.can().undo()}
          label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
          shortcut="Ctrl/Cmd+Z"
          shortcutAria="Control+Z Meta+Z"
        >
          ↶
        </ToolbarButton>
        <ToolbarButton
          disabled={!editor.can().redo()}
          label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
          shortcut="Ctrl/Cmd+Shift+Z"
          shortcutAria="Control+Shift+Z Meta+Shift+Z"
        >
          ↷
        </ToolbarButton>
      </div>
    </div>
  );
}
