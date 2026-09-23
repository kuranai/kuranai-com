import { Hono } from 'hono';

import {
  authMiddleware,
  apiError,
  requestIdMiddleware,
  securityHeadersMiddleware,
} from './middleware/security';
import { registerAuthRoutes } from './auth/routes';
import { classifyPath, isApiPath } from './routing';
import { registerAssetRoutes } from './assets/routes';
import { registerBackupRoutes } from './backup/routes';
import { registerExportRoutes } from './export/routes';
import { registerPageRoutes } from './pages/routes';
import { registerSearchRoutes } from './search/routes';
import { registerPublicSearchRoutes } from './public-search/routes';
import { registerPublicationRoutes } from './publications/routes';
import { registerTagRoutes } from './tags/routes';
import { registerTemplateRoutes } from './templates/routes';
import type { WorkerApp } from './types';

async function checkBindings(env: WorkerApp['Bindings']) {
  await Promise.all([
    env.DB.prepare('SELECT 1').first(),
    env.ASSETS.head('__dovari_binding_probe__'),
  ]);
}

function fetchStaticAssets(request: Request, assets: Fetcher) {
  const headers = new Headers(request.headers);
  headers.delete('Authorization');
  headers.delete('Cookie');

  return assets.fetch(new Request(request, { headers }));
}

export function createApp() {
  const app = new Hono<WorkerApp>();

  app.use('*', requestIdMiddleware);
  app.use('*', securityHeadersMiddleware);
  app.use('*', authMiddleware);

  app.on(['GET', 'HEAD'], '/api/health', async (c) => {
    try {
      await checkBindings(c.env);
      return c.json({ status: 'ok' });
    } catch {
      return apiError(c, 503, 'HEALTH_UNAVAILABLE', 'Service unavailable.');
    }
  });

  registerAuthRoutes(app);
  registerPageRoutes(app);
  registerTemplateRoutes(app);
  registerAssetRoutes(app);
  registerBackupRoutes(app);
  registerExportRoutes(app);
  registerSearchRoutes(app);
  registerTagRoutes(app);
  registerPublicSearchRoutes(app);
  registerPublicationRoutes(app);

  app.all('*', async (c) => {
    const pathname = new URL(c.req.url).pathname;
    const classification = classifyPath(pathname);

    if (
      (classification.kind === 'private' && classification.area === 'app') ||
      (classification.kind === 'auth' && classification.area === 'app')
    ) {
      return fetchStaticAssets(c.req.raw, c.env.STATIC_ASSETS);
    }

    if (classification.kind === 'static') {
      return fetchStaticAssets(c.req.raw, c.env.STATIC_ASSETS);
    }

    if (classification.kind === 'public' && classification.area === 'page') {
      if (c.req.method === 'GET' || c.req.method === 'HEAD') {
        return fetchStaticAssets(c.req.raw, c.env.STATIC_ASSETS);
      }
      return apiError(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    }

    if (classification.kind === 'public' && classification.area === 'api') {
      if (c.req.method === 'OPTIONS') {
        c.header('Allow', 'GET, HEAD, OPTIONS');
        return c.body(null, 204);
      }
      if (!['GET', 'HEAD'].includes(c.req.method)) {
        c.header('Allow', 'GET, HEAD');
        return apiError(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }
    }

    if (isApiPath(pathname)) {
      return apiError(c, 404, 'NOT_FOUND', 'Not found.');
    }

    return new Response('Not Found', { status: 404 });
  });

  app.onError((_error, c) => apiError(c, 500, 'INTERNAL_ERROR', 'Internal server error.'));

  return app;
}

const app = createApp();

export { app };
export default app;
