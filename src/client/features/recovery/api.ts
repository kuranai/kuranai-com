import { pageResponseSchema, type PageResponse } from '../../../shared/pages';
import {
  permanentDeleteRequestSchema,
  permanentDeleteResponseSchema,
  revisionResponseSchema,
  revisionsListResponseSchema,
  restorePageRequestSchema,
  trashListResponseSchema,
  type PermanentDeleteResponse,
  type RevisionResponse,
  type RevisionsListResponse,
  type TrashListResponse,
} from '../../../shared/recovery';
import { PageApiError, request } from '../pages/api';

function queryString(cursor?: string, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) {
    params.set('cursor', cursor);
  }
  return params.toString();
}

export function fetchTrash(cursor?: string, signal?: AbortSignal): Promise<TrashListResponse> {
  return request<TrashListResponse>(
    `/api/private/trash?${queryString(cursor)}`,
    trashListResponseSchema,
    { signal },
  );
}

export function restoreDeletedPage(id: string, baseRevision: number): Promise<PageResponse> {
  const body = restorePageRequestSchema.parse({ baseRevision });
  return request<PageResponse>(
    `/api/private/pages/${encodeURIComponent(id)}/restore`,
    pageResponseSchema,
    { body: JSON.stringify(body), method: 'POST' },
  );
}

export function fetchPageRevisions(
  pageId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<RevisionsListResponse> {
  return request<RevisionsListResponse>(
    `/api/private/pages/${encodeURIComponent(pageId)}/revisions?${queryString(cursor)}`,
    revisionsListResponseSchema,
    { signal },
  );
}

export function fetchPageRevision(
  pageId: string,
  revisionId: string,
  signal?: AbortSignal,
): Promise<RevisionResponse> {
  return request<RevisionResponse>(
    `/api/private/pages/${encodeURIComponent(pageId)}/revisions/${encodeURIComponent(revisionId)}`,
    revisionResponseSchema,
    { signal },
  );
}

export function restorePageRevision(
  pageId: string,
  revisionId: string,
  baseRevision: number,
): Promise<PageResponse> {
  const body = restorePageRequestSchema.parse({ baseRevision });
  return request<PageResponse>(
    `/api/private/pages/${encodeURIComponent(pageId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
    pageResponseSchema,
    { body: JSON.stringify(body), method: 'POST' },
  );
}

export function permanentlyDeletePage(
  id: string,
  baseRevision: number,
  confirmationTitle: string,
): Promise<PermanentDeleteResponse> {
  const body = permanentDeleteRequestSchema.parse({ baseRevision, confirmationTitle });
  return request<PermanentDeleteResponse>(
    `/api/private/pages/${encodeURIComponent(id)}/permanent`,
    permanentDeleteResponseSchema,
    { body: JSON.stringify(body), method: 'DELETE' },
  );
}

export { PageApiError };
