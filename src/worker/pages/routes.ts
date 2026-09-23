import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import {
  createPageRequestSchema,
  deletePageRequestSchema,
  MAX_PAGE_REQUEST_BYTES,
  movePageRequestSchema,
  normalizeWikiLinkTitle,
  PAGE_TITLE_MAX_LENGTH,
  pageIdSchema,
  updatePageContentRequestSchema,
  updatePageRequestSchema,
  WIKI_LINK_SEARCH_DEFAULT_LIMIT,
  WIKI_LINK_SEARCH_MAX_RESULTS,
} from '../../shared/pages';
import {
  RECOVERY_DEFAULT_LIMIT,
  RECOVERY_MAX_LIMIT,
  permanentDeleteRequestSchema,
  restorePageRequestSchema,
} from '../../shared/recovery';
import { tagIdSchema, tagNameInputSchema } from '../../shared/tags';
import { apiError } from '../middleware/security';
import { PublicationService } from '../publications/service';
import type { WorkerApp } from '../types';
import { PageError } from './errors';
import { decodeRecoveryCursor } from './recovery';
import { PageRepository } from './repository';
import { PageService } from './service';

function validationDetails(error: z.ZodError) {
  return {
    issues: error.issues.slice(0, 8).map((issue) => ({
      message: issue.message,
      path: issue.path.join('.'),
    })),
  };
}

function requestBodyTooLarge(context: Context<WorkerApp>) {
  const contentLength = context.req.header('Content-Length');
  if (contentLength === undefined) {
    return false;
  }

  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes > MAX_PAGE_REQUEST_BYTES;
}

async function parseJsonBody<T>(
  context: Context<WorkerApp>,
  schema: z.ZodType<T>,
  invalidCode: 'INVALID_REQUEST' | 'INVALID_DOCUMENT' = 'INVALID_REQUEST',
) {
  if (requestBodyTooLarge(context)) {
    throw new PageError(
      413,
      'PAGE_TOO_LARGE',
      'This page is too large. Split it into smaller pages.',
    );
  }

  let payload: unknown;
  try {
    const body = await context.req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_PAGE_REQUEST_BYTES) {
      throw new PageError(
        413,
        'PAGE_TOO_LARGE',
        'This page is too large. Split it into smaller pages.',
      );
    }
    payload = JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof PageError) {
      throw error;
    }
    throw new PageError(400, 'INVALID_REQUEST', 'The request body must be valid JSON.');
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const isDocumentIssue =
      invalidCode === 'INVALID_DOCUMENT' &&
      typeof payload === 'object' &&
      payload !== null &&
      'content' in payload &&
      parsed.error.issues.some((issue) => issue.path[0] === 'content');
    throw new PageError(
      isDocumentIssue ? 422 : 400,
      isDocumentIssue ? 'INVALID_DOCUMENT' : 'INVALID_REQUEST',
      isDocumentIssue ? 'The page content is invalid.' : 'The request body is invalid.',
      validationDetails(parsed.error),
    );
  }

  return parsed.data;
}

async function parseOptionalDeleteBody(context: Context<WorkerApp>) {
  if (!context.req.raw.body || context.req.header('Content-Length') === '0') {
    return undefined;
  }

  return parseJsonBody(context, deletePageRequestSchema);
}

function pageId(context: Context<WorkerApp>) {
  const id = context.req.param('id');
  const parsed = pageIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new PageError(400, 'INVALID_REQUEST', 'The page id is invalid.');
  }
  return parsed.data;
}

function revisionId(context: Context<WorkerApp>) {
  const id = context.req.param('revisionId');
  const parsed = pageIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new PageError(400, 'INVALID_REQUEST', 'The revision id is invalid.');
  }
  return parsed.data;
}

function parseRecoveryListRequest(context: Context<WorkerApp>) {
  const rawLimit = context.req.query('limit');
  if (rawLimit !== undefined && !/^\d+$/u.test(rawLimit)) {
    throw new PageError(400, 'INVALID_REQUEST', 'The recovery list limit is invalid.');
  }

  const parsedLimit = rawLimit === undefined ? RECOVERY_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1) {
    throw new PageError(400, 'INVALID_REQUEST', 'The recovery list limit is invalid.');
  }

  const rawCursor = context.req.query('cursor');
  if (rawCursor === undefined) {
    return { cursor: null, limit: Math.min(parsedLimit, RECOVERY_MAX_LIMIT) };
  }

  const cursor = decodeRecoveryCursor(rawCursor);
  if (cursor === null) {
    throw new PageError(400, 'INVALID_REQUEST', 'The recovery list cursor is invalid.');
  }

  return { cursor, limit: Math.min(parsedLimit, RECOVERY_MAX_LIMIT) };
}

function parseWikiLinkSearchRequest(context: Context<WorkerApp>) {
  const rawQuery = context.req.query('q') ?? '';
  const containsControlCharacters = [...rawQuery].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (rawQuery.length > PAGE_TITLE_MAX_LENGTH || containsControlCharacters) {
    throw new PageError(400, 'INVALID_REQUEST', 'The wiki-link query is invalid.');
  }

  const rawLimit = context.req.query('limit');
  if (rawLimit !== undefined && !/^\d+$/u.test(rawLimit)) {
    throw new PageError(400, 'INVALID_REQUEST', 'The wiki-link limit is invalid.');
  }

  const parsedLimit = rawLimit === undefined ? WIKI_LINK_SEARCH_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1) {
    throw new PageError(400, 'INVALID_REQUEST', 'The wiki-link limit is invalid.');
  }

  return {
    limit: Math.min(parsedLimit, WIKI_LINK_SEARCH_MAX_RESULTS),
    query: normalizeWikiLinkTitle(rawQuery),
  };
}

function parsePageListRequest(context: Context<WorkerApp>) {
  const rawFavorite = context.req.query('favorite');
  let favorite: boolean | undefined;
  if (rawFavorite !== undefined) {
    if (rawFavorite === 'true' || rawFavorite === '1') favorite = true;
    else if (rawFavorite === 'false' || rawFavorite === '0') favorite = false;
    else throw new PageError(400, 'INVALID_REQUEST', 'The favorite filter is invalid.');
  }

  const tagId = context.req.query('tagId');
  const tagName = context.req.query('tag');
  if (tagId !== undefined && tagName !== undefined) {
    throw new PageError(400, 'INVALID_REQUEST', 'Use either tagId or tag, not both.');
  }
  if (tagId !== undefined && !tagIdSchema.safeParse(tagId).success) {
    throw new PageError(400, 'INVALID_REQUEST', 'The tag filter is invalid.');
  }

  let normalizedTagName: string | undefined;
  if (tagName !== undefined) {
    const parsedTagName = tagNameInputSchema.safeParse(tagName);
    if (!parsedTagName.success) {
      throw new PageError(400, 'INVALID_REQUEST', 'The tag filter is invalid.');
    }
    normalizedTagName = parsedTagName.data;
  }

  return { favorite, tagId, tagName: normalizedTagName };
}

async function withPageErrors(
  context: Context<WorkerApp>,
  operation: (service: PageService) => Promise<Response>,
) {
  try {
    return await operation(new PageService(new PageRepository(context.env.DB)));
  } catch (error) {
    if (error instanceof PageError) {
      return apiError(context, error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}

export function registerPageRoutes(app: Hono<WorkerApp>) {
  app.get('/api/private/wiki-links', (context) =>
    withPageErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      const input = parseWikiLinkSearchRequest(context);
      return context.json({ pages: await service.searchWikiLinks(input.query, input.limit) });
    }),
  );

  app.get('/api/private/trash', (context) =>
    withPageErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      const input = parseRecoveryListRequest(context);
      return context.json(await service.listTrash(input.cursor, input.limit));
    }),
  );

  app.post('/api/private/pages/:id/restore', (context) =>
    withPageErrors(context, async (service) => {
      const input = await parseJsonBody(context, restorePageRequestSchema);
      const page = await service.restoreDeletedPage(pageId(context), input);
      return context.json({ page });
    }),
  );

  app.delete('/api/private/pages/:id/permanent', (context) =>
    withPageErrors(context, async (service) => {
      const input = await parseJsonBody(context, permanentDeleteRequestSchema);
      const result = await service.permanentlyDeletePage(pageId(context), input);
      return context.json(result);
    }),
  );

  app.get('/api/private/pages/:id/revisions', (context) =>
    withPageErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      const input = parseRecoveryListRequest(context);
      return context.json(
        await service.listPageRevisions(pageId(context), input.cursor, input.limit),
      );
    }),
  );

  app.get('/api/private/pages/:id/revisions/:revisionId', (context) =>
    withPageErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      const revision = await service.getPageRevision(pageId(context), revisionId(context));
      return context.json({ revision });
    }),
  );

  app.post('/api/private/pages/:id/revisions/:revisionId/restore', (context) =>
    withPageErrors(context, async (service) => {
      const input = await parseJsonBody(context, restorePageRequestSchema);
      const page = await service.restorePageRevision(pageId(context), revisionId(context), input);
      await new PublicationService(context.env.DB).syncPage(page.id, page.revision);
      return context.json({ page });
    }),
  );

  app.get('/api/private/pages', (context) =>
    withPageErrors(context, async (service) =>
      context.json({ pages: await service.list(parsePageListRequest(context)) }),
    ),
  );

  app.post('/api/private/pages', (context) =>
    withPageErrors(context, async (service) => {
      const input = await parseJsonBody(context, createPageRequestSchema);
      const page = await service.create(input);
      await new PublicationService(context.env.DB).inheritPublication(page.id, page.revision);
      return context.json({ page }, 201);
    }),
  );

  app.get('/api/private/pages/:id', (context) =>
    withPageErrors(context, async (service) => {
      const page = await service.get(pageId(context));
      return context.json({ page });
    }),
  );

  app.get('/api/private/pages/:id/backlinks', (context) =>
    withPageErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      return context.json({ backlinks: await service.backlinks(pageId(context)) });
    }),
  );

  app.patch('/api/private/pages/:id', (context) =>
    withPageErrors(context, async (service) => {
      const input = await parseJsonBody(context, updatePageRequestSchema);
      const page = await service.updateMetadata(pageId(context), input);
      await new PublicationService(context.env.DB).syncPage(page.id, page.revision);
      return context.json({ page });
    }),
  );

  app.put('/api/private/pages/:id/content', (context) =>
    withPageErrors(context, async (service) => {
      const input = await parseJsonBody(
        context,
        updatePageContentRequestSchema,
        'INVALID_DOCUMENT',
      );
      const page = await service.updateContent(pageId(context), input);
      await new PublicationService(context.env.DB).syncPage(page.id, page.revision);
      return context.json({ page });
    }),
  );

  app.post('/api/private/pages/:id/move', (context) =>
    withPageErrors(context, async (service) => {
      const input = await parseJsonBody(context, movePageRequestSchema);
      const page = await service.move(pageId(context), input);
      const publications = new PublicationService(context.env.DB);
      await publications.inheritPublication(page.id, page.revision);
      await publications.syncPage(page.id, page.revision);
      return context.json({ page });
    }),
  );

  app.delete('/api/private/pages/:id', (context) =>
    withPageErrors(context, async (service) => {
      const input = await parseOptionalDeleteBody(context);
      const page = await service.delete(pageId(context), input);
      return context.json({ page });
    }),
  );
}
