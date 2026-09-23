import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';

import { isAllowedLinkHref } from './editorExtensions';

export interface EditorLinkSelection {
  from: number;
  to: number;
}

export interface LinkPopoverPosition {
  left: number;
  top: number;
}

export type LinkPopoverMode = 'view' | 'edit';

export interface LinkPopoverProps {
  editor: Editor;
  initialMode?: LinkPopoverMode;
  onClose: () => void;
  position: LinkPopoverPosition;
  selection: EditorLinkSelection;
}

export function openLinkSafely(href: string) {
  const normalizedHref = href.trim();
  if (!isAllowedLinkHref(normalizedHref) || typeof window === 'undefined') {
    return false;
  }

  try {
    window.open(normalizedHref, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}

function hrefFromEditor(editor: Editor) {
  const attributes = editor.getAttributes('link') as { href?: unknown };
  return typeof attributes.href === 'string' ? attributes.href : '';
}

function selectionInDocument(editor: Editor, selection: EditorLinkSelection) {
  const maxPosition = editor.state.doc.content.size;
  const from = Math.max(0, Math.min(selection.from, maxPosition));
  const to = Math.max(from, Math.min(selection.to, maxPosition));
  return { from, to };
}

function keepEditorSelection(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export function LinkPopover({
  editor,
  initialMode = 'view',
  onClose,
  position,
  selection,
}: LinkPopoverProps) {
  const inputId = `editor-link-url-${useId()}`;
  const currentHref = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => hrefFromEditor(currentEditor),
  });
  const [mode, setMode] = useState<LinkPopoverMode>(initialMode);
  const [draftHref, setDraftHref] = useState(currentHref);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    setDraftHref(currentHref);
  }, [currentHref]);

  useEffect(() => {
    if (mode === 'edit') {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [mode]);

  function applyLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const href = draftHref.trim();
    if (!isAllowedLinkHref(href)) {
      setError('Use an http, https, mailto, or relative link.');
      return;
    }

    const range = selectionInDocument(editor, selectionRef.current);
    if (range.from === range.to) {
      setError('Select some text before adding a link.');
      return;
    }

    try {
      const applied = editor.chain().focus().setTextSelection(range).setLink({ href }).run();
      if (!applied) {
        setError('Select some text before adding a link.');
        return;
      }
    } catch {
      setError('The link could not be applied to this text.');
      return;
    }

    onClose();
  }

  function removeLink() {
    const range = selectionInDocument(editor, selectionRef.current);
    try {
      const removed = editor.chain().focus().setTextSelection(range).unsetLink().run();
      if (!removed) {
        setError('The link could not be removed.');
        return;
      }
    } catch {
      setError('The link could not be removed.');
      return;
    }

    onClose();
  }

  function openLink() {
    if (!openLinkSafely(currentHref)) {
      setError('This link target is not allowed.');
      return;
    }

    onClose();
  }

  function handleTargetClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    openLink();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div
      aria-label="Link options"
      className="editor-link-popover"
      onKeyDown={handleKeyDown}
      role="dialog"
      style={{ left: position.left, top: position.top }}
    >
      {mode === 'view' && currentHref ? (
        <>
          <div className="editor-link-target">
            <span className="editor-link-target-label">Link target</span>
            <a
              href={currentHref}
              onClick={handleTargetClick}
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              {currentHref}
            </a>
          </div>
          <div className="editor-link-actions">
            <button
              className="button button-primary"
              onClick={openLink}
              onMouseDown={keepEditorSelection}
              autoFocus
              type="button"
            >
              Open link
            </button>
            <button
              className="button button-secondary"
              onClick={() => {
                setError(null);
                setMode('edit');
              }}
              onMouseDown={keepEditorSelection}
              type="button"
            >
              Edit link
            </button>
            <button
              className="button button-quiet"
              onClick={removeLink}
              onMouseDown={keepEditorSelection}
              type="button"
            >
              Remove link
            </button>
            <button
              aria-label="Close link options"
              className="button button-quiet"
              onClick={onClose}
              onMouseDown={keepEditorSelection}
              type="button"
            >
              Close
            </button>
          </div>
        </>
      ) : (
        <form aria-label="Link options" className="editor-link-form" onSubmit={applyLink}>
          <label htmlFor={inputId}>Link URL</label>
          <input
            autoComplete="off"
            id={inputId}
            onChange={(event) => {
              setDraftHref(event.target.value);
              setError(null);
            }}
            placeholder="https://example.com"
            ref={inputRef}
            type="text"
            value={draftHref}
          />
          <div className="editor-link-actions">
            <button className="button button-primary" type="submit">
              Apply
            </button>
            {currentHref ? (
              <button
                className="button button-quiet"
                onClick={removeLink}
                onMouseDown={keepEditorSelection}
                type="button"
              >
                Remove link
              </button>
            ) : null}
            {currentHref ? (
              <button
                className="button button-quiet"
                onClick={() => {
                  setDraftHref(currentHref);
                  setError(null);
                  setMode('view');
                }}
                onMouseDown={keepEditorSelection}
                type="button"
              >
                Cancel
              </button>
            ) : (
              <button
                className="button button-quiet"
                onClick={onClose}
                onMouseDown={keepEditorSelection}
                type="button"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {error ? (
        <p className="editor-link-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
