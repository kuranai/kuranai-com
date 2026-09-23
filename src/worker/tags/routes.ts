import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import {
  createTagRequestSchema,
  tagIdSchema,
  updatePageFavoriteRequestSchema,
  updatePageTagsRequestSchema,
  updateTagRequestSchema,
} from '../../shared/tags';
import { apiError } from '../middleware/security';
import type { WorkerApp } from '../types';
import { PageError } from '../pages/errors';
import { PageRepository } from '../pages/repository';
import { PageService } from '../pages/service';
import { TagError } from './errors';
import { TagRepository } from './repository';
import { TagService } from './service';

const MAX_TAG_REQUEST_BYTES = 64_000;

function validationDetails(error: z.ZodError) {
  return {
    issues: error.issues.slice(0, 8).map((issue) => ({
      message: issue.message,
      path: issue.path.join('.'),
    })),
  };
}

function idParam(context: Context<WorkerApp>, name: string) {
  const parsed = tagIdSchema.safeParse(context.req.param(name));
  if (!parsed.success) throw new TagError(400, 'INVALID_REQUEST', 'The tag id is invalid.');
  return parsed.data;
}

async function parseJsonBody<T>(context: Context<WorkerApp>, schema: z.ZodType<T>) {
  const contentLength = context.req.header('Content-Length');
  if (
    contentLength !== undefined &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_TAG_REQUEST_BYTES)
  ) {
    throw new TagError(413, 'REQUEST_TOO_LARGE', 'The tag request is too large.');
  }

  let value: unknown;
  try {
    const body = await context.req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_TAG_REQUEST_BYTES) {
      throw new TagError(413, 'REQUEST_TOO_LARGE', 'The tag request is too large.');
    }
    value = JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof TagError) throw error;
    throw new TagError(400, 'INVALID_REQUEST', 'The request body must be valid JSON.');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TagError(
      400,
      'INVALID_REQUEST',
      'The request body is invalid.',
      validationDetails(parsed.error),
    );
  }
  return parsed.data;
}

async function withTagErrors(
  context: Context<WorkerApp>,
  operation: (tags: TagService) => Promise<Response>,
) {
  try {
    return await operation(new TagService(new TagRepository(context.env.DB)));
  } catch (error) {
    if (error instanceof TagError || error instanceof PageError) {
      return apiError(context, error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}

export function registerTagRoutes(app: Hono<WorkerApp>) {
  app.get('/api/private/tags', (context) =>
    withTagErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      return context.json({ tags: await service.list() });
    }),
  );

  app.post('/api/private/tags', (context) =>
    withTagErrors(context, async (service) => {
      const tag = await service.create(await parseJsonBody(context, createTagRequestSchema));
      return context.json({ tag }, 201);
    }),
  );

  app.patch('/api/private/tags/:tagId', (context) =>
    withTagErrors(context, async (service) => {
      const tag = await service.update(
        idParam(context, 'tagId'),
        await parseJsonBody(context, updateTagRequestSchema),
      );
      return context.json({ tag });
    }),
  );

  app.delete('/api/private/tags/:tagId', (context) =>
    withTagErrors(context, async (service) =>
      context.json(await service.delete(idParam(context, 'tagId'))),
    ),
  );

  app.put('/api/private/pages/:id/tags', (context) =>
    withTagErrors(context, async () => {
      const input = await parseJsonBody(context, updatePageTagsRequestSchema);
      const pageService = new PageService(new PageRepository(context.env.DB));
      const page = await pageService.updateTags(idParamForPage(context), input.tagIds);
      return context.json({ page });
    }),
  );

  app.put('/api/private/pages/:id/favorite', (context) =>
    withTagErrors(context, async () => {
      const input = await parseJsonBody(context, updatePageFavoriteRequestSchema);
      const pageService = new PageService(new PageRepository(context.env.DB));
      const page = await pageService.updateFavorite(idParamForPage(context), input.isFavorite);
      return context.json({ page });
    }),
  );
}

function idParamForPage(context: Context<WorkerApp>) {
  const id = context.req.param('id');
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    throw new PageError(400, 'INVALID_REQUEST', 'The page id is invalid.');
  }
  return parsed.data;
}
