import {
  privatePublicationResponseSchema,
  privatePublicationSchema,
  publicationEditorTargetResponseSchema,
  publicPublicationResponseSchema,
  publicPublicationsResponseSchema,
  publishPublicationRequestSchema,
  unpublishPublicationResponseSchema,
  unpublishPublicationRequestSchema,
  type PrivatePublication,
  type PublicPublication,
  type PublicPublicationsResponse,
  type PublishPublicationRequest,
  type UnpublishPublicationRequest,
} from '../../../shared/publications';
import {
  publicSearchResponseSchema,
  type PublicSearchResponse,
} from '../../../shared/public-search';
import { PageApiError, request } from '../pages/api';

export function fetchPrivatePublication(pageId: string, signal?: AbortSignal) {
  return request<{ publication: PrivatePublication | null }>(
    `/api/private/pages/${encodeURIComponent(pageId)}/publication`,
    privatePublicationResponseSchema,
    { signal },
  );
}

export function publishPrivatePublication(pageId: string, input: PublishPublicationRequest) {
  const parsed = publishPublicationRequestSchema.parse(input);
  return request<{ publication: PrivatePublication }>(
    `/api/private/pages/${encodeURIComponent(pageId)}/publication`,
    privatePublicationResponseSchema.extend({
      publication: privatePublicationSchema,
    }),
    { body: JSON.stringify(parsed), method: 'PUT' },
  );
}

export function unpublishPrivatePublication(pageId: string, input: UnpublishPublicationRequest) {
  const parsed = unpublishPublicationRequestSchema.parse(input);
  return request<{ unpublished: true; publicId: string }>(
    `/api/private/pages/${encodeURIComponent(pageId)}/publication`,
    unpublishPublicationResponseSchema,
    { body: JSON.stringify(parsed), method: 'DELETE' },
  );
}

export function resolvePublicationEditorTarget(publicId: string, signal?: AbortSignal) {
  return request<{ pageId: string }>(
    `/api/private/publications/${encodeURIComponent(publicId)}/editor-target`,
    publicationEditorTargetResponseSchema,
    { signal },
  );
}

export function fetchPublicPublications(cursor?: string | null, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  params.set('limit', '100');
  return request<PublicPublicationsResponse>(
    `/api/public/publications?${params.toString()}`,
    publicPublicationsResponseSchema,
    { signal },
  );
}

export function fetchPublicPublication(publicId: string, signal?: AbortSignal) {
  return request<{ publication: PublicPublication }>(
    `/api/public/publications/${encodeURIComponent(publicId)}`,
    publicPublicationResponseSchema,
    { signal },
  );
}

export function searchPublicPages(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: '20', q: query });
  return request<PublicSearchResponse>(
    `/api/public/search?${params.toString()}`,
    publicSearchResponseSchema,
    { signal },
  );
}

export async function fetchAllPublicPublications(signal?: AbortSignal) {
  const publications: PublicPublicationsResponse['publications'] = [];
  let cursor: string | null = null;
  do {
    const response = await fetchPublicPublications(cursor, signal);
    publications.push(...response.publications);
    cursor = response.nextCursor;
  } while (cursor !== null);
  return publications;
}

export function publicationErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof PageApiError)) {
    if (error instanceof TypeError) {
      return 'Dovari could not reach the public knowledge base. Check your connection and try again.';
    }
    return fallback;
  }

  switch (error.code) {
    case 'PUBLICATION_NOT_FOUND':
      return 'This public page is no longer available.';
    case 'PAGE_CONFLICT':
      return 'This page changed elsewhere. Reload it before publishing again.';
    case 'PUBLICATION_CONFLICT':
      return 'The publication changed elsewhere. Reload it and try again.';
    case 'AUTH_REQUIRED':
    case 'AUTH_INVALID':
      return 'Your Dovari session is not available. Sign in again and retry.';
    default:
      return error.message || fallback;
  }
}
