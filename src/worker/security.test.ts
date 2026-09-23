/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from './index';
import { contentSecurityPolicyFor } from './middleware/security';
import { TEST_PASSWORD, TEST_WORKER_VERSION } from './test-auth';
import type { WorkerBindings } from './types';

const testEnv = env as typeof env & { DOVARI_TEST_D1_MIGRATIONS: string };

function makeEnvironment(
  overrides: Partial<{
    CF_VERSION_METADATA: { id: string };
    DOVARI_PASSWORD: string;
  }> = {},
) {
  const staticFetch = vi.fn(async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    return new Response(`static:${pathname}`, { headers: { 'content-type': 'text/plain' } });
  });
  const bindings = {
    ...env,
    CF_VERSION_METADATA: { id: TEST_WORKER_VERSION },
    DOVARI_PASSWORD: TEST_PASSWORD,
    STATIC_ASSETS: { fetch: staticFetch },
    ...overrides,
  } as unknown as WorkerBindings;
  return { bindings, staticFetch };
}

async function fetchApp(pathname: string, bindings: WorkerBindings, init?: RequestInit) {
  return app.fetch(new Request(`https://wiki.example${pathname}`, init), bindings);
}

async function login(bindings: WorkerBindings, password = TEST_PASSWORD, ip = '192.0.2.1') {
  return fetchApp('/api/auth/login', bindings, {
    body: JSON.stringify({ password }),
    headers: {
      'CF-Connecting-IP': ip,
      'Content-Type': 'application/json',
      Origin: 'https://wiki.example',
    },
    method: 'POST',
  });
}

function cookieFrom(response: Response) {
  const setCookie = response.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('Expected a session cookie.');
  return setCookie.split(';', 1)[0];
}

beforeAll(async () => {
  const migrations = JSON.parse(testEnv.DOVARI_TEST_D1_MIGRATIONS) as Array<{
    name: string;
    queries: string[];
  }>;
  await applyD1Migrations(env.DB, migrations);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions'),
    env.DB.prepare('DELETE FROM auth_login_attempts'),
  ]);
});

describe('worker password security boundary', () => {
  it('allows Vite inline tooling only in development', () => {
    const developmentPolicy = contentSecurityPolicyFor(true);
    const productionPolicy = contentSecurityPolicyFor(false);

    expect(developmentPolicy).toContain("script-src 'self' 'unsafe-inline'");
    expect(developmentPolicy).toContain("style-src 'self' 'unsafe-inline'");
    expect(productionPolicy).toContain("script-src 'self'");
    expect(productionPolicy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(productionPolicy).not.toContain("style-src 'self' 'unsafe-inline'");
  });

  it('fails closed when the password or version configuration is missing or invalid', async () => {
    for (const overrides of [{ DOVARI_PASSWORD: undefined }, { CF_VERSION_METADATA: undefined }]) {
      const { bindings, staticFetch } = makeEnvironment(overrides);
      const appResponse = await fetchApp('/app', bindings);
      const apiResponse = await fetchApp('/api/private/pages', bindings);
      expect(appResponse.status).toBe(503);
      expect(apiResponse.status).toBe(503);
      await expect(apiResponse.json()).resolves.toMatchObject({
        error: { code: 'SETUP_REQUIRED' },
      });
      expect(staticFetch).not.toHaveBeenCalled();
    }
  });

  it('accepts configured passwords shorter than sixteen characters', async () => {
    const password = 'short';
    const { bindings } = makeEnvironment({ DOVARI_PASSWORD: password });
    const response = await login(bindings, password);

    expect(response.status).toBe(200);
  });

  it('creates only a hashed opaque session after an exact password match', async () => {
    const { bindings } = makeEnvironment();
    const wrong = await login(bindings, `${TEST_PASSWORD} `);
    expect(wrong.status).toBe(401);
    await expect(wrong.json()).resolves.toMatchObject({ error: { code: 'AUTH_INVALID' } });

    const response = await login(bindings);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('__Host-dovari_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Max-Age=2592000');

    const token = cookieFrom(response).split('=')[1];
    const stored = await env.DB.prepare(
      'SELECT token_hash, worker_version, expires_at FROM auth_sessions',
    ).first<{ token_hash: string; worker_version: string; expires_at: number }>();
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(stored?.token_hash).not.toContain(token);
    expect(stored?.worker_version).toBe(TEST_WORKER_VERSION);
    expect(stored?.expires_at).toBeGreaterThan(Date.now());

    const privateResponse = await fetchApp('/api/private/pages', bindings, {
      headers: { Cookie: cookieFrom(response) },
    });
    expect(privateResponse.status).toBe(200);
  });

  it('redirects private HTML to login with a local next path and keeps APIs at 401', async () => {
    const { bindings } = makeEnvironment();
    const html = await fetchApp('/app/pages/page-1?history=1', bindings);
    expect(html.status).toBe(302);
    const location = new URL(html.headers.get('Location') ?? '', 'https://wiki.example');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/app/pages/page-1?history=1');

    const api = await fetchApp('/api/private/pages', bindings);
    expect(api.status).toBe(401);
    await expect(api.json()).resolves.toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });

  it('invalidates missing, tampered, expired, logged-out, and old-version sessions', async () => {
    const { bindings } = makeEnvironment();
    const loginResponse = await login(bindings);
    const cookie = cookieFrom(loginResponse);
    const token = cookie.split('=')[1];

    const changedLastCharacter = token.at(-1) === 'A' ? 'B' : 'A';
    const tampered = await fetchApp('/api/private/pages', bindings, {
      headers: {
        Cookie: `__Host-dovari_session=${token.slice(0, -1)}${changedLastCharacter}`,
      },
    });
    expect(tampered.status).toBe(401);

    const oldVersion = await fetchApp(
      '/api/private/pages',
      makeEnvironment({ CF_VERSION_METADATA: { id: 'new-version' } }).bindings,
      { headers: { Cookie: cookie } },
    );
    expect(oldVersion.status).toBe(401);

    await env.DB.prepare('UPDATE auth_sessions SET created_at = 0, expires_at = 1').run();
    const expired = await fetchApp('/api/private/pages', bindings, { headers: { Cookie: cookie } });
    expect(expired.status).toBe(401);

    const freshLogin = await login(bindings);
    const freshCookie = cookieFrom(freshLogin);
    const logout = await fetchApp('/api/auth/logout', bindings, {
      headers: { Cookie: freshCookie, Origin: 'https://wiki.example' },
      method: 'POST',
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const loggedOut = await fetchApp('/api/private/pages', bindings, {
      headers: { Cookie: freshCookie },
    });
    expect(loggedOut.status).toBe(401);
  });

  it('limits concurrent failed logins by hashed source address', async () => {
    const { bindings } = makeEnvironment();
    const failures = await Promise.all(
      Array.from({ length: 5 }, () => login(bindings, 'incorrect-password', '198.51.100.8')),
    );
    expect(failures.every((response) => response.status === 401)).toBe(true);

    const limited = await login(bindings, TEST_PASSWORD, '198.51.100.8');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: 'AUTH_RATE_LIMITED' },
    });

    const attempt = await env.DB.prepare(
      'SELECT source_hash, failure_count FROM auth_login_attempts',
    ).first<{ source_hash: string; failure_count: number }>();
    expect(attempt?.source_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(attempt?.source_hash).not.toContain('198.51.100.8');
    expect(attempt?.failure_count).toBe(5);
  });

  it('requires same-origin login/logout and rejects invalid request shapes', async () => {
    const { bindings } = makeEnvironment();
    const foreign = await fetchApp('/api/auth/login', bindings, {
      body: JSON.stringify({ password: TEST_PASSWORD }),
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      method: 'POST',
    });
    expect(foreign.status).toBe(403);

    const noOrigin = await fetchApp('/api/auth/login', bindings, {
      body: JSON.stringify({ password: TEST_PASSWORD }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(noOrigin.status).toBe(403);

    const wrongType = await fetchApp('/api/auth/login', bindings, {
      body: 'password=value',
      headers: { 'Content-Type': 'text/plain', Origin: 'https://wiki.example' },
      method: 'POST',
    });
    expect(wrongType.status).toBe(415);

    const extraField = await fetchApp('/api/auth/login', bindings, {
      body: JSON.stringify({ password: TEST_PASSWORD, redirect: 'https://evil.example' }),
      headers: { 'Content-Type': 'application/json', Origin: 'https://wiki.example' },
      method: 'POST',
    });
    expect(extraField.status).toBe(400);
  });

  it('keeps health, public pages, login, and static files public without forwarding credentials', async () => {
    const { bindings, staticFetch } = makeEnvironment({ DOVARI_PASSWORD: undefined });
    const health = await fetchApp('/api/health', bindings);
    const landingPage = await fetchApp('/', bindings, {
      headers: { Authorization: 'secret', Cookie: 'private=value' },
    });
    const loginPage = await fetchApp('/login', bindings, {
      headers: { Authorization: 'secret', Cookie: 'private=value' },
    });
    const asset = await fetchApp('/assets/app.js', bindings);
    expect(health.status).toBe(200);
    expect(landingPage.status).toBe(200);
    expect(loginPage.status).toBe(200);
    expect(asset.status).toBe(200);
    expect(staticFetch).toHaveBeenCalledTimes(3);
    const staticRequest = staticFetch.mock.calls[0]?.[0];
    expect(staticRequest?.headers.has('Authorization')).toBe(false);
    expect(staticRequest?.headers.has('Cookie')).toBe(false);
    expect(health.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(loginPage.headers.get('Content-Security-Policy')).not.toContain("'unsafe-inline'");
  });

  it('retains same-origin protection for authenticated private mutations', async () => {
    const { bindings } = makeEnvironment();
    const cookie = cookieFrom(await login(bindings));
    const missingOrigin = await fetchApp('/api/private/pages', bindings, {
      headers: { Cookie: cookie },
      method: 'POST',
    });
    const foreignOrigin = await fetchApp('/api/private/pages', bindings, {
      headers: { Cookie: cookie, Origin: 'https://evil.example' },
      method: 'POST',
    });
    const sameOrigin = await fetchApp('/api/private/pages', bindings, {
      headers: { Cookie: cookie, Origin: 'https://wiki.example' },
      method: 'POST',
    });
    expect(missingOrigin.status).toBe(403);
    expect(foreignOrigin.status).toBe(403);
    expect(sameOrigin.status).toBe(400);
  });

  it('does not route unknown auth, private, or reserved public APIs to the SPA', async () => {
    const { bindings, staticFetch } = makeEnvironment();
    expect((await fetchApp('/api/auth/unknown', bindings)).status).toBe(404);
    expect((await fetchApp('/api/unknown.js', bindings)).status).toBe(404);
    expect((await fetchApp('/api/public/pages', bindings)).status).toBe(404);
    expect(staticFetch).not.toHaveBeenCalled();
  });
});
