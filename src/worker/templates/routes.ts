import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import {
  createPageFromTemplateRequestSchema,
  createTemplateRequestSchema,
  dailyNoteRequestSchema,
  deleteTemplateRequestSchema,
  localDateSchema,
  updateTemplateRequestSchema,
} from '../../shared/templates';
import { MAX_PAGE_REQUEST_BYTES, pageIdSchema } from '../../shared/pages';
import { apiError } from '../middleware/security';
import { PageError } from '../pages/errors';
import { PublicationService } from '../publications/service';
import type { WorkerApp } from '../types';
import { TemplateError } from './errors';
import { TemplateRepository } from './repository';
import { TemplateService } from './service';

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
  return !Number.isFinite(bytes) || bytes > MAX_PAGE_REQUEST_BYTES;
}

async function parseJsonBody<T>(context: Context<WorkerApp>, schema: z.ZodType<T>) {
  if (requestBodyTooLarge(context)) {
    throw new TemplateError(413, 'REQUEST_TOO_LARGE', 'The template request is too large.');
  }

  let value: unknown;
  try {
    const body = await context.req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_PAGE_REQUEST_BYTES) {
      throw new TemplateError(413, 'REQUEST_TOO_LARGE', 'The template request is too large.');
    }
    value = JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof TemplateError) throw error;
    throw new TemplateError(400, 'INVALID_REQUEST', 'The request body must be valid JSON.');
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TemplateError(
      400,
      'INVALID_REQUEST',
      'The request body is invalid.',
      validationDetails(parsed.error),
    );
  }
  return parsed.data;
}

function templateId(context: Context<WorkerApp>) {
  const parsed = pageIdSchema.safeParse(context.req.param('templateId'));
  if (!parsed.success) {
    throw new TemplateError(400, 'INVALID_REQUEST', 'The template id is invalid.');
  }
  return parsed.data;
}

function localDate(context: Context<WorkerApp>) {
  const parsed = localDateSchema.safeParse(context.req.param('localDate'));
  if (!parsed.success) {
    throw new TemplateError(400, 'INVALID_REQUEST', 'The daily note date is invalid.');
  }
  return parsed.data;
}

async function withTemplateErrors(
  context: Context<WorkerApp>,
  operation: (service: TemplateService) => Promise<Response>,
) {
  try {
    return await operation(new TemplateService(new TemplateRepository(context.env.DB)));
  } catch (error) {
    if (error instanceof TemplateError || error instanceof PageError) {
      return apiError(context, error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}

export function registerTemplateRoutes(app: Hono<WorkerApp>) {
  app.get('/api/private/templates', (context) =>
    withTemplateErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      return context.json({ templates: await service.list() });
    }),
  );

  app.post('/api/private/templates', (context) =>
    withTemplateErrors(context, async (service) => {
      const template = await service.create(
        await parseJsonBody(context, createTemplateRequestSchema),
      );
      return context.json({ template }, 201);
    }),
  );

  app.get('/api/private/templates/:templateId', (context) =>
    withTemplateErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      return context.json({ template: await service.get(templateId(context)) });
    }),
  );

  app.patch('/api/private/templates/:templateId', (context) =>
    withTemplateErrors(context, async (service) => {
      const template = await service.update(
        templateId(context),
        await parseJsonBody(context, updateTemplateRequestSchema),
      );
      return context.json({ template });
    }),
  );

  app.delete('/api/private/templates/:templateId', (context) =>
    withTemplateErrors(context, async (service) => {
      const input = await parseJsonBody(context, deleteTemplateRequestSchema);
      return context.json(await service.delete(templateId(context), input.baseRevision));
    }),
  );

  app.post('/api/private/pages/from-template', (context) =>
    withTemplateErrors(context, async (service) => {
      const page = await service.createPageFromTemplate(
        await parseJsonBody(context, createPageFromTemplateRequestSchema),
      );
      await new PublicationService(context.env.DB).inheritPublication(page.id, page.revision);
      return context.json({ page }, 201);
    }),
  );

  app.put('/api/private/daily-notes/:localDate', (context) =>
    withTemplateErrors(context, async (service) => {
      const date = localDate(context);
      const input = await parseJsonBody(context, dailyNoteRequestSchema);
      if (input.localDate !== undefined && input.localDate !== date) {
        throw new TemplateError(
          422,
          'DAILY_NOTE_DATE_MISMATCH',
          'The daily note date does not match the URL.',
          { localDate: date },
        );
      }
      return context.json(await service.openDailyNote({ ...input, localDate: date }));
    }),
  );
}
