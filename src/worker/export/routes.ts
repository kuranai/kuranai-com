import { Hono } from 'hono';
import type { Context } from 'hono';

import { apiError } from '../middleware/security';
import type { WorkerApp } from '../types';
import { ExportError } from './errors';
import { ExportService } from './service';

async function withExportErrors(
  context: Context<WorkerApp>,
  operation: (service: ExportService) => Promise<Response>,
) {
  try {
    return await operation(new ExportService(context.env.DB, context.env.ASSETS));
  } catch (error) {
    if (error instanceof ExportError) {
      return apiError(context, error.status, error.code, error.message);
    }
    throw error;
  }
}

export function registerExportRoutes(app: Hono<WorkerApp>) {
  app.get('/api/private/export', (context) =>
    withExportErrors(context, async (service) => {
      const archive = await service.prepare();
      return new Response(archive.body, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${archive.filename}"`,
          'Content-Type': 'application/zip',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }),
  );
}
