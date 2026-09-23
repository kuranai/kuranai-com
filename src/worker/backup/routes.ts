import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import {
  restoreSessionCreateRequestSchema,
  type RestoreSessionCreateRequest,
} from '../../shared/backup';
import { pageIdSchema } from '../../shared/pages';
import { apiError } from '../middleware/security';
import type { WorkerApp } from '../types';
import { BackupError } from './errors';
import { BackupService } from './service';

function invalidRequest(error: z.ZodError) {
  return {
    issues: error.issues.slice(0, 8).map((issue) => ({
      message: issue.message,
      path: issue.path.join('.'),
    })),
  };
}

async function parseCreateBody(context: Context<WorkerApp>) {
  let value: unknown;
  try {
    const body = await context.req.text();
    if (new TextEncoder().encode(body).byteLength > 32_000) {
      throw new BackupError(413, 'INVALID_REQUEST', 'The restore session request is too large.');
    }
    value = JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof BackupError) {
      throw error;
    }
    throw new BackupError(400, 'INVALID_REQUEST', 'The request body must be valid JSON.');
  }

  const parsed = restoreSessionCreateRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new BackupError(
      400,
      'INVALID_REQUEST',
      'The restore session request is invalid.',
      invalidRequest(parsed.error),
    );
  }
  return parsed.data satisfies RestoreSessionCreateRequest;
}

function idParam(context: Context<WorkerApp>, name: string) {
  const parsed = pageIdSchema.safeParse(context.req.param(name));
  if (!parsed.success) {
    throw new BackupError(400, 'INVALID_REQUEST', 'The restore identifier is invalid.');
  }
  return parsed.data;
}

async function withBackupErrors(
  context: Context<WorkerApp>,
  operation: (service: BackupService) => Promise<Response>,
) {
  try {
    return await operation(new BackupService(context.env.DB, context.env.ASSETS));
  } catch (error) {
    if (error instanceof BackupError) {
      return apiError(context, error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}

export function registerBackupRoutes(app: Hono<WorkerApp>) {
  app.get('/api/private/backup', (context) =>
    withBackupErrors(context, async (service) => {
      const archive = await service.prepareBackup();
      return new Response(archive.body, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${archive.filename}"`,
          'Content-Type': 'application/zip',
          'X-Content-Type-Options': 'nosniff',
        },
        status: 200,
      });
    }),
  );

  app.post('/api/private/restore/sessions', (context) =>
    withBackupErrors(context, async (service) => {
      const input = await parseCreateBody(context);
      const session = await service.createSession(input, context.get('identity'));
      return context.json({ session }, 201);
    }),
  );

  app.get('/api/private/restore/sessions/:id', (context) =>
    withBackupErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      const session = await service.getSession(idParam(context, 'id'), context.get('identity'));
      return context.json({ session });
    }),
  );

  app.put('/api/private/restore/sessions/:id/records/:recordType/:recordId', (context) =>
    withBackupErrors(context, async (service) => {
      const result = await service.putRecord(
        idParam(context, 'id'),
        context.req.param('recordType'),
        idParam(context, 'recordId'),
        context.req.raw,
        context.get('identity'),
      );
      return context.json(result);
    }),
  );

  app.put('/api/private/restore/sessions/:id/assets/:assetId', (context) =>
    withBackupErrors(context, async (service) => {
      const result = await service.putAsset(
        idParam(context, 'id'),
        idParam(context, 'assetId'),
        context.req.raw,
        context.get('identity'),
      );
      return context.json(result);
    }),
  );

  app.post('/api/private/restore/sessions/:id/finalize', (context) =>
    withBackupErrors(context, async (service) => {
      const result = await service.finalize(idParam(context, 'id'), context.get('identity'));
      return context.json(result);
    }),
  );

  app.delete('/api/private/restore/sessions/:id', (context) =>
    withBackupErrors(context, async (service) => {
      const result = await service.abort(idParam(context, 'id'), context.get('identity'));
      return context.json(result);
    }),
  );
}
