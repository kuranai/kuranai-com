import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
} from 'react';
import { Link } from 'react-router-dom';

import type { PageDetail, PageSummary } from '../../../shared/pages';
import { PublicationPanel } from '../publications/PublicationPanel';
import { RevisionHistory } from '../recovery/RevisionHistory';
import { PageOrganization } from '../tags/PageOrganization';
import { fetchBacklinks, fetchPage, pageErrorMessage, updatePageTitle } from './api';
import { usePageAutosave, type AutosaveSnapshot } from './editor/autosave';

const PageEditor = lazy(async () => {
  const module = await import('./editor/PageEditor');
  return { default: module.PageEditor };
});

type PageLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; page: PageDetail };

export interface PageViewProps {
  pageId: string;
  onPageDeleted: (page: PageDetail) => Promise<void>;
  onPageCreated?: (page: PageSummary) => void;
  onOpenTemplateSettings?: () => void;
  onOpenDailyNote?: () => void;
  onHistoryClosed?: () => void;
  onNavigateToPage?: (pageId: string) => void;
  onPageUpdated: (page: PageSummary) => void;
  openHistory?: boolean;
  pageSummary?: PageSummary;
}

function LoadingPage() {
  return (
    <section aria-busy="true" aria-live="polite" className="page-state page-state-loading">
      <span className="state-kicker">Page</span>
      <h1>Loading page…</h1>
      <p>Getting the latest version of this page.</p>
    </section>
  );
}

function PageLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section aria-live="assertive" className="page-state page-state-error" role="alert">
      <span className="state-kicker">Page unavailable</span>
      <h1>We couldn’t load this page.</h1>
      <p>{message}</p>
      <button className="button button-secondary" onClick={onRetry} type="button">
        Retry
      </button>
    </section>
  );
}

function PageTitleEditor({
  page,
  onSaved,
  onSavingChange,
}: {
  page: PageDetail;
  onSaved: (page: PageDetail) => void;
  onSavingChange: (isSaving: boolean) => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastServerTitleRef = useRef(page.title);
  const latestPageRef = useRef(page);
  const titleRef = useRef(page.title);
  const saveTitleRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const savingRef = useRef(false);

  latestPageRef.current = page;
  titleRef.current = title;

  function setSaving(nextIsSaving: boolean) {
    savingRef.current = nextIsSaving;
    setIsSaving(nextIsSaving);
    onSavingChange(nextIsSaving);
  }

  useEffect(() => {
    const previousServerTitle = lastServerTitleRef.current;
    lastServerTitleRef.current = page.title;
    setTitle((currentTitle) =>
      currentTitle.trim() === previousServerTitle ? page.title : currentTitle,
    );
  }, [page.title]);

  const saveTitle = useCallback(async () => {
    if (savingRef.current) {
      return;
    }

    const currentPage = latestPageRef.current;
    const nextTitle = titleRef.current.trim();
    if (nextTitle.length === 0) {
      setError('A page title is required.');
      return;
    }

    if (nextTitle === currentPage.title) {
      setTitle(currentPage.title);
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    let saveAgain = false;
    try {
      const response = await updatePageTitle(currentPage.id, currentPage.revision, nextTitle);
      latestPageRef.current = response.page;
      onSaved(response.page);

      if (titleRef.current.trim() === nextTitle) {
        setTitle(response.page.title);
      } else {
        saveAgain = true;
      }
    } catch (requestError) {
      setError(pageErrorMessage(requestError, 'The page name could not be saved.'));
    } finally {
      setSaving(false);
      if (saveAgain) {
        void saveTitleRef.current();
      }
    }
  }, [onSaved]);

  saveTitleRef.current = saveTitle;

  function handleChange(nextTitle: string) {
    titleRef.current = nextTitle;
    setTitle(nextTitle);
    setError(null);
  }

  function handleCancel() {
    const serverTitle = latestPageRef.current.title;
    titleRef.current = serverTitle;
    setTitle(serverTitle);
    setError(null);
  }

  function handleBlur(event: FocusEvent<HTMLFormElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    void saveTitleRef.current();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveTitle();
  }

  return (
    <form className="page-title-form" onBlur={handleBlur} onSubmit={handleSubmit}>
      <h1 aria-label={title || 'Page title'} className="page-title-heading">
        <input
          disabled={isSaving}
          aria-label="Edit title"
          className="page-title-input"
          id="page-title"
          maxLength={200}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              handleCancel();
            }
          }}
          ref={inputRef}
          value={title}
        />
      </h1>
      <div className="page-title-controls">
        <span aria-live="polite" className="page-title-status">
          {isSaving ? 'Saving title…' : title !== page.title ? 'Unsaved title' : ''}
        </span>
        {title !== page.title ? (
          <>
            <button className="button button-primary" disabled={isSaving} type="submit">
              {isSaving ? 'Saving…' : 'Save title'}
            </button>
            <button
              className="button button-quiet"
              disabled={isSaving}
              onClick={handleCancel}
              type="button"
            >
              Cancel
            </button>
          </>
        ) : null}
      </div>
      {error ? (
        <div className="page-title-error" role="alert">
          <span>{error}</span>
          <button
            className="button button-quiet"
            disabled={isSaving}
            onClick={() => void saveTitle()}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
    </form>
  );
}

function autosaveStatusLabel(snapshot: AutosaveSnapshot) {
  if (snapshot.recoveryAvailable) {
    return 'Draft found';
  }

  switch (snapshot.status) {
    case 'dirty':
      return 'Unsaved changes';
    case 'waiting':
      return 'Waiting to save…';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'failed':
      return 'Not saved';
    case 'retrying':
      return 'Retrying…';
    case 'conflict':
      return 'Conflict';
    default:
      return 'Ready to write';
  }
}

function PageContentEditor({
  onNavigateToPage,
  onOpenTemplateSettings,
  onOpenDailyNote,
  onPageCreated,
  onPageUpdated,
  page,
}: {
  onNavigateToPage?: (pageId: string) => void;
  onOpenTemplateSettings?: () => void;
  onOpenDailyNote?: () => void;
  onPageCreated?: (page: PageSummary) => void;
  onPageUpdated: (page: PageDetail) => void;
  page: PageDetail;
}) {
  const [content, setContent] = useState(page.content);
  const [conflictActionError, setConflictActionError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [isLoadingServer, setIsLoadingServer] = useState(false);

  const handleSaved = useCallback(
    (savedPage: PageDetail, isCurrentContent: boolean) => {
      if (isCurrentContent) {
        setContent(savedPage.content);
      }
      onPageUpdated(savedPage);
    },
    [onPageUpdated],
  );
  const handleContentAvailable = useCallback((nextContent: PageDetail['content']) => {
    setContent(nextContent);
  }, []);
  const autosave = usePageAutosave(page, handleSaved, handleContentAvailable);

  function handleContentChange(nextContent: PageDetail['content']) {
    setContent(nextContent);
    autosave.change(nextContent);
  }

  async function handleRecoverDraft() {
    const recoveredContent = await autosave.recoverDraft();
    if (recoveredContent !== null) {
      setContent(recoveredContent);
    }
  }

  async function handleDiscardDraft() {
    await autosave.discardDraft();
    setContent(page.content);
  }

  async function handleLoadServerVersion() {
    setIsLoadingServer(true);
    setConflictActionError(null);
    setCopyNotice(null);
    try {
      const response = await fetchPage(page.id);
      await autosave.resetFromServer(response.page);
      setContent(response.page.content);
      onPageUpdated(response.page);
    } catch (error: unknown) {
      setConflictActionError(pageErrorMessage(error, 'The server version could not be loaded.'));
    } finally {
      setIsLoadingServer(false);
    }
  }

  async function handleCopyMyVersion() {
    setConflictActionError(null);
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard access is unavailable.');
      }
      await navigator.clipboard.writeText(JSON.stringify(autosave.getCurrentContent(), null, 2));
      setCopyNotice('Your version is copied to the clipboard.');
    } catch {
      setCopyNotice('Your version could not be copied automatically.');
    }
  }

  const statusClassName = [
    'editor-status',
    autosave.snapshot.hasUnconfirmedChanges ? 'is-local' : '',
    autosave.snapshot.status === 'failed' || autosave.snapshot.status === 'conflict'
      ? 'is-error'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section aria-label="Document editor" className="page-editor-section">
      {autosave.snapshot.recoveryAvailable ? (
        <div className="editor-save-notice editor-recovery-notice" role="status">
          <div>
            <strong>We found unsaved changes from an earlier session.</strong>
            <p>Restore them to continue editing, or discard the local draft.</p>
          </div>
          <div className="editor-save-actions">
            <button
              className="button button-primary"
              onClick={() => void handleRecoverDraft()}
              type="button"
            >
              Restore draft
            </button>
            <button
              className="button button-quiet"
              onClick={() => void handleDiscardDraft()}
              type="button"
            >
              Discard draft
            </button>
          </div>
        </div>
      ) : null}
      {autosave.snapshot.status === 'failed' ? (
        <div className="editor-save-notice editor-save-error" role="alert">
          <p>{autosave.snapshot.errorMessage ?? "We couldn't save this page."}</p>
          <button className="button button-secondary" onClick={autosave.retry} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {autosave.snapshot.status === 'conflict' ? (
        <div className="editor-save-notice editor-save-error" role="alert">
          <div>
            <strong>We couldn’t save this page.</strong>
            <p>{autosave.snapshot.errorMessage}</p>
            {autosave.snapshot.conflictRevision !== null ? (
              <small>Server revision: {autosave.snapshot.conflictRevision}</small>
            ) : null}
          </div>
          <div className="editor-save-actions">
            <button
              className="button button-secondary"
              disabled={isLoadingServer}
              onClick={() => void handleLoadServerVersion()}
              type="button"
            >
              {isLoadingServer ? 'Loading…' : 'Load server version'}
            </button>
            <button
              className="button button-quiet"
              onClick={() => void handleCopyMyVersion()}
              type="button"
            >
              Copy my version
            </button>
          </div>
          {copyNotice ? <p className="editor-save-feedback">{copyNotice}</p> : null}
        </div>
      ) : null}
      {conflictActionError ? (
        <p className="inline-error" role="alert">
          {conflictActionError}
        </p>
      ) : null}
      <Suspense
        fallback={
          <p className="page-editor-loading" role="status">
            Loading editor…
          </p>
        }
      >
        <PageEditor
          content={content}
          onChange={handleContentChange}
          onNavigateToPage={onNavigateToPage}
          onOpenTemplateSettings={onOpenTemplateSettings}
          onOpenDailyNote={onOpenDailyNote}
          onPageCreated={onPageCreated}
          pageId={page.id}
          toolbarAccessory={
            <span aria-live="polite" className={statusClassName}>
              {autosaveStatusLabel(autosave.snapshot)}
            </span>
          }
        />
      </Suspense>
    </section>
  );
}

function PageDetailContent({
  onNavigateToPage,
  onOpenTemplateSettings,
  onOpenDailyNote,
  onPageCreated,
  page,
  onPageDeleted,
  onPageUpdated,
  onHistoryClosed,
  openHistory = false,
}: {
  onNavigateToPage?: (pageId: string) => void;
  onOpenTemplateSettings?: () => void;
  onOpenDailyNote?: () => void;
  onPageCreated?: (page: PageSummary) => void;
  page: PageDetail;
  onPageDeleted: (page: PageDetail) => Promise<void>;
  onPageUpdated: (page: PageDetail) => void;
  onHistoryClosed?: () => void;
  openHistory: boolean;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(openHistory);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [isTitleSaving, setIsTitleSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (openHistory) {
      setIsHistoryOpen(true);
    }
  }, [openHistory]);

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      await onPageDeleted(page);
    } catch (requestError) {
      setError(pageErrorMessage(requestError, 'The page could not be deleted.'));
      setIsDeleting(false);
    }
  }

  function handleTitleSaved(updatedPage: PageDetail) {
    setError(null);
    onPageUpdated(updatedPage);
  }

  function handleRevisionRestored(updatedPage: PageDetail) {
    setError(null);
    setEditorResetKey((currentKey) => currentKey + 1);
    onPageUpdated(updatedPage);
  }

  function closeHistory() {
    setIsHistoryOpen(false);
    onHistoryClosed?.();
    window.setTimeout(() => historyTriggerRef.current?.focus({ preventScroll: true }), 0);
  }

  return (
    <article className="page-detail">
      <header className="page-detail-header">
        <div className="page-heading">
          <PageTitleEditor
            onSaved={handleTitleSaved}
            onSavingChange={setIsTitleSaving}
            page={page}
          />
        </div>
        <div aria-label="Page actions" className="page-actions" role="group">
          <button
            className="button button-secondary"
            disabled={isDeleting || isTitleSaving}
            onClick={() => setIsHistoryOpen(true)}
            ref={historyTriggerRef}
            type="button"
          >
            Version history
          </button>
          <button
            className="button button-danger"
            disabled={isDeleting || isTitleSaving}
            onClick={() => void handleDelete()}
            type="button"
          >
            {isDeleting ? 'Deleting…' : 'Delete page'}
          </button>
        </div>
      </header>
      {error ? (
        <p className="page-action-error" role="alert">
          {error}
        </p>
      ) : null}
      <PageContentEditor
        key={`${page.id}-${editorResetKey}`}
        onNavigateToPage={onNavigateToPage}
        onOpenTemplateSettings={onOpenTemplateSettings}
        onOpenDailyNote={onOpenDailyNote}
        onPageCreated={onPageCreated}
        onPageUpdated={onPageUpdated}
        page={page}
      />
      <PageOrganization onPageUpdated={onPageUpdated} page={page} />
      <PublicationPanel page={page} />
      <Backlinks pageId={page.id} />
      {isHistoryOpen ? (
        <RevisionHistory onClose={closeHistory} onRestored={handleRevisionRestored} page={page} />
      ) : null}
    </article>
  );
}

function Backlinks({ pageId }: { pageId: string }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; pages: PageSummary[] }
  >({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    fetchBacklinks(pageId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setState({ status: 'ready', pages: response.backlinks });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            message: pageErrorMessage(error, 'Backlinks could not be loaded.'),
          });
        }
      });

    return () => controller.abort();
  }, [pageId]);

  return (
    <section aria-labelledby="page-backlinks-title" className="page-backlinks">
      <div className="page-backlinks-heading">
        <div>
          <span className="state-kicker">Connections</span>
          <h2 id="page-backlinks-title">Referenced by</h2>
        </div>
        {state.status === 'ready' && state.pages.length > 0 ? (
          <span className="page-count">{state.pages.length}</span>
        ) : null}
      </div>
      {state.status === 'loading' ? (
        <p className="page-backlinks-state">Loading backlinks…</p>
      ) : null}
      {state.status === 'error' ? (
        <p className="page-backlinks-state page-backlinks-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === 'ready' && state.pages.length === 0 ? (
        <p className="page-backlinks-state">No pages link here yet.</p>
      ) : null}
      {state.status === 'ready' && state.pages.length > 0 ? (
        <ul className="page-backlinks-list">
          {state.pages.map((backlink) => (
            <li key={backlink.id}>
              <Link to={`/app/pages/${backlink.id}`}>{backlink.title}</Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function PageView({
  pageId,
  onPageCreated,
  onOpenTemplateSettings,
  onOpenDailyNote,
  onHistoryClosed,
  onNavigateToPage,
  onPageDeleted,
  onPageUpdated,
  openHistory = false,
  pageSummary,
}: PageViewProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<PageLoadState>({ status: 'loading' });

  function handlePageUpdated(updatedPage: PageDetail) {
    setState({ status: 'ready', page: updatedPage });
    onPageUpdated(updatedPage);
  }

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    fetchPage(pageId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setState({ status: 'ready', page: response.page });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            message: pageErrorMessage(error, 'The page could not be loaded.'),
          });
        }
      });

    return () => controller.abort();
  }, [pageId, reloadKey]);

  useEffect(() => {
    if (state.status !== 'ready' || pageSummary?.id !== state.page.id) {
      return;
    }

    if (
      state.page.title === pageSummary.title &&
      state.page.slug === pageSummary.slug &&
      state.page.parentId === pageSummary.parentId &&
      state.page.position === pageSummary.position &&
      state.page.revision === pageSummary.revision &&
      state.page.updatedAt === pageSummary.updatedAt &&
      state.page.isFavorite === pageSummary.isFavorite &&
      state.page.tags.length === pageSummary.tags.length &&
      state.page.tags.every((tag, index) => {
        const nextTag = pageSummary.tags[index];
        return nextTag?.id === tag.id && nextTag.name === tag.name;
      })
    ) {
      return;
    }

    setState((currentState) =>
      currentState.status === 'ready'
        ? { ...currentState, page: { ...currentState.page, ...pageSummary } }
        : currentState,
    );
  }, [pageSummary, state]);

  if (state.status === 'loading') {
    return <LoadingPage />;
  }

  if (state.status === 'error') {
    return (
      <PageLoadError message={state.message} onRetry={() => setReloadKey((value) => value + 1)} />
    );
  }

  return (
    <PageDetailContent
      key={state.page.id}
      onNavigateToPage={onNavigateToPage}
      onOpenTemplateSettings={onOpenTemplateSettings}
      onOpenDailyNote={onOpenDailyNote}
      onPageCreated={onPageCreated}
      onHistoryClosed={onHistoryClosed}
      onPageDeleted={onPageDeleted}
      onPageUpdated={handlePageUpdated}
      openHistory={openHistory}
      page={state.page}
    />
  );
}
