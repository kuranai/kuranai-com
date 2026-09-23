import { z } from 'zod';

import { pageIdSchema, pageSlugSchema, pageTitleSchema } from './pages';
import { tagSummarySchema, type TagSummary } from './tags';

export const SEARCH_QUERY_MAX_LENGTH = 200;
export const SEARCH_MAX_TOKENS = 12;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_RESULTS = 50;
export const SEARCH_SNIPPET_MAX_TOKENS = 18;

export interface SearchRequest {
  query: string;
  limit: number;
  favorite?: boolean;
  tagId?: string;
  tagName?: string;
}

export const searchBreadcrumbSchema = z
  .object({
    id: pageIdSchema,
    title: pageTitleSchema,
    slug: pageSlugSchema,
    url: z.string().startsWith('/app/pages/'),
  })
  .strict();

export const searchResultSchema = z
  .object({
    id: pageIdSchema,
    title: pageTitleSchema,
    slug: pageSlugSchema,
    url: z.string().startsWith('/app/pages/'),
    breadcrumb: z.array(searchBreadcrumbSchema).max(100),
    isFavorite: z.boolean().default(false),
    snippet: z.string().max(20_000),
    tags: z.array(tagSummarySchema).max(50).default([]),
  })
  .strict();

export const searchResponseSchema = z
  .object({ results: z.array(searchResultSchema).max(SEARCH_MAX_RESULTS) })
  .strict();

export type SearchBreadcrumb = z.infer<typeof searchBreadcrumbSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export type SearchTag = TagSummary;

function normalizeWhitespace(value: string) {
  const withoutControls = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : character;
    })
    .join('');

  return withoutControls.replace(/\s+/gu, ' ').trim();
}

export function normalizeSearchQuery(query: string) {
  const normalized = normalizeWhitespace(query.normalize('NFKC'));
  return normalizeWhitespace(Array.from(normalized).slice(0, SEARCH_QUERY_MAX_LENGTH).join(''));
}

export function tokenizeSearchQuery(query: string) {
  return normalizeSearchQuery(query).split(' ').filter(Boolean).slice(0, SEARCH_MAX_TOKENS);
}

export function escapeFtsToken(token: string) {
  return token.replaceAll('"', '""');
}

function isSearchableToken(token: string) {
  return /[\p{L}\p{N}_]/u.test(token);
}

/**
 * Converts user input into a quoted FTS5 expression. Every token stays inside
 * a quoted phrase, so FTS5 operators supplied by a user are never evaluated.
 */
export function buildFtsMatchQuery(query: string) {
  const tokens = tokenizeSearchQuery(query).filter(isSearchableToken);
  return tokens
    .map((token, index) => {
      const prefix = index === tokens.length - 1 ? '*' : '';
      return `"${escapeFtsToken(token)}"${prefix}`;
    })
    .join(' ');
}

export function pageSearchUrl(pageId: string) {
  return `/app/pages/${encodeURIComponent(pageId)}`;
}

export interface SearchSnippetSegment {
  text: string;
  highlighted: boolean;
}

/** Parses the marker form returned by SQLite's snippet() without rendering HTML. */
export function parseSearchSnippet(snippet: string): SearchSnippetSegment[] {
  const segments: SearchSnippetSegment[] = [];
  const markerPattern = /(<mark>|<\/mark>)/gu;
  let highlighted = false;
  let cursor = 0;

  for (const match of snippet.matchAll(markerPattern)) {
    const index = match.index ?? cursor;
    if (index > cursor) {
      segments.push({ text: snippet.slice(cursor, index), highlighted });
    }

    highlighted = match[0] === '<mark>';
    cursor = index + match[0].length;
  }

  if (cursor < snippet.length) {
    segments.push({ text: snippet.slice(cursor), highlighted });
  }

  return segments;
}
