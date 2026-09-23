import { z } from 'zod';

import { publicIdSchema, publicPublicationSummarySchema } from './publications';
import { normalizeSearchQuery, buildFtsMatchQuery } from './search';

export const PUBLIC_SEARCH_DEFAULT_LIMIT = 20;
export const PUBLIC_SEARCH_MAX_RESULTS = 50;
export const PUBLIC_SEARCH_SNIPPET_MAX_LENGTH = 20_000;

export const publicSearchBreadcrumbSchema = z
  .object({
    publicId: publicIdSchema,
    publishedTitle: publicPublicationSummarySchema.shape.publishedTitle,
    url: z.string().startsWith('/p/'),
  })
  .strict();

export const publicSearchResultSchema = z
  .object({
    publicId: publicIdSchema,
    publishedTitle: publicPublicationSummarySchema.shape.publishedTitle,
    url: z.string().startsWith('/p/'),
    breadcrumb: z.array(publicSearchBreadcrumbSchema).max(100),
    snippet: z.string().max(PUBLIC_SEARCH_SNIPPET_MAX_LENGTH),
  })
  .strict();

export const publicSearchResponseSchema = z
  .object({ results: z.array(publicSearchResultSchema).max(PUBLIC_SEARCH_MAX_RESULTS) })
  .strict();

export type PublicSearchResult = z.infer<typeof publicSearchResultSchema>;
export type PublicSearchResponse = z.infer<typeof publicSearchResponseSchema>;

export function publicSearchUrl(publicId: string) {
  return `/p/${encodeURIComponent(publicId)}`;
}

export { buildFtsMatchQuery, normalizeSearchQuery };
