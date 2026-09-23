import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_RESULTS,
  normalizeSearchQuery,
  type SearchRequest,
} from '../../shared/search';
import { tagIdSchema, tagNameInputSchema } from '../../shared/tags';
import { apiError } from '../middleware/security';
import type { WorkerApp } from '../types';
import { SearchError } from './errors';
import { SearchRepository } from './repository';
import { SearchService } from './service';

function parseLimit(value: string | undefined) {
  if (value === undefined) {
    return SEARCH_DEFAULT_LIMIT;
  }

  if (!/^[0-9]+$/u.test(value)) {
    throw new SearchError(400, 'INVALID_REQUEST', 'The search limit must be a positive integer.');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new SearchError(400, 'INVALID_REQUEST', 'The search limit must be a positive integer.');
  }

  return Math.min(parsed, SEARCH_MAX_RESULTS);
}

function parseSearchRequest(context: Context<WorkerApp>): SearchRequest {
  const rawFavorite = context.req.query('favorite');
  let favorite: boolean | undefined;
  if (rawFavorite !== undefined) {
    if (rawFavorite === 'true' || rawFavorite === '1') favorite = true;
    else if (rawFavorite === 'false' || rawFavorite === '0') favorite = false;
    else throw new SearchError(400, 'INVALID_REQUEST', 'The favorite filter is invalid.');
  }

  const tagId = context.req.query('tagId');
  const tagName = context.req.query('tag');
  if (tagId !== undefined && tagName !== undefined) {
    throw new SearchError(400, 'INVALID_REQUEST', 'Use either tagId or tag, not both.');
  }
  if (tagId !== undefined && !tagIdSchema.safeParse(tagId).success) {
    throw new SearchError(400, 'INVALID_REQUEST', 'The tag filter is invalid.');
  }

  let normalizedTagName: string | undefined;
  if (tagName !== undefined) {
    const parsedTagName = tagNameInputSchema.safeParse(tagName);
    if (!parsedTagName.success) {
      throw new SearchError(400, 'INVALID_REQUEST', 'The tag filter is invalid.');
    }
    normalizedTagName = parsedTagName.data;
  }

  return {
    favorite,
    query: normalizeSearchQuery(context.req.query('q') ?? ''),
    limit: parseLimit(context.req.query('limit')),
    tagId,
    tagName: normalizedTagName,
  };
}

async function withSearchErrors(
  context: Context<WorkerApp>,
  operation: (service: SearchService) => Promise<Response>,
) {
  try {
    return await operation(new SearchService(new SearchRepository(context.env.DB)));
  } catch (error) {
    if (error instanceof SearchError) {
      return apiError(context, error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}

export function registerSearchRoutes(app: Hono<WorkerApp>) {
  app.get('/api/private/search', (context) =>
    withSearchErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      const response = await service.search(parseSearchRequest(context));
      return context.json(response);
    }),
  );
}
