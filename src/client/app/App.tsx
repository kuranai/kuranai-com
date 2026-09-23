import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router-dom';

import type { PageDetail, PageSummary } from '../../shared/pages';
import type { TagSummary } from '../../shared/tags';
import {
  createPage as createPageRequest,
  deletePage as deletePageRequest,
  downloadKnowledgeBaseExport,
  fetchPages,
  pageErrorMessage,
} from '../features/pages/api';
import { PageApiError } from '../features/pages/api';
import { PublicLandingPage } from '../features/publications/PublicLandingPage';
import { PublicPage } from '../features/publications/PublicPage';
import {
  publicationErrorMessage,
  resolvePublicationEditorTarget,
} from '../features/publications/api';
import { restoreDeletedPage } from '../features/recovery/api';
import { PageTree } from '../features/pages/PageTree';
import { PageView } from '../features/pages/PageView';
import { TrashPage } from '../features/recovery/TrashPage';
import { BackupRestorePage } from '../features/recovery/BackupRestorePage';
import { CommandPalette } from '../features/search/CommandPalette';
import { SettingsPage } from '../features/settings/SettingsPage';
import { TemplatesPage } from '../features/templates/TemplatesPage';
import { openDailyNote as openDailyNoteRequest } from '../features/templates/api';
import { selectRecentPages } from '../features/pages/recentPages';
import { LoginPage } from '../features/auth/LoginPage';
import { ThemeProvider, useTheme } from './theme';

type PageListState = 'loading' | 'error' | 'ready';
type PageFilter = { favorite?: boolean; tagId?: string };

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }

    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      mediaQuery.addListener?.(handleChange);
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener?.(handleChange);
      }
    };
  }, [query]);

  return matches;
}

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('aria-hidden'));
}

export interface WorkspaceOutletContext {
  actionError: string | null;
  createPage: (parentId?: string | null) => Promise<void>;
  deletePage: (page: PageDetail) => Promise<void>;
  exportPages: () => Promise<void>;
  openDailyNote: () => Promise<void>;
  isCreating: boolean;
  isExporting: boolean;
  listError: string | null;
  listState: PageListState;
  onPageUpdated: (page: PageSummary) => void;
  pages: PageSummary[];
  refreshPages: () => Promise<void>;
  retryPages: () => void;
}

function workspacePath(pageId: string) {
  return `/app/pages/${pageId}`;
}

function pageIdFromWorkspacePath(pathname: string) {
  const match = pathname.match(/^\/app\/pages\/([^/]+)/u);
  if (!match?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function LoadingState() {
  return (
    <section aria-busy="true" aria-live="polite" className="page-state page-state-loading">
      <span className="state-kicker">Workspace</span>
      <h1>Loading your pages…</h1>
      <p>Preparing your private knowledge base.</p>
    </section>
  );
}

function EmptyState({ onCreate, isCreating }: { onCreate: () => void; isCreating: boolean }) {
  return (
    <section className="page-state page-state-empty">
      <span className="state-kicker">Your workspace</span>
      <h1>Start with one useful page.</h1>
      <p>Create a page for notes, decisions, or anything you want to keep close.</p>
      <button
        className="button button-primary"
        disabled={isCreating}
        onClick={onCreate}
        type="button"
      >
        {isCreating ? 'Creating…' : 'Create your first page'}
      </button>
    </section>
  );
}

function ListErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section aria-live="assertive" className="page-state page-state-error" role="alert">
      <span className="state-kicker">Workspace unavailable</span>
      <h1>We couldn’t load your pages.</h1>
      <p>{message}</p>
      <button className="button button-secondary" onClick={onRetry} type="button">
        Retry
      </button>
    </section>
  );
}

function WorkspaceLanding() {
  const { createPage, isCreating, listError, listState, pages, retryPages } =
    useOutletContext<WorkspaceOutletContext>();

  if (listState === 'loading') {
    return <LoadingState />;
  }

  if (listState === 'error') {
    return <ListErrorState message={listError ?? 'Please try again.'} onRetry={retryPages} />;
  }

  if (pages.length === 0) {
    return <EmptyState isCreating={isCreating} onCreate={() => void createPage()} />;
  }

  return (
    <section className="page-state page-state-empty">
      <span className="state-kicker">Choose a page</span>
      <h1>Your pages are ready.</h1>
      <p>Select a page from the sidebar to open it.</p>
    </section>
  );
}

function PageRoute() {
  const { pageId } = useParams();
  const { deletePage, onPageUpdated, openDailyNote, pages, refreshPages } =
    useOutletContext<WorkspaceOutletContext>();
  const location = useLocation();
  const navigate = useNavigate();

  if (!pageId) {
    return <Navigate replace to="/app" />;
  }

  return (
    <PageView
      key={pageId}
      onNavigateToPage={(targetPageId) => navigate(workspacePath(targetPageId))}
      onOpenTemplateSettings={() => navigate('/app/settings/templates')}
      onOpenDailyNote={() => void openDailyNote()}
      onPageCreated={() => void refreshPages()}
      onPageDeleted={deletePage}
      onPageUpdated={onPageUpdated}
      onHistoryClosed={() => navigate(workspacePath(pageId), { replace: true })}
      openHistory={new URLSearchParams(location.search).get('history') === '1'}
      pageId={pageId}
      pageSummary={pages.find((page) => page.id === pageId)}
    />
  );
}

function PublicationEditorRoute() {
  const { publicId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string; requiresLogin: boolean }
  >({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    if (!publicId) {
      setState({
        status: 'error',
        message: 'This public page is not available for editing.',
        requiresLogin: false,
      });
      return () => controller.abort();
    }

    setState({ status: 'loading' });
    resolvePublicationEditorTarget(publicId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          navigate(workspacePath(response.pageId), { replace: true });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            message: publicationErrorMessage(
              error,
              'The public page could not be opened for editing.',
            ),
            requiresLogin:
              error instanceof PageApiError &&
              (error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_INVALID'),
          });
        }
      });

    return () => controller.abort();
  }, [navigate, publicId]);

  if (state.status === 'loading') {
    return <LoadingState />;
  }

  return (
    <section aria-live="assertive" className="page-state page-state-error" role="alert">
      <span className="state-kicker">Private editing</span>
      <h1>Sign in to edit this page.</h1>
      <p>{state.message}</p>
      {state.requiresLogin ? (
        <a
          className="button button-primary"
          href={`/login?next=${encodeURIComponent(`/app/publications/${publicId ?? ''}/edit`)}`}
        >
          Sign in
        </a>
      ) : (
        <Link className="button button-secondary" to="/">
          Back to public pages
        </Link>
      )}
    </section>
  );
}

function SidebarFavoritePages({ pages }: { pages: PageSummary[] }) {
  const favoritePages = pages
    .filter((page) => page.isFavorite)
    .sort((left, right) =>
      left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }),
    );

  if (favoritePages.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="favorite-pages-title" className="sidebar-favorites">
      <h2 id="favorite-pages-title">Favorites</h2>
      <nav aria-label="Favorite pages">
        <ul className="sidebar-favorites-list">
          {favoritePages.map((page) => (
            <li key={page.id}>
              <Link
                aria-label={`Open favorite page: ${page.title}`}
                className="sidebar-favorite-link"
                to={workspacePath(page.id)}
              >
                <span aria-hidden="true" className="sidebar-favorite-icon">
                  ★
                </span>
                <span className="sidebar-favorite-title">{page.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}

function Sidebar({
  isCreating,
  onCreate,
  onCreateChild,
  onPageUpdated,
  onPagesChanged,
  pages,
  recentPages,
  state,
  error,
  onRetry,
  isOpen,
  isMobile,
  onClose,
  closeButtonRef,
}: {
  error: string | null;
  isCreating: boolean;
  onCreate: () => void;
  onCreateChild: (parentId: string) => void;
  onPageUpdated: (page: PageSummary) => void;
  onPagesChanged: () => Promise<void>;
  onRetry: () => void;
  pages: PageSummary[];
  recentPages: PageSummary[];
  state: PageListState;
  isOpen: boolean;
  isMobile: boolean;
  onClose: () => void;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !isOpen) {
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

  return (
    <aside
      aria-hidden={isMobile && !isOpen ? true : undefined}
      aria-label="Workspace sidebar"
      className={`app-sidebar${isOpen ? ' is-open' : ''}`}
      id="workspace-sidebar"
      inert={isMobile && !isOpen ? true : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="sidebar-topbar">
        <button
          aria-label="Close pages navigation"
          className="sidebar-close"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {state === 'ready' ? <SidebarFavoritePages pages={pages} /> : null}

      {state === 'loading' ? (
        <p className="sidebar-state" aria-live="polite">
          Loading pages…
        </p>
      ) : null}
      {state === 'error' ? (
        <div className="sidebar-error" role="alert">
          <p>{error ?? 'Pages are unavailable.'}</p>
          <button className="button button-quiet" onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {state === 'ready' && pages.length === 0 ? (
        <p className="sidebar-state">No pages yet.</p>
      ) : null}
      {state === 'ready' && pages.length > 0 ? (
        <PageTree
          onCreateChild={onCreateChild}
          onPageUpdated={onPageUpdated}
          onPagesChanged={onPagesChanged}
          pages={pages}
        />
      ) : null}
      {recentPages.length > 0 ? (
        <section aria-labelledby="recent-pages-title" className="sidebar-recent">
          <div className="sidebar-recent-heading">
            <span className="state-kicker">Recently edited</span>
            <h3 id="recent-pages-title">Recent pages</h3>
          </div>
          <nav aria-label="Recent pages">
            <ul className="sidebar-recent-list">
              {recentPages.map((page) => (
                <li key={page.id}>
                  <Link
                    aria-label={`Open recent page: ${page.title}`}
                    className="sidebar-recent-link"
                    to={workspacePath(page.id)}
                  >
                    <span aria-hidden="true" className="sidebar-recent-icon">
                      ↗
                    </span>
                    <span className="sidebar-recent-title">{page.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </section>
      ) : null}

      <div className="sidebar-footer">
        <button
          aria-label={isCreating ? 'Creating page' : 'New page'}
          className="new-page-button"
          disabled={isCreating || state !== 'ready'}
          onClick={onCreate}
          type="button"
        >
          <span aria-hidden="true">+</span>
          {isCreating ? 'Creating page…' : 'New page'}
          <kbd>⌘N</kbd>
        </button>
        <Link className="sidebar-settings-link" to="/app/settings">
          <svg
            aria-hidden="true"
            className="sidebar-settings-icon"
            focusable="false"
            viewBox="0 0 20 20"
          >
            <path d="M4 5h12M4 10h12M4 15h12" />
            <circle cx="8" cy="5" r="1.5" />
            <circle cx="12" cy="10" r="1.5" />
            <circle cx="7" cy="15" r="1.5" />
          </svg>
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}

function Workspace() {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [listState, setListState] = useState<PageListState>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [undoPage, setUndoPage] = useState<PageDetail | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [pageFilter, setPageFilter] = useState<PageFilter>({});
  const paletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const paletteTriggerRef = useRef<HTMLButtonElement>(null);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarReturnFocusRef = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { toggleTheme } = useTheme();
  const isMobile = useMediaQuery('(max-width: 760px)');
  const recentPages = useMemo(
    () => selectRecentPages(pages, pageIdFromWorkspacePath(location.pathname)),
    [location.pathname, pages],
  );
  const availableTags = useMemo(() => {
    const tags = new Map<string, TagSummary>();
    pages.forEach((page) => page.tags.forEach((tag) => tags.set(tag.id, tag)));
    return [...tags.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [pages]);
  const loadPages = useCallback(async (signal?: AbortSignal) => {
    setListState('loading');
    setListError(null);

    try {
      const response = await fetchPages({}, signal);
      if (!signal?.aborted) {
        setPages(response.pages);
        setListState('ready');
      }
    } catch (error: unknown) {
      if (!signal?.aborted) {
        setListError(pageErrorMessage(error, 'The page list could not be loaded.'));
        setListState('error');
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadPages(controller.signal);

    return () => controller.abort();
  }, [loadPages, reloadKey]);

  useEffect(() => {
    if (listState !== 'ready') {
      return;
    }

    if (location.pathname === '/app' && pages.length > 0) {
      navigate(workspacePath(pages[0].id), { replace: true });
    }
  }, [listState, location.pathname, navigate, pages]);

  const createPage = useCallback(
    async (parentId: string | null = null) => {
      if (isCreating) {
        return;
      }

      setIsCreating(true);
      setActionError(null);
      try {
        const response = await createPageRequest({ parentId, title: 'Untitled' });
        setPages((currentPages) => [...currentPages, response.page]);
        navigate(workspacePath(response.page.id));
      } catch (error: unknown) {
        setActionError(pageErrorMessage(error, 'The new page could not be created.'));
      } finally {
        setIsCreating(false);
      }
    },
    [isCreating, navigate],
  );

  const openDailyNote = useCallback(async () => {
    setActionError(null);
    try {
      const response = await openDailyNoteRequest();
      setPages((currentPages) => [
        ...currentPages.filter((page) => page.id !== response.page.id),
        response.page,
      ]);
      navigate(workspacePath(response.page.id));
    } catch (error: unknown) {
      setActionError(pageErrorMessage(error, 'The daily note could not be opened.'));
    }
  }, [navigate]);

  const openPalette = useCallback(() => {
    if (isPaletteOpen) {
      return;
    }

    const activeElement = document.activeElement;
    paletteReturnFocusRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : paletteTriggerRef.current;
    setActionError(null);
    setIsPaletteOpen(true);
  }, [isPaletteOpen]);

  const closePalette = useCallback(() => {
    setIsPaletteOpen(false);
  }, []);

  useEffect(() => {
    if (isPaletteOpen || paletteReturnFocusRef.current === null) {
      return;
    }

    const returnFocusElement = paletteReturnFocusRef.current;
    paletteReturnFocusRef.current = null;
    if (returnFocusElement.isConnected) {
      returnFocusElement.focus({ preventScroll: true });
    } else {
      paletteTriggerRef.current?.focus({ preventScroll: true });
    }
  }, [isPaletteOpen]);

  const openSidebar = useCallback(() => {
    if (isSidebarOpen) {
      return;
    }

    const activeElement = document.activeElement;
    sidebarReturnFocusRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : sidebarTriggerRef.current;
    setIsSidebarOpen(true);
  }, [isSidebarOpen]);

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (isSidebarOpen) {
      sidebarCloseRef.current?.focus({ preventScroll: true });
      return;
    }

    const returnFocusElement = sidebarReturnFocusRef.current;
    sidebarReturnFocusRef.current = null;
    if (returnFocusElement?.isConnected) {
      returnFocusElement.focus({ preventScroll: true });
    }
  }, [isSidebarOpen]);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isSidebarOpen]);

  useEffect(() => {
    closeSidebar();
  }, [closeSidebar, location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/app/settings')) {
      setUndoPage(null);
      setUndoError(null);
    }
  }, [location.pathname]);

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if (event.key === 'Escape' && isSidebarOpen) {
        event.preventDefault();
        closeSidebar();
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openPalette();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        closePalette();
        void createPage();
      }
    }

    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
  }, [closePalette, closeSidebar, createPage, isSidebarOpen, openPalette]);

  const onPageUpdated = useCallback((updatedPage: PageSummary) => {
    setPages((currentPages) =>
      currentPages.map((page) => (page.id === updatedPage.id ? updatedPage : page)),
    );
  }, []);

  const deletePage = useCallback(
    async (page: PageDetail) => {
      const response = await deletePageRequest(page.id, page.revision);
      setPages((currentPages) => currentPages.filter((currentPage) => currentPage.id !== page.id));
      setUndoPage(response.page);
      setUndoError(null);
      navigate('/app', { replace: true });
    },
    [navigate],
  );

  const undoDelete = useCallback(async () => {
    if (undoPage === null || isUndoing) {
      return;
    }

    setIsUndoing(true);
    setUndoError(null);
    try {
      const response = await restoreDeletedPage(undoPage.id, undoPage.revision);
      setPages((currentPages) => [
        ...currentPages.filter((page) => page.id !== response.page.id),
        response.page,
      ]);
      setUndoPage(null);
      navigate(workspacePath(response.page.id));
    } catch (error: unknown) {
      setUndoError(pageErrorMessage(error, 'The page could not be restored.'));
    } finally {
      setIsUndoing(false);
    }
  }, [isUndoing, navigate, undoPage]);

  const refreshPages = useCallback(async () => {
    await loadPages();
  }, [loadPages]);

  const exportPages = useCallback(async () => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);
    setActionError(null);
    try {
      await downloadKnowledgeBaseExport();
    } catch (error: unknown) {
      setActionError(
        `Export failed: ${pageErrorMessage(error, 'The export could not be downloaded.')}`,
      );
    } finally {
      setIsExporting(false);
    }
  }, [isExporting]);

  const retryPages = useCallback(() => setReloadKey((value) => value + 1), []);
  const context: WorkspaceOutletContext = {
    actionError,
    createPage,
    deletePage,
    exportPages,
    isCreating,
    isExporting,
    listError,
    listState,
    onPageUpdated,
    openDailyNote,
    pages,
    refreshPages,
    retryPages,
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <button
          aria-controls="workspace-sidebar"
          aria-expanded={isSidebarOpen}
          aria-label={isSidebarOpen ? 'Close pages navigation' : 'Open pages navigation'}
          className="mobile-sidebar-trigger"
          onClick={isSidebarOpen ? closeSidebar : openSidebar}
          ref={sidebarTriggerRef}
          type="button"
        >
          <span aria-hidden="true">{isSidebarOpen ? '×' : '☰'}</span>
        </button>
        <Link className="brand" to="/app">
          <span className="brand-mark" aria-hidden="true">
            D
          </span>
          <span>Dovari</span>
        </Link>
        <div className="header-actions">
          <button
            aria-haspopup="dialog"
            aria-keyshortcuts="Control+K Meta+K"
            aria-label="Open command palette"
            className="palette-trigger"
            onClick={openPalette}
            ref={paletteTriggerRef}
            type="button"
          >
            <span aria-hidden="true">⌕</span>
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
      </header>
      {actionError ? (
        <div aria-live="assertive" className="workspace-notice" role="alert">
          <span>{actionError}</span>
          <button
            className="button button-quiet"
            onClick={() => setActionError(null)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {undoPage ? (
        <div aria-live="polite" className="workspace-undo-notice" role="status">
          <span>
            <strong>{undoPage.title}</strong> moved to Trash.
            {undoError ? <small role="alert"> {undoError}</small> : null}
          </span>
          <button
            className="button button-secondary"
            disabled={isUndoing}
            onClick={() => void undoDelete()}
            type="button"
          >
            {isUndoing ? 'Restoring…' : 'Undo'}
          </button>
        </div>
      ) : null}
      <div className="app-workspace">
        <Sidebar
          closeButtonRef={sidebarCloseRef}
          error={listError}
          isCreating={isCreating}
          onCreate={() => void createPage(null)}
          onCreateChild={(parentId) => void createPage(parentId)}
          onPageUpdated={onPageUpdated}
          onPagesChanged={refreshPages}
          onRetry={retryPages}
          pages={pages}
          recentPages={recentPages}
          state={listState}
          isMobile={isMobile}
          isOpen={isSidebarOpen}
          onClose={closeSidebar}
        />
        {isSidebarOpen ? (
          <div aria-hidden="true" className="sidebar-backdrop" onMouseDown={closeSidebar} />
        ) : null}
        <main className="app-content" id="main-content" tabIndex={-1}>
          <Outlet context={context} />
        </main>
      </div>
      {isPaletteOpen ? (
        <CommandPalette
          canCreatePage={listState === 'ready'}
          isCreating={isCreating}
          onClose={closePalette}
          onCreatePage={() => void createPage()}
          onFilterChange={setPageFilter}
          onOpenDailyNote={() => void openDailyNote()}
          onOpenPage={(url) => navigate(url)}
          onThemeToggle={toggleTheme}
          availableTags={availableTags}
          searchFilters={pageFilter}
        />
      ) : null}
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<LoginPage />} path="/login" />
      <Route element={<Workspace />} path="/app">
        <Route element={<WorkspaceLanding />} index />
        <Route element={<PageRoute />} path="pages/:pageId" />
        <Route element={<PublicationEditorRoute />} path="publications/:publicId/edit" />
        <Route element={<SettingsPage />} path="settings" />
        <Route element={<TemplatesPage />} path="settings/templates" />
        <Route element={<TrashPage />} path="settings/trash" />
        <Route element={<BackupRestorePage />} path="settings/backup" />
      </Route>
      <Route element={<PublicLandingPage />} path="/" />
      <Route element={<PublicPage />} path="/p/:publicId" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}
