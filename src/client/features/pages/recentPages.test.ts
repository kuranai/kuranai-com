import { describe, expect, it } from 'vitest';

import type { PageSummary } from '../../../shared/pages';
import { RECENT_PAGE_LIMIT, selectRecentPages } from './recentPages';

function page(id: string, updatedAt: string, title = id): PageSummary {
  return {
    id,
    isFavorite: false,
    parentId: null,
    position: 0,
    revision: 1,
    slug: title.toLowerCase().replaceAll(' ', '-'),
    title,
    tags: [],
    updatedAt,
  };
}

describe('selectRecentPages', () => {
  it('sorts by updatedAt, excludes the open page, and caps the list', () => {
    const pages = Array.from({ length: RECENT_PAGE_LIMIT + 2 }, (_, index) =>
      page(
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        `2026-09-0${index + 1}T00:00:00.000Z`,
        `Page ${index + 1}`,
      ),
    );

    expect(selectRecentPages(pages, pages[pages.length - 1]!.id)).toEqual([
      pages[5],
      pages[4],
      pages[3],
      pages[2],
      pages[1],
    ]);
  });

  it('uses a stable title and id tie-breaker', () => {
    const timestamp = '2026-09-14T00:00:00.000Z';
    const pages = [
      page('00000000-0000-4000-8000-000000000002', timestamp, 'Beta'),
      page('00000000-0000-4000-8000-000000000001', timestamp, 'Alpha'),
    ];

    expect(selectRecentPages(pages).map((item) => item.title)).toEqual(['Alpha', 'Beta']);
  });
});
