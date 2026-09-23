import { Hono } from 'hono';
import type { Context } from 'hono';

import { apiError } from '../middleware/security';
import type { WorkerApp } from '../types';
import { AssetError } from './errors';
import { AssetService } from './service';

async function withAssetErrors(
  context: Context<WorkerApp>,
  operation: (service: AssetService) => Promise<Response>,
) {
  try {
    return await operation(new AssetService(context.env.DB, context.env.ASSETS));
  } catch (error) {
    if (error instanceof AssetError) {
      if (error.status === 416 && typeof error.details?.contentRange === 'string') {
        context.header('Content-Range', error.details.contentRange);
      }
      return apiError(context, error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}

function assetId(context: Context<WorkerApp>) {
  return context.req.param('id') ?? '';
}

export function registerAssetRoutes(app: Hono<WorkerApp>) {
  app.post('/api/private/assets', (context) =>
    withAssetErrors(context, async (service) => {
      const asset = await service.upload(context.req.raw);
      return context.json({ asset }, 201);
    }),
  );

  app.get('/api/private/assets/:id', (context) =>
    withAssetErrors(context, async (service) => {
      const asset = await service.getMetadata(assetId(context));
      return context.json({ asset });
    }),
  );

  app.on(['GET', 'HEAD'], '/api/private/assets/:id/content', (context) =>
    withAssetErrors(context, (service) => service.content(assetId(context), context.req.raw)),
  );

  app.delete('/api/private/assets/:id', (context) =>
    withAssetErrors(context, async (service) => {
      const asset = await service.delete(assetId(context));
      return context.json({ asset });
    }),
  );
}
