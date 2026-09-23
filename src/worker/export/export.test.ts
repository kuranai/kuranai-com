/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PageDetail, TiptapDocument } from '../../shared/pages';
import { app } from '../index';
import { createAssetFixture } from '../db/fixtures';
import { authenticatedTestBindings, createTestSession } from '../test-auth';

const testEnv = env as typeof env & { DOVARI_TEST_D1_MIGRATIONS: string };
const localEnv = authenticatedTestBindings(env);
let authCookie = '';
const createdPageIds = new Set<string>();
const createdAssetIds = new Set<string>();
const createdAssetKeys = new Set<string>();

beforeAll(async () => {
  const migrations = JSON.parse(testEnv.DOVARI_TEST_D1_MIGRATIONS) as Array<{
    name: string;
    queries: string[];
  }>;

  await applyD1Migrations(env.DB, migrations);
  authCookie = await createTestSession(localEnv);
});

afterEach(async () => {
  for (const pageId of createdPageIds) {
    await env.DB.prepare('DELETE FROM page_links WHERE source_page_id = ? OR target_page_id = ?')
      .bind(pageId, pageId)
      .run();
    await env.DB.prepare('DELETE FROM page_assets WHERE page_id = ?').bind(pageId).run();
    await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId).run();
  }

  for (const assetId of createdAssetIds) {
    await env.DB.prepare('DELETE FROM page_assets WHERE asset_id = ?').bind(assetId).run();
    await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(assetId).run();
  }
  for (const objectKey of createdAssetKeys) {
    await env.ASSETS.delete(objectKey);
  }

  createdPageIds.clear();
  createdAssetIds.clear();
  createdAssetKeys.clear();
});

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', authCookie);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.method !== undefined && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    headers.set('Origin', 'http://localhost');
  }

  return app.fetch(new Request(`http://localhost${path}`, { ...init, headers }), localEnv);
}

async function createPage(title: string, parentId: string | null = null) {
  const response = await request('/api/private/pages', {
    body: JSON.stringify({ parentId, title }),
    method: 'POST',
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { page: PageDetail };
  createdPageIds.add(body.page.id);
  return body.page;
}

async function createAsset(
  pageId: string,
  originalFilename: string,
  bytes: Uint8Array,
  suffix: string,
) {
  const fixture = createAssetFixture({
    objectKey: `export-tests/${crypto.randomUUID()}-${suffix}`,
    originalFilename,
    mimeType: 'application/octet-stream',
    sizeBytes: bytes.byteLength,
    uploadedForPageId: pageId,
  });
  await env.DB.prepare(
    `INSERT INTO assets
      (id, object_key, original_filename, mime_type, size_bytes, width, height, sha256,
       uploaded_for_page_id, created_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      fixture.id,
      fixture.objectKey,
      fixture.originalFilename,
      fixture.mimeType,
      fixture.sizeBytes,
      fixture.width,
      fixture.height,
      fixture.sha256,
      fixture.uploadedForPageId,
      fixture.createdAt,
      fixture.deletedAt,
    )
    .run();
  await env.ASSETS.put(fixture.objectKey, bytes, {
    httpMetadata: { contentType: fixture.mimeType },
  });
  createdAssetIds.add(fixture.id);
  createdAssetKeys.add(fixture.objectKey);
  return fixture.id;
}

function uint16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function uint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function parseEntries(bytes: Uint8Array) {
  const endOffset = bytes.length - 22;
  expect(uint32(bytes, endOffset)).toBe(0x06054b50);
  const centralDirectoryOffset = uint32(bytes, endOffset + 16);
  const entryCount = uint16(bytes, endOffset + 10);
  const entries = new Map<string, Uint8Array>();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    expect(uint32(bytes, offset)).toBe(0x02014b50);
    const compressedSize = uint32(bytes, offset + 20);
    const nameLength = uint16(bytes, offset + 28);
    const localOffset = uint32(bytes, offset + 42);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    const localNameLength = uint16(bytes, localOffset + 26);
    const localExtraLength = uint16(bytes, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, bytes.slice(dataOffset, dataOffset + compressedSize));
    offset += 46 + nameLength;
  }

  return entries;
}

describe('Markdown and ZIP export', () => {
  it('exports active pages, local wiki links, and colliding R2 asset names', async () => {
    const root = await createPage('Programming');
    const child = await createPage('Cloudflare Workers', root.id);
    const deleted = await createPage('Deleted page');
    const screenshot = await createAsset(
      root.id,
      'screenshot.png',
      new Uint8Array([1, 2, 3, 4]),
      'first',
    );
    const attachment = await createAsset(
      root.id,
      'screenshot.png',
      new Uint8Array([5, 6, 7]),
      'second',
    );

    const content: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'wikiLink',
              attrs: { targetPageId: child.id, targetTitle: child.title },
            },
            { type: 'text', text: ' ' },
            { type: 'assetImage', attrs: { assetId: screenshot, alt: 'Screenshot' } },
            { type: 'text', text: ' ' },
            { type: 'attachment', attrs: { assetId: attachment, filename: 'Download' } },
          ],
        },
      ],
    };
    const saveResponse = await request(`/api/private/pages/${root.id}/content`, {
      body: JSON.stringify({ baseRevision: root.revision, content }),
      method: 'PUT',
    });
    expect(saveResponse.status).toBe(200);

    const deleteResponse = await request(`/api/private/pages/${deleted.id}`, {
      body: JSON.stringify({ baseRevision: deleted.revision }),
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);

    const response = await request('/api/private/export');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="dovari-export.zip"',
    );

    const entries = parseEntries(new Uint8Array(await response.arrayBuffer()));
    expect([...entries.keys()]).toEqual([
      'manifest.json',
      'pages/programming.md',
      'pages/programming/cloudflare-workers.md',
      expect.stringMatching(/^assets\/screenshot(?:-2)?\.png$/),
      expect.stringMatching(/^assets\/screenshot(?:-2)?\.png$/),
    ]);
    expect(entries.has(`pages/${deleted.slug}.md`)).toBe(false);

    const rootMarkdown = new TextDecoder().decode(entries.get('pages/programming.md'));
    expect(rootMarkdown).toContain('[Cloudflare Workers](programming/cloudflare-workers.md)');
    expect(rootMarkdown).toContain('![Screenshot](../assets/');
    expect(rootMarkdown).toContain('[Download](../assets/');

    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as {
      assets: Array<{ id: string; path: string }>;
      missingAssets: string[];
      pages: Array<{ id: string; path: string }>;
    };
    expect(manifest.missingAssets).toEqual([]);
    expect(manifest.pages).toHaveLength(2);
    expect(manifest.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: root.id, path: 'pages/programming.md' }),
        expect.objectContaining({
          id: child.id,
          path: 'pages/programming/cloudflare-workers.md',
        }),
      ]),
    );
    expect(manifest.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: screenshot, path: expect.stringMatching(/^assets\//) }),
        expect.objectContaining({ id: attachment, path: expect.stringMatching(/^assets\//) }),
      ]),
    );
    expect([
      [1, 2, 3, 4],
      [5, 6, 7],
    ]).toContainEqual([...entries.get(manifest.assets[0]!.path)!]);
  });

  it('keeps an unavailable referenced asset readable through a manifest placeholder', async () => {
    const page = await createPage('Missing asset');
    const assetId = await createAsset(page.id, 'missing.png', new Uint8Array([8, 9]), 'missing');
    const asset = await env.DB.prepare('SELECT object_key FROM assets WHERE id = ?')
      .bind(assetId)
      .first<{ object_key: string }>();
    expect(asset).not.toBeNull();
    await env.ASSETS.delete(asset!.object_key);

    const content: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'attachment', attrs: { assetId, filename: 'Missing' } }],
        },
      ],
    };
    const saveResponse = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: page.revision, content }),
      method: 'PUT',
    });
    expect(saveResponse.status).toBe(200);

    const response = await request('/api/private/export');
    expect(response.status).toBe(200);
    const entries = parseEntries(new Uint8Array(await response.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as {
      assets: Array<{ id: string; path: string }>;
      missingAssets: string[];
    };
    const manifestAsset = manifest.assets.find((assetEntry) => assetEntry.id === assetId);
    expect(manifest.missingAssets).toEqual([assetId]);
    expect(manifestAsset).toBeDefined();
    expect(new TextDecoder().decode(entries.get(manifestAsset!.path))).toContain(
      'was not available in storage',
    );
  });
});
