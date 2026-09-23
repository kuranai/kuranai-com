import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import { pageIdSchema } from '../../shared/pages';
import {
  PUBLICATION_DEFAULT_LIMIT,
  PUBLICATION_MAX_LIMIT,
  publicationCursorSchema,
  publicIdSchema,
  publishPublicationRequestSchema,
  unpublishPublicationRequestSchema,
} from '../../shared/publications';
import { apiError } from '../middleware/security';
import type { WorkerApp } from '../types';
import { PublicationError } from './errors';
import { servePublicAsset } from './asset-content';
import { decodePublicationCursor, PublicationService } from './service';
import { publicHtmlEtagPart, servePublicHtml } from './public-html';

function validationDetails(error: z.ZodError) {
  return {
    issues: error.issues.slice(0, 8).map((issue) => ({
      message: issue.message,
      path: issue.path.join('.'),
    })),
  };
}

function pageId(context: Context<WorkerApp>, name: string) {
  const parsed = pageIdSchema.safeParse(context.req.param(name));
  if (!parsed.success)
    throw new PublicationError(400, 'INVALID_REQUEST', 'The page id is invalid.');
  return parsed.data;
}

function publicId(context: Context<WorkerApp>, name: string) {
  const parsed = publicIdSchema.safeParse(context.req.param(name));
  if (!parsed.success)
    throw new PublicationError(404, 'PUBLICATION_NOT_FOUND', 'Publication not found.');
  return parsed.data;
}

async function parseJsonBody<T>(context: Context<WorkerApp>, schema: z.ZodType<T>) {
  const length = context.req.header('Content-Length');
  if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > 64_000)) {
    throw new PublicationError(413, 'REQUEST_TOO_LARGE', 'The publication request is too large.');
  }

  let value: unknown;
  try {
    const body = await context.req.text();
    if (new TextEncoder().encode(body).byteLength > 64_000) {
      throw new PublicationError(413, 'REQUEST_TOO_LARGE', 'The publication request is too large.');
    }
    value = JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof PublicationError) throw error;
    throw new PublicationError(400, 'INVALID_REQUEST', 'The publication request is invalid.');
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PublicationError(
      400,
      'INVALID_REQUEST',
      'The publication request is invalid.',
      validationDetails(parsed.error),
    );
  }
  return parsed.data;
}

function listRequest(context: Context<WorkerApp>) {
  const rawLimit = context.req.query('limit');
  if (rawLimit !== undefined && !/^\d+$/u.test(rawLimit)) {
    throw new PublicationError(400, 'INVALID_REQUEST', 'The publication list limit is invalid.');
  }
  const parsedLimit = rawLimit === undefined ? PUBLICATION_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1) {
    throw new PublicationError(400, 'INVALID_REQUEST', 'The publication list limit is invalid.');
  }

  const rawCursor = context.req.query('cursor');
  if (rawCursor === undefined) {
    return { cursor: null, limit: Math.min(parsedLimit, PUBLICATION_MAX_LIMIT) };
  }
  if (!publicationCursorSchema.safeParse(rawCursor).success) {
    throw new PublicationError(400, 'INVALID_REQUEST', 'The publication list cursor is invalid.');
  }
  const cursor = decodePublicationCursor(rawCursor);
  if (cursor === null) {
    throw new PublicationError(400, 'INVALID_REQUEST', 'The publication list cursor is invalid.');
  }
  return { cursor, limit: Math.min(parsedLimit, PUBLICATION_MAX_LIMIT) };
}

async function withPublicationErrors(
  context: Context<WorkerApp>,
  operation: (service: PublicationService) => Promise<Response>,
) {
  try {
    return await operation(new PublicationService(context.env.DB));
  } catch (error) {
    if (error instanceof PublicationError) {
      return apiError(context, error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}

const PUBLIC_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

function publicEtag(value: string) {
  return `"dovari-public-${publicHtmlEtagPart(value)}"`;
}

function setPublicCache(context: Context<WorkerApp>, value: string) {
  const etag = publicEtag(value);
  context.header('Cache-Control', PUBLIC_CACHE_CONTROL);
  context.header('ETag', etag);
  return etag;
}

function publicNotModified(context: Context<WorkerApp>, etag: string) {
  const header = context.req.header('If-None-Match');
  if (
    header
      ?.split(',')
      .map((value) => value.trim().replace(/^W\//iu, ''))
      .some((value) => value === '*' || value === etag)
  ) {
    return context.body(null, 304);
  }
  return null;
}

function xmlEscape(value: string) {
  return value.replace(/[&"'<>]/gu, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      case '<':
        return '&lt;';
      default:
        return '&gt;';
    }
  });
}

function publicOrigin(context: Context<WorkerApp>) {
  return new URL(context.req.url).origin;
}

async function publicHtmlForRoot(context: Context<WorkerApp>) {
  const service = new PublicationService(context.env.DB);
  const publications = await service.listAllPublic();
  return servePublicHtml(context.req.raw, context.env.STATIC_ASSETS, {
    allowIndexing: false,
    canonicalUrl: `${publicOrigin(context)}/`,
    description: 'Browse the pages this Dovari knowledge base has chosen to publish.',
    etag: `landing:${JSON.stringify(publications)}`,
    title: 'Public knowledge base',
  });
}

async function publicHtmlForPage(context: Context<WorkerApp>) {
  const rawPublicId = context.req.param('publicId');
  const parsedPublicId = publicIdSchema.safeParse(rawPublicId);
  const origin = publicOrigin(context);
  if (!parsedPublicId.success) {
    return servePublicHtml(context.req.raw, context.env.STATIC_ASSETS, {
      allowIndexing: false,
      canonicalUrl: `${origin}/p/`,
      description: 'This public Dovari page is not available.',
      etag: 'not-found:invalid',
      title: 'Public page unavailable',
    });
  }

  const service = new PublicationService(context.env.DB);
  try {
    const metadata = await service.getPublicMetadata(parsedPublicId.data);
    return servePublicHtml(context.req.raw, context.env.STATIC_ASSETS, {
      allowIndexing: metadata.allowIndexing,
      canonicalUrl: `${origin}/p/${encodeURIComponent(metadata.publicId)}`,
      description: metadata.description,
      etag: `${metadata.publicId}:${metadata.updatedAt}`,
      title: metadata.title,
    });
  } catch (error) {
    if (!(error instanceof PublicationError) || error.code !== 'PUBLICATION_NOT_FOUND') {
      throw error;
    }
    return servePublicHtml(context.req.raw, context.env.STATIC_ASSETS, {
      allowIndexing: false,
      canonicalUrl: `${origin}/p/${encodeURIComponent(parsedPublicId.data)}`,
      description: 'This public Dovari page is no longer available.',
      etag: `not-found:${parsedPublicId.data}`,
      title: 'Public page unavailable',
    });
  }
}

export function registerPublicationRoutes(app: Hono<WorkerApp>) {
  app.on(['GET', 'HEAD'], '/', (context) => publicHtmlForRoot(context));

  app.on(['GET', 'HEAD'], '/p/:publicId', (context) => publicHtmlForPage(context));

  app.on(['GET', 'HEAD'], '/robots.txt', (context) =>
    withPublicationErrors(context, async (service) => {
      const publications = (await service.listAllPublic()).filter(
        (publication) => publication.allowIndexing,
      );
      const body = [
        'User-agent: *',
        'Disallow: /',
        ...publications.map(
          (publication) => `Allow: /p/${encodeURIComponent(publication.publicId)}`,
        ),
        `Sitemap: ${publicOrigin(context)}/sitemap.xml`,
        '',
      ].join('\n');
      const etag = setPublicCache(context, `robots:${body}`);
      const notModified = publicNotModified(context, etag);
      if (notModified) return notModified;
      context.header('Content-Type', 'text/plain; charset=UTF-8');
      return context.body(body);
    }),
  );

  app.on(['GET', 'HEAD'], '/sitemap.xml', (context) =>
    withPublicationErrors(context, async (service) => {
      const publications = (await service.listAllPublic()).filter(
        (publication) => publication.allowIndexing,
      );
      const origin = publicOrigin(context);
      const body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...publications.map(
          (publication) =>
            `  <url><loc>${xmlEscape(`${origin}/p/${encodeURIComponent(publication.publicId)}`)}</loc><lastmod>${xmlEscape(publication.updatedAt)}</lastmod></url>`,
        ),
        '</urlset>',
        '',
      ].join('\n');
      const etag = setPublicCache(context, `sitemap:${body}`);
      const notModified = publicNotModified(context, etag);
      if (notModified) return notModified;
      context.header('Content-Type', 'application/xml; charset=UTF-8');
      return context.body(body);
    }),
  );

  app.get('/api/private/pages/:pageId/publication', (context) =>
    withPublicationErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      return context.json(await service.getForPage(pageId(context, 'pageId')));
    }),
  );

  app.put('/api/private/pages/:pageId/publication', (context) =>
    withPublicationErrors(context, async (service) => {
      const input = await parseJsonBody(context, publishPublicationRequestSchema);
      return context.json(await service.publish(pageId(context, 'pageId'), input));
    }),
  );

  app.delete('/api/private/pages/:pageId/publication', (context) =>
    withPublicationErrors(context, async (service) => {
      const input = await parseJsonBody(context, unpublishPublicationRequestSchema);
      return context.json(await service.unpublish(pageId(context, 'pageId'), input));
    }),
  );

  app.get('/api/private/publications/:publicId/editor-target', (context) =>
    withPublicationErrors(context, async (service) => {
      context.header('Cache-Control', 'no-store');
      return context.json(await service.resolveEditorTarget(publicId(context, 'publicId')));
    }),
  );

  app.on(['GET', 'HEAD'], '/api/public/publications', (context) =>
    withPublicationErrors(context, async (service) => {
      const input = listRequest(context);
      const response = await service.listPublic(input.cursor, input.limit);
      const etag = setPublicCache(context, JSON.stringify(response));
      const notModified = publicNotModified(context, etag);
      return notModified ?? context.json(response);
    }),
  );

  app.on(['GET', 'HEAD'], '/api/public/publications/:publicId', (context) =>
    withPublicationErrors(context, async (service) => {
      const response = await service.getPublic(publicId(context, 'publicId'));
      const etag = setPublicCache(context, JSON.stringify(response.publication));
      const notModified = publicNotModified(context, etag);
      return notModified ?? context.json(response);
    }),
  );

  app.on(['GET', 'HEAD'], '/api/public/publications/:publicId/assets/:assetId/content', (context) =>
    withPublicationErrors(context, async (service) => {
      const publication = publicId(context, 'publicId');
      const asset = publicId(context, 'assetId');
      try {
        const record = await service.publicAsset(publication, asset);
        return await servePublicAsset(record, context.env.ASSETS, context.req.raw);
      } catch (error) {
        if (error instanceof PublicationError) throw error;
        if (error instanceof Error && 'status' in error) {
          const assetError = error as {
            status?: number;
            code?: string;
            details?: Record<string, unknown>;
          };
          if (assetError.status === 416) {
            if (typeof assetError.details?.contentRange === 'string') {
              context.header('Content-Range', assetError.details.contentRange);
            }
            return apiError(
              context,
              416,
              'PUBLICATION_ASSET_RANGE_INVALID',
              'The requested byte range is invalid.',
            );
          }
        }
        throw publicationNotFoundError();
      }
    }),
  );
}

function publicationNotFoundError() {
  return new PublicationError(404, 'PUBLICATION_NOT_FOUND', 'Publication not found.');
}
