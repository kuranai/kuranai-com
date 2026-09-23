import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PageDetail, PageSummary } from '../../../shared/pages';
import { PageTree } from './PageTree';

const sourceId = '66666666-6666-4666-8666-666666666666';
const targetId = '77777777-7777-4777-8777-777777777777';

function pageSummary(overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    id: sourceId,
    isFavorite: false,
    parentId: null,
    position: 0,
    revision: 1,
    slug: 'source',
    title: 'Source',
    tags: [],
    updatedAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

function pageDetail(page: PageSummary): PageDetail {
  return {
    ...page,
    content: { content: [], type: 'doc' },
    contentText: '',
    createdAt: '2026-09-12T00:00:00.000Z',
    deletedAt: null,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PageTree pointer interactions', () => {
  it('moves a page into another page through native drag and drop', async () => {
    const source = pageSummary();
    const target = pageSummary({
      id: targetId,
      position: 1,
      slug: 'target',
      title: 'Target',
    });
    const moved = pageDetail({ ...source, revision: 2 });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ page: moved }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onPagesChanged = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <PageTree
          onCreateChild={vi.fn()}
          onPageUpdated={vi.fn()}
          onPagesChanged={onPagesChanged}
          pages={[source, target]}
        />
      </MemoryRouter>,
    );

    const sourceRow = document.querySelector(
      `[aria-label="Drag ${source.title} to move it"]`,
    ) as HTMLElement;
    const targetRow = document.querySelector(
      `[aria-label="Drag ${target.title} to move it"]`,
    ) as HTMLElement;
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn((format: string) => (format === 'text/plain' ? source.id : '')),
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(sourceRow, { dataTransfer });
    fireEvent.dragOver(targetRow, { dataTransfer });
    await waitFor(() => expect(targetRow.className).toContain('is-drop-into'));
    fireEvent.drop(targetRow, { dataTransfer });

    await waitFor(() => expect(onPagesChanged).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody).toEqual({ parentId: target.id });
  });
});
