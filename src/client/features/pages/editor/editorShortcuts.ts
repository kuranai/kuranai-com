export const EDITOR_SHORTCUTS = {
  paragraph: 'Alt+T',
  heading1: 'Alt+1',
  heading2: 'Alt+2',
  heading3: 'Alt+3',
  bold: 'Alt+B',
  italic: 'Alt+I',
  strike: 'Alt+S',
  code: 'Alt+E',
  link: 'Alt+L',
  wikiLink: 'Alt+W',
  bulletList: 'Alt+U',
  orderedList: 'Alt+O',
  taskList: 'Alt+C',
  blockquote: 'Alt+Q',
  codeBlock: 'Alt+K',
  divider: 'Alt+R',
} as const;

export type EditorShortcutId = keyof typeof EDITOR_SHORTCUTS;

interface EditorShortcutEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

const shortcutKeys: Record<string, EditorShortcutId> = Object.fromEntries(
  (Object.entries(EDITOR_SHORTCUTS) as Array<[EditorShortcutId, string]>).map(([id, shortcut]) => [
    shortcut.slice('Alt+'.length).toLowerCase(),
    id,
  ]),
) as Record<string, EditorShortcutId>;

export function editorShortcutForEvent(event: EditorShortcutEvent): EditorShortcutId | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }

  return shortcutKeys[event.key.toLowerCase()] ?? null;
}
