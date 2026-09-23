import {
  createTagRequestSchema,
  deleteTagResponseSchema,
  tagListResponseSchema,
  tagResponseSchema,
  updatePageFavoriteRequestSchema,
  updatePageTagsRequestSchema,
  updateTagRequestSchema,
  type CreateTagRequest,
  type UpdatePageFavoriteRequest,
  type UpdatePageTagsRequest,
  type UpdateTagRequest,
} from '../../../shared/tags';
import { pageResponseSchema, type PageResponse } from '../../../shared/pages';
import { request } from '../pages/api';

export function fetchTags(signal?: AbortSignal) {
  return request('/api/private/tags', tagListResponseSchema, { signal });
}

export function createTag(input: CreateTagRequest) {
  const parsed = createTagRequestSchema.parse(input);
  return request('/api/private/tags', tagResponseSchema, {
    body: JSON.stringify(parsed),
    method: 'POST',
  });
}

export function renameTag(id: string, input: UpdateTagRequest) {
  const parsed = updateTagRequestSchema.parse(input);
  return request(`/api/private/tags/${encodeURIComponent(id)}`, tagResponseSchema, {
    body: JSON.stringify(parsed),
    method: 'PATCH',
  });
}

export function deleteTag(id: string) {
  return request(`/api/private/tags/${encodeURIComponent(id)}`, deleteTagResponseSchema, {
    method: 'DELETE',
  });
}

export function updatePageTags(id: string, input: UpdatePageTagsRequest) {
  const parsed = updatePageTagsRequestSchema.parse(input);
  return request<PageResponse>(
    `/api/private/pages/${encodeURIComponent(id)}/tags`,
    pageResponseSchema,
    { body: JSON.stringify(parsed), method: 'PUT' },
  );
}

export function updatePageFavorite(id: string, input: UpdatePageFavoriteRequest) {
  const parsed = updatePageFavoriteRequestSchema.parse(input);
  return request<PageResponse>(
    `/api/private/pages/${encodeURIComponent(id)}/favorite`,
    pageResponseSchema,
    { body: JSON.stringify(parsed), method: 'PUT' },
  );
}
