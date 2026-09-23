import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  PUBLIC_SEARCH_DEFAULT_LIMIT,
  PUBLIC_SEARCH_MAX_RESULTS,
  normalizeSearchQuery,
} from '../../shared/public-search';
import { apiError } from '../middleware/security';
import { PublicationRepository } from '../publications/repository';
import type { WorkerApp } from '../types';
import { SearchError } from '../search/errors';
import { publicHtmlEtagPart } from '../publications/public-html';
import { PublicSearchRepository } from './repository';
import { PublicSearchService } from './service';

function parseLimit(value: string | undefined) {
  if (value === undefined) return PUBLIC_SEARCH_DEFAULT_LIMIT;
  if (!/^[0-9]+$/u.test(value)) {
    throw new SearchError(400, 'INVALID_REQUEST', 'The public search limit is invalid.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new SearchError(400, 'INVALID_REQUEST', 'The public search limit is invalid.');
  }
  return Math.min(parsed, PUBLIC_SEARCH_MAX_RESULTS);
}

function parseRequest(context: Context<WorkerApp>) {
  return {
    limit: parseLimit(context.req.query('limit')),
    query: normalizeSearchQuery(context.req.query('q') ?? ''),
  };
}

export function registerPublicSearchRoutes(app: Hono<WorkerApp>) {
  app.on(['GET', 'HEAD'], '/api/public/search', async (context) => {
    try {
      const service = new PublicSearchService(
        new PublicSearchRepository(context.env.DB),
        new PublicationRepository(context.env.DB),
      );
      context.header('Cache-Control', 'public, max-age=0, must-revalidate');
      const response = await service.search(parseRequest(context));
      const etag = `"dovari-public-search-${publicHtmlEtagPart(JSON.stringify(response))}"`;
      context.header('ETag', etag);
      const ifNoneMatch = context.req.header('If-None-Match');
      if (
        ifNoneMatch
          ?.split(',')
          .map((value) => value.trim().replace(/^W\//iu, ''))
          .some((value) => value === '*' || value === etag)
      ) {
        return context.body(null, 304);
      }
      return context.json(response);
    } catch (error) {
      if (error instanceof SearchError) {
        return apiError(context, error.status, error.code, error.message, error.details);
      }
      throw error;
    }
  });
}
