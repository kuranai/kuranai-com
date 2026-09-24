import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';

import type { PageSummary, TiptapDocument } from '../../../../shared/pages';
import type { UploadAsset } from '../../assets/api';
import { createPage, searchWikiLinkPages, type PageApiError } from '../api';
import { EditorToolbar } from './EditorToolbar';
import { editorShortcutForEvent, type EditorShortcutId } from './editorShortcuts';
import {
  createPageEditorExtensions,
  safeEditorDocument,
  serializeEditorDocument,
} from './editorExtensions';
import {
  LinkPopover,
  type EditorLinkSelection,
  type LinkPopoverMode,
  type LinkPopoverPosition,
} from './LinkPopover';
import {
  AssetUploadController,
  clipboardMayContainImage,
  filesFromClipboard,
  readClipboardImageFiles,
} from './assetUpload';
import {
  findWikiLinkQuery,
  normalizedWikiLinkQuery,
  type WikiLinkQuery,
  wikiLinkTitle,
} from './wikiLinks';
import { WikiLinkPicker, type WikiLinkPickerOption } from './WikiLinkPicker';
import { SlashCommandPalette } from './SlashCommandPalette';
import {
  filterSlashCommands,
  findSlashCommandQuery,
  type SlashCommandDefinition,
  type SlashCommandQuery,
} from './slashCommands';

export interface PageEditorProps {
  content: TiptapDocument;
  onChange?: (content: TiptapDocument) => void;
  pageId?: string;
  onNavigateToPage?: (pageId: string) => void;
  onPageCreated?: (page: PageSummary) => void;
  onOpenTemplateSettings?: () => void;
  onOpenDailyNote?: () => void;
  toolbarAccessory?: ReactNode;
  createWikiLinkPage?: typeof createPage;
  searchWikiLinkPages?: typeof searchWikiLinkPages;
  uploadAsset?: UploadAsset;
}

interface WikiLinkSession extends WikiLinkQuery {
  position: LinkPopoverPosition;
  source: 'autocomplete' | 'slash' | 'toolbar';
}

interface SlashCommandSession extends SlashCommandQuery {
  position: LinkPopoverPosition;
}

interface LinkPopoverSession extends EditorLinkSelection {
  mode: LinkPopoverMode;
  position: LinkPopoverPosition;
}

function containsControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function sameWikiLinkSession(left: WikiLinkSession | null, right: WikiLinkSession | null) {
  return (
    left?.from === right?.from &&
    left?.to === right?.to &&
    left?.query === right?.query &&
    left?.position.left === right?.position.left &&
    left?.position.top === right?.position.top &&
    left?.source === right?.source
  );
}

function sameSlashCommandSession(
  left: SlashCommandSession | null,
  right: SlashCommandSession | null,
) {
  return (
    left?.from === right?.from &&
    left?.to === right?.to &&
    left?.query === right?.query &&
    left?.position.left === right?.position.left &&
    left?.position.top === right?.position.top
  );
}

function popupPosition(editor: Editor, position: number): LinkPopoverPosition {
  let left = 24;
  let top = 180;
  try {
    const coordinates = editor.view.coordsAtPos(position);
    left = Math.max(12, coordinates.left);
    top = Math.max(12, coordinates.bottom + 8);
  } catch {
    // JSDOM and some embedded editor hosts do not expose layout coordinates.
  }

  if (typeof window !== 'undefined') {
    left = Math.min(left, Math.max(12, window.innerWidth - 380));
    top = Math.min(top, Math.max(12, window.innerHeight - 260));
  }

  return { left, top };
}

function createWikiLinkNode(editor: Editor, session: WikiLinkSession, page: PageSummary) {
  const nodeType = editor.state.schema.nodes.wikiLink;
  if (!nodeType) {
    return false;
  }

  const node = nodeType.create({ targetPageId: page.id, targetTitle: page.title });
  const transaction = editor.state.tr.replaceWith(session.from, session.to, node);
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

function pageErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as PageApiError).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }

  return 'The page could not be created.';
}

function useVisualViewportKeyboardInset() {
  const [viewportState, setViewportState] = useState({
    keyboardInset: 0,
    visualViewportBottom: 0,
  });

  useEffect(() => {
    function updateKeyboardInset() {
      const viewport = window.visualViewport;
      if (!viewport) {
        setViewportState({ keyboardInset: 0, visualViewportBottom: window.innerHeight });
        return;
      }

      const visualViewportBottom = Math.min(
        window.innerHeight,
        Math.round(viewport.offsetTop + viewport.height),
      );
      const nextState = {
        keyboardInset: Math.max(0, Math.round(window.innerHeight - visualViewportBottom)),
        visualViewportBottom,
      };
      setViewportState((currentState) =>
        currentState.keyboardInset === nextState.keyboardInset &&
        currentState.visualViewportBottom === nextState.visualViewportBottom
          ? currentState
          : nextState,
      );
    }

    updateKeyboardInset();
    window.addEventListener('orientationchange', updateKeyboardInset);
    window.addEventListener('resize', updateKeyboardInset);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', updateKeyboardInset);
    viewport?.addEventListener('scroll', updateKeyboardInset);

    return () => {
      window.removeEventListener('orientationchange', updateKeyboardInset);
      window.removeEventListener('resize', updateKeyboardInset);
      viewport?.removeEventListener('resize', updateKeyboardInset);
      viewport?.removeEventListener('scroll', updateKeyboardInset);
    };
  }, []);

  return viewportState;
}

export function PageEditor({
  content,
  createWikiLinkPage = createPage,
  onChange,
  onNavigateToPage,
  onPageCreated,
  onOpenTemplateSettings,
  onOpenDailyNote,
  pageId,
  searchWikiLinkPages: searchWikiLinkPagesRequest = searchWikiLinkPages,
  toolbarAccessory,
  uploadAsset,
}: PageEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const { keyboardInset, visualViewportBottom } = useVisualViewportKeyboardInset();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [slashCommandSession, setSlashCommandSession] = useState<SlashCommandSession | null>(null);
  const [slashCommandActiveIndex, setSlashCommandActiveIndex] = useState(0);
  const [wikiLinkSession, setWikiLinkSession] = useState<WikiLinkSession | null>(null);
  const [wikiLinkPages, setWikiLinkPages] = useState<PageSummary[]>([]);
  const [wikiLinkActiveIndex, setWikiLinkActiveIndex] = useState(0);
  const [wikiLinkError, setWikiLinkError] = useState<string | null>(null);
  const [isSearchingWikiLinks, setIsSearchingWikiLinks] = useState(false);
  const [isCreatingWikiLink, setIsCreatingWikiLink] = useState(false);
  const [linkPopoverSession, setLinkPopoverSession] = useState<LinkPopoverSession | null>(null);
  const slashAssetInputRef = useRef<HTMLInputElement>(null);
  const slashAssetPositionRef = useRef<number | null>(null);
  const assetUpload = useMemo(
    () => new AssetUploadController({ pageId, upload: uploadAsset }),
    [pageId, uploadAsset],
  );
  const extensions = useMemo(() => createPageEditorExtensions({ assetUpload }), [assetUpload]);
  const initialContent = useMemo(() => safeEditorDocument(content), [content]);

  const updateSlashCommandSession = useCallback((currentEditor: Editor) => {
    const query = findSlashCommandQuery(currentEditor);
    if (!query) {
      setSlashCommandSession((current) => (current === null ? current : null));
      return;
    }

    const next: SlashCommandSession = {
      ...query,
      position: popupPosition(currentEditor, query.to),
    };
    setSlashCommandSession((current) => (sameSlashCommandSession(current, next) ? current : next));
  }, []);

  const updateWikiLinkSession = useCallback((currentEditor: Editor) => {
    const query = findWikiLinkQuery(currentEditor);
    if (!query) {
      setWikiLinkSession((current) => (current === null ? current : null));
      return;
    }

    const next: WikiLinkSession = {
      ...query,
      position: popupPosition(currentEditor, query.to),
      source: 'autocomplete',
    };
    setWikiLinkSession((current) => (sameWikiLinkSession(current, next) ? current : next));
  }, []);

  const editor = useEditor(
    {
      content: initialContent,
      editorProps: {
        attributes: {
          'aria-label': 'Page content',
          'aria-multiline': 'true',
          class: 'page-editor-content',
          role: 'textbox',
          spellcheck: 'true',
        },
      },
      extensions,
      immediatelyRender: false,
      onUpdate: ({ editor: currentEditor }) => {
        const serialized = serializeEditorDocument(currentEditor.getJSON());
        if (serialized) {
          onChangeRef.current?.(serialized);
        }
        updateSlashCommandSession(currentEditor);
        updateWikiLinkSession(currentEditor);
      },
      onSelectionUpdate: ({ editor: currentEditor }) => {
        updateSlashCommandSession(currentEditor);
        updateWikiLinkSession(currentEditor);
      },
    },
    [extensions, updateSlashCommandSession, updateWikiLinkSession],
  );

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current?.querySelector<HTMLDivElement>('.editor-toolbar');
    if (!toolbar) {
      return;
    }

    const updateToolbarHeight = () => {
      const nextHeight = Math.round(toolbar.getBoundingClientRect().height);
      setToolbarHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight,
      );
    };

    updateToolbarHeight();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateToolbarHeight);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [editor]);

  function editorSelectionForLink(link?: HTMLAnchorElement) {
    if (!editor) {
      return null;
    }

    if (link) {
      try {
        const linkPosition = editor.view.posAtDOM(link, 0);
        editor.chain().focus().setTextSelection(linkPosition).extendMarkRange('link').run();
      } catch {
        return null;
      }
    } else if (editor.isActive('link')) {
      editor.chain().focus().extendMarkRange('link').run();
    }

    return {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
  }

  function openLinkPopover(mode: LinkPopoverMode) {
    if (!editor) {
      return;
    }

    const selection = editorSelectionForLink();
    if (!selection) {
      return;
    }

    setWikiLinkSession(null);
    setLinkPopoverSession({
      ...selection,
      mode,
      position: popupPosition(editor, selection.to),
    });
  }

  function openWikiLinkPicker() {
    if (!editor) {
      return;
    }

    const selection = editor.state.selection;
    setLinkPopoverSession(null);
    setWikiLinkError(null);
    setWikiLinkSession({
      from: selection.from,
      position: popupPosition(editor, selection.to),
      query: '',
      source: 'toolbar',
      to: selection.to,
    });
  }

  const normalizedQuery = normalizedWikiLinkQuery(wikiLinkSession?.query ?? '');
  const linkTitle = wikiLinkTitle(wikiLinkSession?.query ?? '');
  const hasExactPage = wikiLinkPages.some(
    (page) => normalizedWikiLinkQuery(page.title) === normalizedQuery,
  );
  const canCreatePage =
    linkTitle.length > 0 &&
    linkTitle.length <= 200 &&
    !hasExactPage &&
    !containsControlCharacters(linkTitle);
  const wikiLinkOptions = [
    ...wikiLinkPages.map((page) => ({ kind: 'page' as const, page })),
    ...(canCreatePage ? [{ kind: 'create' as const, title: linkTitle }] : []),
  ];
  const slashCommandOptions = useMemo(
    () => filterSlashCommands(slashCommandSession?.query ?? ''),
    [slashCommandSession?.query],
  );

  useEffect(() => {
    setSlashCommandActiveIndex(slashCommandOptions.length > 0 ? 0 : -1);
  }, [slashCommandOptions.length, slashCommandSession?.query]);

  useEffect(() => {
    if (wikiLinkSession === null) {
      setWikiLinkPages([]);
      setWikiLinkError(null);
      setIsSearchingWikiLinks(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setWikiLinkPages([]);
    setIsSearchingWikiLinks(true);
    setWikiLinkError(null);
    setWikiLinkActiveIndex(0);

    searchWikiLinkPagesRequest(wikiLinkSession.query, controller.signal)
      .then((response) => {
        if (active) {
          setWikiLinkPages(response.pages);
        }
      })
      .catch((error: unknown) => {
        if (active && !controller.signal.aborted) {
          setWikiLinkPages([]);
          setWikiLinkError(pageErrorMessage(error));
        }
      })
      .finally(() => {
        if (active) {
          setIsSearchingWikiLinks(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [searchWikiLinkPagesRequest, wikiLinkSession?.query]);

  function dismissSlashCommands() {
    setSlashCommandSession(null);
    editor?.view.focus();
  }

  function deleteSlashQuery(session: SlashCommandSession) {
    if (!editor) {
      return null;
    }

    const deleted = editor
      .chain()
      .focus()
      .deleteRange({ from: session.from, to: session.to })
      .run();
    return deleted ? session.from : null;
  }

  function openSlashWikiLinkPicker(session: SlashCommandSession) {
    if (!editor) {
      return;
    }

    setSlashCommandSession(null);
    setLinkPopoverSession(null);
    setWikiLinkError(null);
    setWikiLinkSession({
      from: session.from,
      position: popupPosition(editor, session.to),
      query: '',
      source: 'slash',
      to: session.to,
    });
  }

  function openSlashAssetPicker(kind: 'image' | 'file', session: SlashCommandSession) {
    const insertionPosition = deleteSlashQuery(session);
    if (insertionPosition === null || !slashAssetInputRef.current) {
      return;
    }

    setSlashCommandSession(null);
    setWikiLinkSession(null);
    setLinkPopoverSession(null);
    slashAssetPositionRef.current = insertionPosition;
    slashAssetInputRef.current.accept =
      kind === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : '';
    slashAssetInputRef.current.value = '';
    slashAssetInputRef.current.click();
  }

  function handleSlashAssetSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const insertionPosition = slashAssetPositionRef.current;
    slashAssetPositionRef.current = null;
    event.target.value = '';

    if (!editor || insertionPosition === null || files.length === 0) {
      return;
    }

    assetUpload.handleFiles(editor, files, insertionPosition);
  }

  function executeSlashCommand(command: SlashCommandDefinition) {
    if (!editor || !slashCommandSession) {
      return;
    }

    if (command.id === 'wiki-link') {
      openSlashWikiLinkPicker(slashCommandSession);
      return;
    }

    if (command.id === 'image' || command.id === 'file') {
      openSlashAssetPicker(command.id, slashCommandSession);
      return;
    }

    if (command.id === 'template' || command.id === 'daily-note') {
      if (command.id === 'template' && !onOpenTemplateSettings) {
        return;
      }
      if (command.id === 'daily-note' && !onOpenDailyNote) {
        return;
      }
      const insertionPosition = deleteSlashQuery(slashCommandSession);
      if (insertionPosition === null) {
        return;
      }
      setSlashCommandSession(null);
      if (command.id === 'template') {
        onOpenTemplateSettings?.();
      } else {
        onOpenDailyNote?.();
      }
      return;
    }

    const chain = editor
      .chain()
      .focus()
      .deleteRange({ from: slashCommandSession.from, to: slashCommandSession.to });
    switch (command.id) {
      case 'text':
        chain.setParagraph();
        break;
      case 'heading-1':
        chain.setHeading({ level: 1 });
        break;
      case 'heading-2':
        chain.setHeading({ level: 2 });
        break;
      case 'heading-3':
        chain.setHeading({ level: 3 });
        break;
      case 'bullet-list':
        chain.toggleBulletList();
        break;
      case 'ordered-list':
        chain.toggleOrderedList();
        break;
      case 'checklist':
        chain.toggleTaskList();
        break;
      case 'quote':
        chain.toggleBlockquote();
        break;
      case 'inline-code':
        chain.toggleCode();
        break;
      case 'code-block':
        chain.toggleCodeBlock();
        break;
      case 'divider':
        chain.setHorizontalRule();
        break;
      default:
        return;
    }

    if (chain.run()) {
      setSlashCommandSession(null);
      editor.view.focus();
    }
  }

  function handleSlashCommandKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!slashCommandSession || !editor) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      dismissSlashCommands();
      return;
    }

    if (slashCommandOptions.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSlashCommandActiveIndex((current) => (current + 1) % slashCommandOptions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSlashCommandActiveIndex(
        (current) => (current - 1 + slashCommandOptions.length) % slashCommandOptions.length,
      );
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      const command = slashCommandOptions[slashCommandActiveIndex];
      if (!command) {
        return;
      }
      event.preventDefault();
      executeSlashCommand(command);
    }
  }

  function dismissWikiLinkAutocomplete() {
    setWikiLinkSession(null);
    setWikiLinkError(null);
  }

  function selectWikiLinkPage(page: PageSummary, session = wikiLinkSession) {
    if (!editor || !session) {
      return;
    }

    if (createWikiLinkNode(editor, session, page)) {
      dismissWikiLinkAutocomplete();
    }
  }

  async function createAndSelectWikiLink(title: string, session = wikiLinkSession) {
    if (!session || isCreatingWikiLink) {
      return;
    }

    setIsCreatingWikiLink(true);
    setWikiLinkError(null);
    try {
      const response = await createWikiLinkPage({ parentId: null, title });
      onPageCreated?.(response.page);
      selectWikiLinkPage(response.page, session);
    } catch (error: unknown) {
      setWikiLinkError(pageErrorMessage(error));
    } finally {
      setIsCreatingWikiLink(false);
    }
  }

  function handleWikiLinkKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!wikiLinkSession || !editor) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      dismissWikiLinkAutocomplete();
    } else if (wikiLinkOptions.length === 0) {
      return;
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setWikiLinkActiveIndex((current) => (current + 1) % wikiLinkOptions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setWikiLinkActiveIndex(
        (current) => (current - 1 + wikiLinkOptions.length) % wikiLinkOptions.length,
      );
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      const option = wikiLinkOptions[wikiLinkActiveIndex];
      if (!option) {
        return;
      }
      event.preventDefault();
      if (option.kind === 'page') {
        selectWikiLinkPage(option.page);
      } else {
        void createAndSelectWikiLink(option.title);
      }
    }
  }

  function runEditorShortcut(shortcut: EditorShortcutId) {
    if (!editor) {
      return false;
    }

    if (shortcut === 'link') {
      openLinkPopover('edit');
      return true;
    }
    if (shortcut === 'wikiLink') {
      openWikiLinkPicker();
      return true;
    }

    const chain = editor.chain().focus();
    switch (shortcut) {
      case 'paragraph':
        chain.setParagraph();
        break;
      case 'heading1':
        chain.toggleHeading({ level: 1 });
        break;
      case 'heading2':
        chain.toggleHeading({ level: 2 });
        break;
      case 'heading3':
        chain.toggleHeading({ level: 3 });
        break;
      case 'bold':
        chain.toggleBold();
        break;
      case 'italic':
        chain.toggleItalic();
        break;
      case 'strike':
        chain.toggleStrike();
        break;
      case 'code':
        chain.toggleCode();
        break;
      case 'bulletList':
        chain.toggleBulletList();
        break;
      case 'orderedList':
        chain.toggleOrderedList();
        break;
      case 'taskList':
        chain.toggleTaskList();
        break;
      case 'blockquote':
        chain.toggleBlockquote();
        break;
      case 'codeBlock':
        chain.toggleCodeBlock();
        break;
      case 'divider':
        chain.setHorizontalRule();
        break;
      default:
        return false;
    }

    return chain.run();
  }

  function handleEditorShortcut(event: ReactKeyboardEvent<HTMLElement>) {
    if (!editor) {
      return false;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.asset-image-controls')) {
      return false;
    }

    const shortcut = editorShortcutForEvent(event);
    if (!shortcut) {
      return false;
    }

    event.preventDefault();
    runEditorShortcut(shortcut);
    return true;
  }

  function handleEditorPaste(event: ReactClipboardEvent<HTMLElement>) {
    if (!editor || !(event.target instanceof Node) || !editor.view.dom.contains(event.target)) {
      return;
    }

    const files = filesFromClipboard(event.clipboardData);
    if (files.length === 0) {
      if (!clipboardMayContainImage(event.clipboardData)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void readClipboardImageFiles(event.clipboardData).then((clipboardFiles) => {
        if (clipboardFiles.length > 0 && !editor.isDestroyed) {
          assetUpload.handlePaste(editor, clipboardFiles);
        }
      });
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    assetUpload.handlePaste(editor, files);
  }

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!editor || !(event.target instanceof Node) || !editor.view.dom.contains(event.target)) {
      return;
    }

    handleSlashCommandKeyDown(event);
    if (event.defaultPrevented || slashCommandSession) {
      return;
    }

    handleWikiLinkKeyDown(event);
    if (event.defaultPrevented || wikiLinkSession) {
      return;
    }

    if (handleEditorShortcut(event)) {
      return;
    }

    const wikiLinkTarget =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-dovari-wiki-link-id]')
        : null;
    const wikiLinkPageId = wikiLinkTarget?.dataset.dovariWikiLinkId;
    if (event.key === 'Enter' && wikiLinkPageId && onNavigateToPage) {
      event.preventDefault();
      onNavigateToPage(wikiLinkPageId);
      return;
    }

    if (event.key === 'Enter' && editor.isActive('link')) {
      event.preventDefault();
      openLinkPopover('view');
    }
  }

  function handleEditorClick(event: React.MouseEvent<HTMLElement>) {
    if (!editor || !(event.target instanceof Element)) {
      return;
    }

    const target = event.target.closest<HTMLElement>('[data-dovari-wiki-link-id]');
    const targetPageId = target?.dataset.dovariWikiLinkId;
    if (targetPageId) {
      if (onNavigateToPage) {
        event.preventDefault();
        onNavigateToPage(targetPageId);
      }
      return;
    }

    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    if (
      !link ||
      !editor.view.dom.contains(link) ||
      link.classList.contains('asset-attachment-node')
    ) {
      return;
    }

    event.preventDefault();
    const selection = editorSelectionForLink(link);
    if (!selection) {
      return;
    }
    setWikiLinkSession(null);
    setLinkPopoverSession({
      ...selection,
      mode: 'view',
      position: popupPosition(editor, selection.to),
    });
  }

  useEffect(() => {
    if (!editor) {
      return;
    }

    const currentContent = serializeEditorDocument(editor.getJSON());
    if (currentContent && JSON.stringify(currentContent) === JSON.stringify(content)) {
      return;
    }

    editor.commands.setContent(safeEditorDocument(content), { emitUpdate: false });
  }, [content, editor]);

  const editorStyle = {
    '--editor-keyboard-inset': `${keyboardInset}px`,
    '--editor-toolbar-height': `${toolbarHeight}px`,
    '--editor-visual-viewport-bottom': `${visualViewportBottom}px`,
  } as CSSProperties;

  return (
    <section
      aria-label="Page editor"
      className="page-editor"
      onClick={handleEditorClick}
      onKeyDownCapture={handleEditorKeyDown}
      onPasteCapture={handleEditorPaste}
      style={editorStyle}
    >
      {editor ? (
        <>
          <div className="page-editor-topbar" ref={toolbarRef}>
            <EditorToolbar
              editor={editor}
              onOpenLink={() => openLinkPopover('edit')}
              onOpenWikiLink={openWikiLinkPicker}
            />
            {toolbarAccessory}
          </div>
          <div className="page-editor-surface">
            <EditorContent editor={editor} />
          </div>
          <input
            aria-label="Choose an image or file"
            className="slash-command-file-input"
            onChange={handleSlashAssetSelection}
            ref={slashAssetInputRef}
            tabIndex={-1}
            type="file"
          />
          {slashCommandSession ? (
            <SlashCommandPalette
              activeIndex={slashCommandActiveIndex}
              onActiveIndexChange={setSlashCommandActiveIndex}
              onKeyDown={handleSlashCommandKeyDown}
              onSelect={executeSlashCommand}
              options={slashCommandOptions}
              position={slashCommandSession.position}
              query={slashCommandSession.query}
            />
          ) : null}
          {wikiLinkSession ? (
            <WikiLinkPicker
              activeIndex={wikiLinkActiveIndex}
              error={wikiLinkError}
              isCreating={isCreatingWikiLink}
              isSearching={isSearchingWikiLinks}
              onCreatePage={(title) => void createAndSelectWikiLink(title)}
              onKeyDown={handleWikiLinkKeyDown}
              onQueryChange={(query) =>
                setWikiLinkSession((current) =>
                  current?.source === 'toolbar' || current?.source === 'slash'
                    ? { ...current, query }
                    : current,
                )
              }
              onSelectPage={selectWikiLinkPage}
              options={wikiLinkOptions as WikiLinkPickerOption[]}
              position={wikiLinkSession.position}
              query={wikiLinkSession.query}
              source={wikiLinkSession.source}
            />
          ) : null}
          {linkPopoverSession ? (
            <LinkPopover
              editor={editor}
              initialMode={linkPopoverSession.mode}
              key={`${linkPopoverSession.from}-${linkPopoverSession.to}-${linkPopoverSession.mode}`}
              onClose={() => {
                setLinkPopoverSession(null);
                editor.view.focus();
              }}
              position={linkPopoverSession.position}
              selection={linkPopoverSession}
            />
          ) : null}
        </>
      ) : (
        <p className="page-editor-loading" role="status">
          Loading editor…
        </p>
      )}
    </section>
  );
}
