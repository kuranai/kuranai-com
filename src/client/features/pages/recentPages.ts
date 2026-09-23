import type { PageSummary } from '../../../shared/pages';

export const RECENT_PAGE_LIMIT = 5;

function updatedAtTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

export function selectRecentPages(
  pages: PageSummary[],
  currentPageId: string | null = null,
  limit = RECENT_PAGE_LIMIT,
) {
  if (limit <= 0) {
    return [];
  }

  return pages
    .filter((page) => page.id !== currentPageId)
    .slice()
    .sort((first, second) => {
      return (
        updatedAtTimestamp(second.updatedAt) - updatedAtTimestamp(first.updatedAt) ||
        first.title.localeCompare(second.title, undefined, { sensitivity: 'base' }) ||
        first.id.localeCompare(second.id)
      );
    })
    .slice(0, limit);
}
