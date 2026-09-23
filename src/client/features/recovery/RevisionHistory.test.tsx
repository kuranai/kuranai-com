import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PageDetail } from '../../../shared/pages';
import { RevisionHistory } from './RevisionHistory';

const pageId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const timestamp = '2026-09-13T12:00:00.000Z';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function currentPage(): PageDetail {
  return {
    content: { content: [], type: 'doc' },
    contentText: '',
    createdAt: '2026-09-13T11:00:00.000Z',
    deletedAt: null,
    id: pageId,
    isFavorite: false,
    parentId: null,
    position: 0,
    revision: 3,
    slug: 'history-page',
    title: 'History page',
    tags: [],
    updatedAt: timestamp,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RevisionHistory', () => {
  it('previews a saved version and restores it as a new revision', async () => {
    const onClose = vi.fn();
    const onRestored = vi.fn();
    const restoredPage = { ...currentPage(), revision: 4, title: 'Older title' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === `/api/private/pages/${pageId}/revisions?limit=50` && method === 'GET') {
        return response({
          nextCursor: null,
          revisions: [
            {
              createdAt: timestamp,
              id: revisionId,
              pageId,
              sourceRevision: 2,
              title: 'Older title',
              trigger: 'interval',
            },
          ],
        });
      }
      if (url === `/api/private/pages/${pageId}/revisions/${revisionId}` && method === 'GET') {
        return response({
          revision: {
            content: {
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Older text' }] }],
              type: 'doc',
            },
            createdAt: timestamp,
            id: revisionId,
            pageId,
            sourceRevision: 2,
            title: 'Older title',
            trigger: 'interval',
          },
        });
      }
      if (
        url === `/api/private/pages/${pageId}/revisions/${revisionId}/restore` &&
        method === 'POST'
      ) {
        return response({ page: restoredPage });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    render(<RevisionHistory onClose={onClose} onRestored={onRestored} page={currentPage()} />);

    const dialog = await screen.findByRole('dialog', { name: 'Version history' });
    expect(await screen.findByText('Older text')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(restoredPage));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/private/pages/${pageId}/revisions/${revisionId}/restore`,
      expect.objectContaining({
        body: JSON.stringify({ baseRevision: 3 }),
        method: 'POST',
      }),
    );
    expect(dialog).toBeTruthy();
  });
});
