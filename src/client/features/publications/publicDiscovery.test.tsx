import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PublicPublicationSummary } from '../../../shared/publications';
import { PublicSearch } from './PublicSearch';
import { flattenPublicNavigation } from './navigation';

const rootId = '11111111-1111-4111-8111-111111111111';
const childId = '22222222-2222-4222-8222-222222222222';
const hiddenId = '33333333-3333-4333-8333-333333333333';

function publication(
  publicId: string,
  publishedTitle: string,
  parentPublicId: string | null,
  position: number,
): PublicPublicationSummary {
  return {
    allowIndexing: false,
    parentPublicId,
    position,
    publicId,
    publishedAt: '2026-09-14T00:00:00.000Z',
    publishedTitle,
    tags: [],
    updatedAt: '2026-09-14T00:00:00.000Z',
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

describe('public discovery UI', () => {
  it('flattens published hierarchy while keeping missing parents at the root', () => {
    const items = flattenPublicNavigation([
      publication(childId, 'Child', rootId, 2),
      publication(rootId, 'Root', null, 1),
      publication(hiddenId, 'Orphaned public page', '44444444-4444-4444-8444-444444444444', 0),
    ]);

    expect(items.map((item) => [item.publishedTitle, item.depth])).toEqual([
      ['Orphaned public page', 0],
      ['Root', 0],
      ['Child', 1],
    ]);
  });

  it('debounces public search and opens the highlighted result with the keyboard', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              breadcrumb: [],
              publicId: rootId,
              publishedTitle: 'Public handbook',
              snippet: 'A <mark>searchable</mark> handbook',
              url: `/p/${rootId}`,
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(
      <MemoryRouter>
        <PublicSearch />
        <LocationProbe />
      </MemoryRouter>,
    );

    const input = screen.getByRole('searchbox', { name: 'Search public pages' });
    await act(async () => {
      fireEvent.change(input, { target: { value: 'searchable' } });
      await vi.advanceTimersByTimeAsync(180);
      await Promise.resolve();
    });

    expect(screen.getByText('Public handbook')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('location').textContent).toBe(`/p/${rootId}`);
    expect(screen.queryByText('Public handbook')).toBeNull();
  });
});
