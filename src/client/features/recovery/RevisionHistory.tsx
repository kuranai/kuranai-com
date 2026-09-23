import { useEffect, useRef, useState } from 'react';

import { derivePlainText, type PageDetail } from '../../../shared/pages';
import type { PageRevisionDetail, PageRevisionSummary } from '../../../shared/recovery';
import { pageErrorMessage } from '../pages/api';
import { fetchPageRevision, fetchPageRevisions, restorePageRevision } from './api';

export interface RevisionHistoryProps {
  onClose: () => void;
  onRestored: (page: PageDetail) => void;
  page: PageDetail;
}

function formatRevisionDate(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function revisionLabel(revision: PageRevisionSummary) {
  return `${revision.title} · ${revision.trigger} · ${formatRevisionDate(revision.createdAt)}`;
}

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('aria-hidden'));
}

export function RevisionHistory({ onClose, onRestored, page }: RevisionHistoryProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [revisions, setRevisions] = useState<PageRevisionSummary[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PageRevisionDetail | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const controller = new AbortController();
    fetchPageRevisions(page.id, undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        setRevisions(response.revisions);
        setSelectedRevisionId(response.revisions[0]?.id ?? null);
        setState('ready');
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(pageErrorMessage(requestError, 'Version history could not be loaded.'));
          setState('error');
        }
      });

    return () => controller.abort();
  }, [page.id]);

  useEffect(() => {
    if (selectedRevisionId === null) {
      setDetail(null);
      setDetailState('idle');
      return;
    }

    const controller = new AbortController();
    setDetailState('loading');
    setError(null);
    fetchPageRevision(page.id, selectedRevisionId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setDetail(response.revision);
          setDetailState('idle');
        }
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setDetail(null);
          setError(pageErrorMessage(requestError, 'This version could not be loaded.'));
          setDetailState('error');
        }
      });

    return () => controller.abort();
  }, [page.id, selectedRevisionId]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const elements = focusableElements(event.currentTarget);
    if (elements.length === 0) {
      event.preventDefault();
      return;
    }

    const firstElement = elements[0];
    const lastElement = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement?.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement?.focus();
    }
  }

  async function handleRestore() {
    if (detail === null || isRestoring) {
      return;
    }

    setIsRestoring(true);
    setError(null);
    try {
      const response = await restorePageRevision(page.id, detail.id, page.revision);
      onRestored(response.page);
      onClose();
    } catch (requestError: unknown) {
      setError(pageErrorMessage(requestError, 'This version could not be restored.'));
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="revision-history-title"
        aria-modal="true"
        className="revision-history-dialog"
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <header className="revision-history-header">
          <div>
            <span className="state-kicker">Recovery</span>
            <h2 id="revision-history-title">Version history</h2>
          </div>
          <button
            aria-label="Close version history"
            className="dialog-close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {state === 'loading' ? <p className="settings-state">Loading versions…</p> : null}
        {state === 'error' ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {state === 'ready' && revisions.length === 0 ? (
          <p className="settings-state">No saved versions yet.</p>
        ) : null}
        {revisions.length > 0 ? (
          <div className="revision-history-body">
            <div aria-label="Saved versions" className="revision-list" role="listbox">
              {revisions.map((revision) => (
                <button
                  aria-selected={selectedRevisionId === revision.id}
                  className={
                    selectedRevisionId === revision.id
                      ? 'revision-list-item is-selected'
                      : 'revision-list-item'
                  }
                  key={revision.id}
                  onClick={() => setSelectedRevisionId(revision.id)}
                  role="option"
                  type="button"
                >
                  <strong>{revision.title}</strong>
                  <span>
                    {revision.trigger} · {formatRevisionDate(revision.createdAt)}
                  </span>
                </button>
              ))}
            </div>
            <div className="revision-preview">
              <span className="state-kicker">Preview</span>
              {detailState === 'loading' ? <p>Loading this version…</p> : null}
              {detailState === 'error' ? (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              ) : null}
              {detail ? (
                <>
                  <h3>{detail.title}</h3>
                  <p className="revision-preview-meta">
                    Revision {detail.sourceRevision} · {revisionLabel(detail)}
                  </p>
                  <pre>{derivePlainText(detail.content) || 'This version is empty.'}</pre>
                  <button
                    className="button button-primary"
                    disabled={isRestoring}
                    onClick={() => void handleRestore()}
                    type="button"
                  >
                    {isRestoring ? 'Restoring…' : 'Restore this version'}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
