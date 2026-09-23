import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageDetail, PageSummary } from '../../shared/pages';
import { App } from './App';
import { THEME_STORAGE_KEY } from './theme';

const pageId = '11111111-1111-4111-8111-111111111111';

function createPage(overrides: Partial<PageDetail> = {}): PageDetail {
  return {
    content: { content: [], type: 'doc' },
    contentText: '',
    createdAt: '2026-09-12T00:00:00.000Z',
    deletedAt: null,
    id: pageId,
    isFavorite: false,
    parentId: null,
    position: 0,
    revision: 1,
    slug: 'untitled',
    title: 'Untitled',
    tags: [],
    updatedAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

function pageSummary(page: PageDetail): PageSummary {
  return {
    id: page.id,
    parentId: page.parentId,
    position: page.position,
    revision: page.revision,
    slug: page.slug,
    title: page.title,
    isFavorite: page.isFavorite,
    tags: page.tags,
    updatedAt: page.updatedAt,
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

beforeEach(() => {
  window.history.pushState({}, '', '/app');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
  window.history.pushState({}, '', '/app');
});

describe('Dovari app shell', () => {
  it('renders an empty workspace and offers a first page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ pages: [] }));

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Start with one useful page.' }),
    ).toBeTruthy();
    expect(screen.getByText('No pages yet.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New page' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates, renames, and deletes a page without leaving the app shell', async () => {
    let page = createPage();
    let pages: PageSummary[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/api/private/pages' && method === 'GET') {
        return response({ pages });
      }

      if (url === '/api/private/pages' && method === 'POST') {
        pages = [page];
        return response({ page }, 201);
      }

      if (url === `/api/private/pages/${pageId}` && method === 'GET') {
        return response({ page });
      }

      if (url === `/api/private/pages/${pageId}` && method === 'PATCH') {
        page = createPage({
          ...page,
          revision: page.revision + 1,
          slug: 'renamed-page',
          title: 'Renamed page',
          updatedAt: '2026-09-12T00:00:01.000Z',
        });
        pages = [page];
        return response({ page });
      }

      if (url === `/api/private/pages/${pageId}` && method === 'DELETE') {
        page = createPage({ ...page, deletedAt: '2026-09-12T00:00:02.000Z', revision: 3 });
        pages = [];
        return response({ page });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    render(<App />);

    await screen.findByRole('button', { name: 'New page' });
    fireEvent.click(screen.getByRole('button', { name: 'New page' }));

    expect(await screen.findByRole('heading', { name: 'Untitled' })).toBeTruthy();
    expect(window.location.pathname).toBe(`/app/pages/${pageId}`);
    expect(screen.getByRole('link', { name: 'Untitled' }).getAttribute('href')).toBe(
      `/app/pages/${pageId}`,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Edit title' }), {
      target: { value: 'Renamed page' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));

    expect(await screen.findByRole('heading', { name: 'Renamed page' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Renamed page' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));

    expect(
      await screen.findByRole('heading', { name: 'Start with one useful page.' }),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Renamed page' })).toBeNull();
    expect(window.location.pathname).toBe('/app');
    expect(fetchMock.mock.calls.map((call) => call[1]?.method ?? 'GET')).toEqual(
      expect.arrayContaining(['GET', 'POST', 'GET', 'PATCH', 'DELETE']),
    );
  });

  it('edits the title directly, saves on blur, and keeps the document surface quiet', async () => {
    let page = createPage();
    let pages: PageSummary[] = [pageSummary(page)];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/api/private/pages' && method === 'GET') {
        return response({ pages });
      }

      if (url === `/api/private/pages/${pageId}` && method === 'GET') {
        return response({ page });
      }

      if (url === `/api/private/pages/${pageId}/backlinks` && method === 'GET') {
        return response({ backlinks: [] });
      }

      if (url === `/api/private/pages/${pageId}` && method === 'PATCH') {
        const body = JSON.parse(String(init?.body));
        page = createPage({
          ...page,
          revision: page.revision + 1,
          slug: 'document-page',
          title: body.title,
          updatedAt: '2026-09-13T00:00:01.000Z',
        });
        pages = [pageSummary(page)];
        return response({ page });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    render(<App />);

    const titleInput = await screen.findByRole('textbox', { name: 'Edit title' });
    vi.useFakeTimers();
    fireEvent.change(titleInput, { target: { value: 'Document page' } });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input) === `/api/private/pages/${pageId}` && init?.method === 'PATCH',
      ),
    ).toHaveLength(0);
    vi.useRealTimers();
    fireEvent.blur(titleInput);

    expect(await screen.findByRole('heading', { name: 'Document page' })).toBeTruthy();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/private/pages/${pageId}`,
        expect.objectContaining({
          body: JSON.stringify({ baseRevision: 1, title: 'Document page' }),
          method: 'PATCH',
        }),
      ),
    );
    expect(screen.queryByText('Content', { exact: true })).toBeNull();
    expect(screen.queryByText('Write in context.', { exact: true })).toBeNull();
    expect(screen.queryByText('View current document JSON', { exact: true })).toBeNull();
    expect(screen.queryByText('/untitled', { exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete page' })).toBeTruthy();
  });

  it('creates children, collapses branches, renames inline, and offers keyboard moving', async () => {
    const rootId = '22222222-2222-4222-8222-222222222222';
    const siblingId = '33333333-3333-4333-8333-333333333333';
    const childId = '44444444-4444-4444-8444-444444444444';
    const createdId = '55555555-5555-4555-8555-555555555555';
    let root = createPage({ id: rootId, slug: 'root', title: 'Root' });
    let sibling = createPage({ id: siblingId, position: 1, slug: 'sibling', title: 'Sibling' });
    const child = createPage({
      id: childId,
      parentId: rootId,
      position: 0,
      slug: 'child',
      title: 'Child',
    });
    let pages: PageSummary[] = [pageSummary(root), pageSummary(sibling), pageSummary(child)];
    const pageStore = new Map<string, PageDetail>([
      [root.id, root],
      [sibling.id, sibling],
      [child.id, child],
    ]);
    const created = createPage({
      id: createdId,
      parentId: rootId,
      position: 1,
      slug: 'untitled-2',
      title: 'Untitled',
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));

      if (url === '/api/private/pages' && method === 'GET') {
        return response({ pages });
      }

      if (url === '/api/private/pages' && method === 'POST') {
        pageStore.set(created.id, created);
        pages = [...pages, pageSummary(created)];
        return response({ page: created }, 201);
      }

      const pageIdMatch = url.match(/^\/api\/private\/pages\/([^/]+)$/);
      if (pageIdMatch && method === 'GET') {
        const page = pageStore.get(pageIdMatch[1]);
        if (!page) {
          throw new Error(`Unknown page ${pageIdMatch[1]}`);
        }
        return response({ page });
      }

      if (pageIdMatch && method === 'PATCH') {
        const current = pageStore.get(pageIdMatch[1]);
        if (!current) {
          throw new Error(`Unknown page ${pageIdMatch[1]}`);
        }
        root = createPage({
          ...current,
          revision: current.revision + 1,
          slug: 'renamed-root',
          title: body.title,
          updatedAt: '2026-09-12T00:00:01.000Z',
        });
        pageStore.set(root.id, root);
        pages = pages.map((page) => (page.id === root.id ? pageSummary(root) : page));
        return response({ page: root });
      }

      const moveMatch = url.match(/^\/api\/private\/pages\/([^/]+)\/move$/);
      if (moveMatch && method === 'POST') {
        sibling = createPage({
          ...sibling,
          position: 0,
          revision: sibling.revision + 1,
          updatedAt: '2026-09-12T00:00:02.000Z',
        });
        root = createPage({ ...root, position: 1 });
        pageStore.set(sibling.id, sibling);
        pageStore.set(root.id, root);
        pages = pages.map((page) => {
          if (page.id === sibling.id) {
            return pageSummary(sibling);
          }
          if (page.id === root.id) {
            return pageSummary(root);
          }
          return page;
        });
        return response({ page: sibling });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    render(<App />);

    expect(await screen.findByRole('link', { name: 'Root' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rename Root' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move Root' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Root' }));
    expect(screen.queryByRole('link', { name: 'Child' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Root' }));
    expect(screen.getByRole('link', { name: 'Child' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create child of Root' }));
    expect(await screen.findByRole('heading', { name: 'Untitled' })).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Root' }));
    expect(await screen.findByRole('heading', { name: 'Root' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit title' }), {
      target: { value: 'Renamed root' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
    expect(await screen.findByRole('link', { name: 'Renamed root' })).toBeTruthy();

    const sourceRow = screen.getByLabelText('Drag Sibling to move it');
    const targetRow = screen.getByLabelText('Drag Renamed root to move it');
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn((format: string) => (format === 'text/plain' ? siblingId : '')),
      setData: vi.fn(),
    } as unknown as DataTransfer;
    fireEvent.dragStart(sourceRow, { dataTransfer });
    fireEvent.dragOver(targetRow, { dataTransfer });
    await waitFor(() => expect(targetRow.className).toContain('is-drop-into'));
    fireEvent.drop(targetRow, { dataTransfer });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([requestUrl, requestInit]) =>
            String(requestUrl) === `/api/private/pages/${siblingId}/move` &&
            requestInit?.method === 'POST',
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sibling' })).toBeTruthy());
  });

  it('shows a retryable error when the page list cannot be loaded', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        response(
          {
            error: {
              code: 'HEALTH_UNAVAILABLE',
              message: 'Service unavailable.',
            },
            requestId: 'test-request',
          },
          503,
        ),
      )
      .mockResolvedValueOnce(response({ pages: [] }));

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'We couldn’t load your pages.' }),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(
      await screen.findByRole('heading', { name: 'Start with one useful page.' }),
    ).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('downloads a Markdown and ZIP export with visible progress', async () => {
    let resolveExport!: (value: Response) => void;
    const exportResponse = new Promise<Response>((resolve) => {
      resolveExport = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/private/pages') {
        return response({ pages: [] });
      }
      if (String(input) === '/api/private/export') {
        return exportResponse;
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const createObjectUrl = vi.fn(() => 'blob:export');
    const revokeObjectUrl = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });

    try {
      render(<App />);
      fireEvent.click(await screen.findByRole('link', { name: 'Settings' }));
      await screen.findByRole('heading', { name: 'Settings' });
      const exportButton = await screen.findByRole('button', {
        name: 'Export Markdown + ZIP',
      });
      fireEvent.click(exportButton);

      expect(
        (screen.getByRole('button', { name: 'Preparing export…' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      resolveExport(
        new Response(new Blob(['PK']), {
          headers: { 'Content-Type': 'application/zip' },
        }),
      );

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Export Markdown + ZIP' })).toBeTruthy(),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/private/export',
        expect.objectContaining({ headers: { Accept: 'application/zip' } }),
      );
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith('blob:export'));
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectUrl,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    }
  });

  it('shows an actionable export error when the download fails', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ pages: [] }))
      .mockResolvedValueOnce(
        response(
          {
            error: { code: 'EXPORT_FAILED', message: 'The export could not be prepared.' },
          },
          500,
        ),
      );

    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    fireEvent.click(await screen.findByRole('button', { name: 'Export Markdown + ZIP' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Export failed: The export could not be prepared.');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/private/export',
      expect.objectContaining({ headers: { Accept: 'application/zip' } }),
    );
  });

  it('opens the command palette from Ctrl+K, toggles the theme, and restores focus', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ pages: [] }));

    render(<App />);

    await screen.findByRole('heading', { name: 'Start with one useful page.' });
    const trigger = screen.getByRole('button', { name: 'Open command palette' });
    trigger.focus();

    fireEvent.keyDown(window, { ctrlKey: true, key: 'k' });
    const input = await screen.findByRole('searchbox');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('dialog', { name: 'Search or run a command' })).toBeTruthy();

    fireEvent.click(screen.getByText('Toggle theme'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the complete Settings route from the command palette', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ pages: [] }));

    render(<App />);

    await screen.findByRole('heading', { name: 'Start with one useful page.' });
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    fireEvent.click(screen.getByRole('option', { name: /Go to settings/ }));

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(window.location.pathname).toBe('/app/settings');
    expect(screen.getByRole('link', { name: 'Open Trash' }).getAttribute('href')).toBe(
      '/app/settings/trash',
    );
    expect(screen.getByRole('link', { name: 'Create backup' }).getAttribute('href')).toBe(
      '/app/settings/backup',
    );
    expect(screen.getByRole('link', { name: 'Restore a backup' }).getAttribute('href')).toBe(
      '/app/settings/backup',
    );
  });

  it('shows five most recently updated pages in the sidebar without duplicates', async () => {
    const pages = Array.from({ length: 6 }, (_, index) => {
      const page = createPage({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        slug: `page-${index + 1}`,
        title: `Page ${index + 1}`,
        updatedAt: `2026-09-1${index}T00:00:00.000Z`,
      });
      return pageSummary(page);
    });
    window.history.pushState({}, '', '/app/settings');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ pages }));

    render(<App />);

    await screen.findByRole('heading', { name: 'Settings' });
    const recent = screen.getByRole('navigation', { name: 'Recent pages' });
    const recentLinks = within(recent).getAllByRole('link');
    expect(recentLinks).toHaveLength(5);
    expect(
      recentLinks.map((link) => link.querySelector('.sidebar-recent-title')?.textContent?.trim()),
    ).toEqual(['Page 6', 'Page 5', 'Page 4', 'Page 3', 'Page 2']);
  });

  it('persists the selected theme and exposes the mobile navigation controls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ pages: [] }));

    render(<App />);

    await screen.findByRole('heading', { name: 'Start with one useful page.' });
    expect(screen.queryByRole('combobox', { name: 'Theme' })).toBeNull();
    expect(screen.queryByText('Your knowledge base')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    const themeSelect = screen.getByRole('combobox', { name: 'Theme' });
    fireEvent.change(themeSelect, { target: { value: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    const navigationTrigger = screen.getByRole('button', { name: 'Open pages navigation' });
    fireEvent.click(navigationTrigger);
    expect(navigationTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('button', { name: 'Close pages navigation' })).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(navigationTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(navigationTrigger);
  });
});
