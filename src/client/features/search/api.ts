import {
  normalizeSearchQuery,
  searchResponseSchema,
  type SearchResponse,
} from '../../../shared/search';
import { request } from '../pages/api';

export function searchPages(
  query: string,
  signal?: AbortSignal,
  filters: { favorite?: boolean; tagId?: string } = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: normalizeSearchQuery(query) });
  if (filters.favorite !== undefined) params.set('favorite', String(filters.favorite));
  if (filters.tagId !== undefined) params.set('tagId', filters.tagId);
  return request<SearchResponse>(`/api/private/search?${params.toString()}`, searchResponseSchema, {
    signal,
  });
}
