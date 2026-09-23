/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MAX_ASSET_SIZE_BYTES } from '../../shared/assets';
import { app } from '../index';
import { authenticatedTestBindings, createTestSession } from '../test-auth';

const testEnv = env as typeof env & { DOVARI_TEST_D1_MIGRATIONS: string };
const localEnv = authenticatedTestBindings(env);
let authCookie = '';
const createdAssetIds = new Set<string>();

beforeAll(async () => {
  const migrations = JSON.parse(testEnv.DOVARI_TEST_D1_MIGRATIONS) as Array<{
    name: string;
    queries: string[];
  }>;

  await applyD1Migrations(env.DB, migrations);
  authCookie = await createTestSession(localEnv);
});

afterEach(async () => {
  for (const assetId of createdAssetIds) {
    const asset = await env.DB.prepare('SELECT object_key FROM assets WHERE id = ?')
      .bind(assetId)
      .first<{ object_key: string }>();
    if (asset) {
      await env.ASSETS.delete(asset.object_key);
    }
    await env.DB.prepare('DELETE FROM page_assets WHERE asset_id = ?').bind(assetId).run();
    await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(assetId).run();
  }
  createdAssetIds.clear();
});

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', authCookie);
  if (init.method !== undefined && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    headers.set('Origin', 'http://localhost');
  }

  return app.fetch(new Request(`http://localhost${path}`, { ...init, headers }), localEnv);
}

function binary(hex: string) {
  return Uint8Array.from(hex.match(/../g)?.map((part) => Number.parseInt(part, 16)) ?? []);
}

const png = binary('89504e470d0a1a0a0000000d4948445200000001000000010806000000');

async function upload(
  body: BodyInit,
  mimeType: string,
  filename: string,
  pageId?: string,
  contentLength?: number,
) {
  const headers = new Headers({
    'Content-Type': mimeType,
    'X-Dovari-Filename': encodeURIComponent(filename),
  });
  if (pageId !== undefined) {
    headers.set('X-Dovari-Page-Id', pageId);
  }
  if (contentLength !== undefined) {
    headers.set('Content-Length', String(contentLength));
  }

  const response = await request('/api/private/assets', {
    body,
    headers,
    method: 'POST',
  });
  const payload = (await response.json()) as { asset: { id: string } };
  if (response.status === 201) {
    createdAssetIds.add(payload.asset.id);
    return { payload, response };
  }
  return { payload, response };
}

describe('Assets HTTP API', () => {
  it('streams an allowed image, stores metadata, and serves exact bytes', async () => {
    const { payload, response } = await upload(
      new Blob([png]),
      'image/png',
      'screenshots/ä.png',
      undefined,
      png.byteLength,
    );

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      asset: {
        contentUrl: expect.stringMatching(/^\/api\/private\/assets\/[0-9a-f-]+\/content$/),
        filename: 'ä.png',
        mimeType: 'image/png',
        sizeBytes: png.byteLength,
      },
    });

    const assetId = payload.asset.id;
    const metadata = await request(`/api/private/assets/${assetId}`);
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toMatchObject({
      asset: { id: assetId, filename: 'ä.png', mimeType: 'image/png' },
    });

    const content = await request(`/api/private/assets/${assetId}/content`);
    expect(content.status).toBe(200);
    expect(content.headers.get('Content-Type')).toBe('image/png');
    expect(content.headers.get('Content-Disposition')).toContain('inline');
    expect(content.headers.get('Content-Length')).toBe(String(png.byteLength));
    expect(content.headers.get('ETag')).toBeTruthy();
    expect(content.headers.get('X-Content-Type-Options')).toBe('nosniff');
    await expect(content.arrayBuffer()).resolves.toEqual(png.buffer);
  });

  it('supports ETag conditional requests and single byte ranges', async () => {
    const { payload } = await upload(new Blob(['0123456789']), 'text/plain', 'notes.txt');
    const assetId = payload.asset.id;

    const first = await request(`/api/private/assets/${assetId}/content`);
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();

    const notModified = await request(`/api/private/assets/${assetId}/content`, {
      headers: { 'If-None-Match': etag! },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('ETag')).toBe(etag);

    const head = await request(`/api/private/assets/${assetId}/content`, {
      headers: { 'If-None-Match': etag! },
      method: 'HEAD',
    });
    expect(head.status).toBe(304);

    const range = await request(`/api/private/assets/${assetId}/content`, {
      headers: { Range: 'bytes=2-5' },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(range.headers.get('Content-Length')).toBe('4');
    await expect(range.text()).resolves.toBe('2345');

    const invalidRange = await request(`/api/private/assets/${assetId}/content`, {
      headers: { Range: 'bytes=99-100' },
    });
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get('Content-Range')).toBe('bytes */10');
  });

  it('sanitizes attachment delivery, soft-deletes metadata, and retains R2 data', async () => {
    const { payload } = await upload(new Blob(['hello']), 'text/plain', '../secret.txt');
    const assetId = payload.asset.id;
    const row = await env.DB.prepare('SELECT object_key FROM assets WHERE id = ?')
      .bind(assetId)
      .first<{ object_key: string }>();

    const content = await request(`/api/private/assets/${assetId}/content`);
    expect(content.headers.get('Content-Disposition')).toContain('attachment');
    expect(content.headers.get('Content-Disposition')).toContain('filename="secret.txt"');

    const deletion = await request(`/api/private/assets/${assetId}`, { method: 'DELETE' });
    expect(deletion.status).toBe(200);
    await expect(deletion.json()).resolves.toMatchObject({
      asset: { id: assetId, deletedAt: expect.any(String) },
    });
    expect((await request(`/api/private/assets/${assetId}`)).status).toBe(404);
    expect((await request(`/api/private/assets/${assetId}/content`)).status).toBe(404);
    expect(row).not.toBeNull();
    await expect(env.ASSETS.head(row!.object_key)).resolves.not.toBeNull();
  });

  it('rejects oversized, unsafe, and falsely declared uploads', async () => {
    const tooLarge = await request('/api/private/assets', {
      body: new Blob(['ignored']),
      headers: {
        'Content-Length': String(MAX_ASSET_SIZE_BYTES + 1),
        'Content-Type': 'application/octet-stream',
        'X-Dovari-Filename': 'large.bin',
      },
      method: 'POST',
    });
    expect(tooLarge.status).toBe(413);
    await expect(tooLarge.json()).resolves.toMatchObject({
      error: { code: 'ASSET_TOO_LARGE' },
    });

    const svg = await upload(
      new Blob(['<svg><script>alert(1)</script></svg>']),
      'image/svg+xml',
      'x.svg',
    );
    expect(svg.response.status).toBe(415);

    const html = await upload(
      new Blob(['<!doctype html><script>alert(1)</script>']),
      'application/octet-stream',
      'x.bin',
    );
    expect(html.response.status).toBe(415);

    const mismatch = await upload(new Blob([png]), 'image/jpeg', 'wrong.jpg');
    expect(mismatch.response.status).toBe(422);
    expect(mismatch.payload).toMatchObject({ error: { code: 'ASSET_MAGIC_MISMATCH' } });
  });
});
