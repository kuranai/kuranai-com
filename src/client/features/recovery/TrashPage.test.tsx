import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';

import type { PageDetail } from '../../../shared/pages';
import type { WorkspaceOutletContext } from '../../app/App';
import { TrashPage } from './TrashPage';

const pageId = '11111111-1111-4111-8111-111111111111';
const timestamp = '2026-09-13T12:00:00.000Z';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function trashPage() {
  return {
    deletedAt: timestamp,
    id: pageId,
    parentId: null,
    revision: 4,
    title: 'Deleted notes',
    updatedAt: timestamp,
  };
}

function restoredPage(): PageDetail {
  return {
    content: { content: [], type: 'doc' },
    contentText: '',
    createdAt: '2026-09-13T11:00:00.000Z',
    deletedAt: null,
    id: pageId,
    isFavorite: false,
    parentId: null,
    position: 0,
    revision: 5,
    slug: 'deleted-notes',
    title: 'Deleted notes',
    tags: [],
    updatedAt: '2026-09-13T12:01:00.000Z',
  };
}

function renderTrash(refreshPages = vi.fn().mockResolvedValue(undefined)) {
  render(
    <MemoryRouter initialEntries={['/app/settings/trash']}>
      <Routes>
        <Route
          element={<Outlet context={{ refreshPages } as unknown as WorkspaceOutletContext} />}
          path="/app"
        >
          <Route element={<TrashPage />} path="settings/trash" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

  return refreshPages;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TrashPage', () => {
  it('loads deleted pages and restores one through the recovery API', async () => {
    const page = trashPage();
    const refreshPages = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/private/trash?limit=50' && method === 'GET') {
        return response({ nextCursor: null, pages: [page] });
      }
      if (url === `/api/private/pages/${pageId}/restore` && method === 'POST') {
        return response({ page: restoredPage() });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderTrash(refreshPages);

    expect(await screen.findByRole('heading', { name: 'Deleted notes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(refreshPages).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/private/pages/${pageId}/restore`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(window.location.pathname).toBe('/');
  });

  it('requires the exact title before permanent deletion', async () => {
    const page = trashPage();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/private/trash?limit=50' && method === 'GET') {
        return response({ nextCursor: null, pages: [page] });
      }
      if (url === `/api/private/pages/${pageId}/permanent` && method === 'DELETE') {
        return response({ deleted: true, pageId });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderTrash();
    await screen.findByRole('heading', { name: 'Deleted notes' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    const confirmation = screen.getByRole('form', { name: 'Permanently delete Deleted notes' });
    fireEvent.change(screen.getByLabelText(/Type .* to confirm/), {
      target: { value: 'Deleted notes' },
    });
    fireEvent.click(confirmation.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/private/pages/${pageId}/permanent`,
        expect.objectContaining({
          body: JSON.stringify({ baseRevision: 4, confirmationTitle: 'Deleted notes' }),
          method: 'DELETE',
        }),
      ),
    );
    expect(await screen.findByText('Trash is empty.')).toBeTruthy();
  });
});
