import type { Hono } from 'hono';
import { z } from 'zod';

import { apiError } from '../middleware/security';
import type { WorkerApp } from '../types';
import {
  authorizePasswordRequest,
  expiredSessionCookie,
  loginWithPassword,
  logoutPasswordSession,
  sessionCookie,
} from './password';

const MAX_LOGIN_REQUEST_BYTES = 1024;
const loginSchema = z.object({ password: z.string().max(256) }).strict();

function isJsonRequest(request: Request) {
  return /^application\/json(?:\s*;|$)/iu.test(request.headers.get('Content-Type') ?? '');
}

export function registerAuthRoutes(app: Hono<WorkerApp>) {
  app.get('/api/auth/session', async (c) => {
    const authorization = await authorizePasswordRequest(c.req.raw, c.env);
    c.header('Cache-Control', 'no-store');

    if (!authorization.ok) {
      if (authorization.code === 'SETUP_REQUIRED') {
        return apiError(c, 503, authorization.code, authorization.message);
      }
      if (authorization.code === 'AUTH_INVALID') {
        c.header('Set-Cookie', expiredSessionCookie());
      }
      return c.json({ authenticated: false });
    }

    return c.json({
      authenticated: true,
      expiresAt: new Date(authorization.expiresAt).toISOString(),
    });
  });

  app.post('/api/auth/login', async (c) => {
    if (!isJsonRequest(c.req.raw)) {
      return apiError(c, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
    }

    const declaredLength = Number(c.req.header('Content-Length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_LOGIN_REQUEST_BYTES) {
      return apiError(c, 413, 'REQUEST_TOO_LARGE', 'The login request is too large.');
    }

    const body = await c.req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_LOGIN_REQUEST_BYTES) {
      return apiError(c, 413, 'REQUEST_TOO_LARGE', 'The login request is too large.');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch {
      return apiError(c, 400, 'INVALID_REQUEST', 'The login request is invalid.');
    }
    const parsed = loginSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return apiError(c, 400, 'INVALID_REQUEST', 'The login request is invalid.');
    }

    const result = await loginWithPassword(c.req.raw, c.env, parsed.data.password);
    c.header('Cache-Control', 'no-store');
    if (!result.ok) {
      if (result.code === 'SETUP_REQUIRED') {
        return apiError(c, 503, result.code, 'Authentication is not configured.');
      }
      if (result.code === 'AUTH_RATE_LIMITED') {
        c.header('Retry-After', String(result.retryAfter ?? 1));
        return apiError(c, 429, result.code, 'Too many login attempts. Try again later.');
      }
      return apiError(c, 401, result.code, 'The password is incorrect.');
    }

    c.header('Set-Cookie', sessionCookie(result.token));
    return c.json({
      authenticated: true,
      expiresAt: new Date(result.expiresAt).toISOString(),
    });
  });

  app.post('/api/auth/logout', async (c) => {
    await logoutPasswordSession(c.req.raw, c.env);
    c.header('Cache-Control', 'no-store');
    c.header('Set-Cookie', expiredSessionCookie());
    return c.body(null, 204);
  });
}
