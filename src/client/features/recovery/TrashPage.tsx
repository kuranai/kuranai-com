import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';

import type { TrashPage as TrashPageItem } from '../../../shared/recovery';
import type { WorkspaceOutletContext } from '../../app/App';
import { pageErrorMessage } from '../pages/api';
import { fetchTrash, permanentlyDeletePage, restoreDeletedPage } from './api';

type TrashState =
  | { status: 'loading'; pages: TrashPageItem[]; nextCursor: string | null }
  | { status: 'error'; message: string; pages: TrashPageItem[]; nextCursor: string | null }
  | { status: 'ready'; pages: TrashPageItem[]; nextCursor: string | null };

function formatDeletedAt(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function TrashPage() {
  const { refreshPages } = useOutletContext<WorkspaceOutletContext>();
  const navigate = useNavigate();
  const [state, setState] = useState<TrashState>({
    nextCursor: null,
    pages: [],
    status: 'loading',
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionPageId, setActionPageId] = useState<string | null>(null);
  const [confirmationPageId, setConfirmationPageId] = useState<string | null>(null);
  const [confirmationTitle, setConfirmationTitle] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const loadTrash = useCallback(async (signal?: AbortSignal) => {
    setState((current) => ({ ...current, status: 'loading' }));
    try {
      const response = await fetchTrash(undefined, signal);
      if (!signal?.aborted) {
        setState({ nextCursor: response.nextCursor, pages: response.pages, status: 'ready' });
      }
    } catch (error: unknown) {
      if (!signal?.aborted) {
        setState((current) => ({
          message: pageErrorMessage(error, 'The Trash could not be loaded.'),
          nextCursor: current.nextCursor,
          pages: current.pages,
          status: 'error',
        }));
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadTrash(controller.signal);
    return () => controller.abort();
  }, [loadTrash]);

  async function loadMore() {
    if (state.nextCursor === null || loadingMore) {
      return;
    }

    setLoadingMore(true);
    setActionError(null);
    try {
      const response = await fetchTrash(state.nextCursor);
      setState((current) => ({
        nextCursor: response.nextCursor,
        pages: [...current.pages, ...response.pages],
        status: 'ready',
      }));
    } catch (error: unknown) {
      setActionError(pageErrorMessage(error, 'More Trash items could not be loaded.'));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleRestore(page: TrashPageItem) {
    setActionPageId(page.id);
    setActionError(null);
    try {
      const response = await restoreDeletedPage(page.id, page.revision);
      setState((current) => ({
        ...current,
        pages: current.pages.filter((item) => item.id !== page.id),
        status: 'ready',
      }));
      await refreshPages();
      navigate(`/app/pages/${response.page.id}`);
    } catch (error: unknown) {
      setActionError(pageErrorMessage(error, 'The page could not be restored.'));
    } finally {
      setActionPageId(null);
    }
  }

  async function handlePermanentDelete(event: FormEvent<HTMLFormElement>, page: TrashPageItem) {
    event.preventDefault();
    setActionPageId(page.id);
    setActionError(null);
    try {
      await permanentlyDeletePage(page.id, page.revision, confirmationTitle);
      setState((current) => ({
        ...current,
        pages: current.pages.filter((item) => item.id !== page.id),
        status: 'ready',
      }));
      setConfirmationPageId(null);
      setConfirmationTitle('');
    } catch (error: unknown) {
      setActionError(pageErrorMessage(error, 'The page could not be deleted permanently.'));
    } finally {
      setActionPageId(null);
    }
  }

  return (
    <section aria-labelledby="trash-title" className="settings-page">
      <header className="settings-header">
        <div>
          <span className="state-kicker">Settings</span>
          <h1 id="trash-title">Trash</h1>
          <p>Deleted pages stay recoverable until you choose to remove them permanently.</p>
        </div>
        <Link className="button button-secondary" to="/app">
          Back to pages
        </Link>
        <Link className="button button-secondary" to="/app/settings/backup">
          Backup &amp; restore
        </Link>
      </header>

      {actionError ? (
        <p className="page-action-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {state.status === 'loading' && state.pages.length === 0 ? (
        <p aria-live="polite" className="settings-state">
          Loading Trash…
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div className="settings-error" role="alert">
          <p>{state.message}</p>
          <button
            className="button button-secondary"
            onClick={() => void loadTrash()}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
      {state.status === 'ready' && state.pages.length === 0 ? (
        <p className="settings-state">Trash is empty.</p>
      ) : null}
      {state.pages.length > 0 ? (
        <div className="trash-list">
          {state.pages.map((page) => {
            const isActing = actionPageId === page.id;
            const isConfirming = confirmationPageId === page.id;
            return (
              <article className="trash-item" key={page.id}>
                <div className="trash-item-content">
                  <h2>{page.title}</h2>
                  <p>
                    Deleted <time dateTime={page.deletedAt}>{formatDeletedAt(page.deletedAt)}</time>
                  </p>
                  <small>Previous parent: {page.parentId ?? 'Root'}</small>
                </div>
                <div className="trash-item-actions">
                  <button
                    className="button button-secondary"
                    disabled={isActing}
                    onClick={() => void handleRestore(page)}
                    type="button"
                  >
                    {isActing ? 'Restoring…' : 'Restore'}
                  </button>
                  <button
                    className="button button-danger"
                    disabled={isActing}
                    onClick={() => {
                      setConfirmationPageId(page.id);
                      setConfirmationTitle('');
                      setActionError(null);
                    }}
                    type="button"
                  >
                    Delete permanently
                  </button>
                </div>
                {isConfirming ? (
                  <form
                    aria-label={`Permanently delete ${page.title}`}
                    className="trash-confirmation"
                    onSubmit={(event) => void handlePermanentDelete(event, page)}
                  >
                    <label htmlFor={`confirmation-${page.id}`}>
                      Type <strong>{page.title}</strong> to confirm.
                    </label>
                    <input
                      autoFocus
                      id={`confirmation-${page.id}`}
                      onChange={(event) => setConfirmationTitle(event.target.value)}
                      value={confirmationTitle}
                    />
                    <div className="trash-confirmation-actions">
                      <button
                        className="button button-danger"
                        disabled={isActing || confirmationTitle.length === 0}
                        type="submit"
                      >
                        {isActing ? 'Deleting…' : 'Confirm permanent delete'}
                      </button>
                      <button
                        className="button button-quiet"
                        onClick={() => setConfirmationPageId(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
      {state.nextCursor !== null ? (
        <button
          className="button button-secondary settings-load-more"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          type="button"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}
