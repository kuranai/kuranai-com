/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PageDetail, TiptapDocument } from '../../shared/pages';
import { app } from '../index';
import { authenticatedTestBindings, createTestSession } from '../test-auth';

const testEnv = env as typeof env & { DOVARI_TEST_D1_MIGRATIONS: string };
const localEnv = authenticatedTestBindings(env);
let authCookie = '';
const createdPageIds = new Set<string>();
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
  for (const pageId of createdPageIds) {
    await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId).run();
  }
  for (const assetId of createdAssetIds) {
    const asset = await env.DB.prepare('SELECT object_key FROM assets WHERE id = ?')
      .bind(assetId)
      .first<{ object_key: string }>();
    await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(assetId).run();
    if (asset) await env.ASSETS.delete(asset.object_key);
  }
  createdPageIds.clear();
  createdAssetIds.clear();
});

async function request(path: string, init: RequestInit = {}, authenticated = true) {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set('Cookie', authCookie);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (
    init.method !== undefined &&
    !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())
  ) {
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
  const page = ((await response.json()) as { page: PageDetail }).page;
  createdPageIds.add(page.id);
  return page;
}

async function updateContent(page: PageDetail, content: TiptapDocument) {
  const response = await request(`/api/private/pages/${page.id}/content`, {
    body: JSON.stringify({ baseRevision: page.revision, content }),
    method: 'PUT',
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { page: PageDetail }).page;
}

async function updateTitle(page: PageDetail, title: string) {
  const response = await request(`/api/private/pages/${page.id}`, {
    body: JSON.stringify({ baseRevision: page.revision, title }),
    method: 'PATCH',
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { page: PageDetail }).page;
}

async function publish(page: PageDetail, allowIndexing = false) {
  const response = await request(`/api/private/pages/${page.id}/publication`, {
    body: JSON.stringify({ allowIndexing, baseRevision: page.revision }),
    method: 'PUT',
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { publication: { publicId: string; updatedAt: string } })
    .publication;
}

async function uploadAsset(pageId: string, bytes = new Uint8Array([4, 8, 15, 16, 23, 42])) {
  const response = await request('/api/private/assets', {
    body: bytes.buffer as ArrayBuffer,
    headers: {
      'Content-Length': String(bytes.byteLength),
      'Content-Type': 'application/octet-stream',
      'X-Dovari-Filename': encodeURIComponent('public-asset.bin'),
      'X-Dovari-Page-Id': pageId,
    },
    method: 'POST',
  });
  expect(response.status).toBe(201);
  const assetId = ((await response.json()) as { asset: { id: string } }).asset.id;
  createdAssetIds.add(assetId);
  return assetId;
}

describe('publications', () => {
  it('publishes an isolated snapshot and rewrites only published wiki links', async () => {
    const target = await createPage('Published target');
    const targetPublication = await publish(target, true);
    const source = await createPage('Private source');
    const sourceWithLinks = await updateContent(source, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'wikiLink',
              attrs: { targetPageId: target.id, targetTitle: target.title },
            },
            { type: 'text', text: ' and ' },
            {
              type: 'wikiLink',
              attrs: {
                targetPageId: '33333333-3333-4333-8333-333333333333',
                targetTitle: 'Private target',
              },
            },
          ],
        },
      ],
    });
    const sourcePublication = await publish(sourceWithLinks);

    const detailResponse = await request(
      `/api/public/publications/${sourcePublication.publicId}`,
      {},
      false,
    );
    expect(detailResponse.status).toBe(200);
    const detailText = await detailResponse.text();
    expect(detailText).toContain('Published target');
    expect(detailText).toContain('Private target');
    expect(detailText).not.toContain(source.id);
    expect(detailText).not.toContain(target.id);
    expect(detailText).not.toContain('sourceRevision');
    expect(detailText).not.toContain('pageId');
    const detail = JSON.parse(detailText) as {
      publication: { content: TiptapDocument; allowIndexing: boolean };
    };
    const paragraph = detail.publication.content.content[0];
    expect(paragraph?.content?.[0]).toEqual({
      attrs: { targetPublicId: targetPublication.publicId, targetTitle: target.title },
      type: 'publicWikiLink',
    });
    expect(paragraph?.content?.[2]).toEqual({ type: 'text', text: 'Private target' });
    expect(detail.publication.allowIndexing).toBe(false);

    const changed = await updateContent(sourceWithLinks, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft only' }] }],
    });
    const updatedPublic = await request(
      `/api/public/publications/${sourcePublication.publicId}`,
      {},
      false,
    );
    expect(updatedPublic.status).toBe(200);
    expect(changed.revision).toBeGreaterThan(sourceWithLinks.revision);
    const updatedBody = (await updatedPublic.json()) as {
      publication: { content: TiptapDocument; publishedTitle: string };
    };
    expect(updatedBody.publication.content).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft only' }] }],
    });

    const renamed = await updateTitle(changed, 'Updated public source');
    const renamedPublic = await request(
      `/api/public/publications/${sourcePublication.publicId}`,
      {},
      false,
    );
    expect(renamed.revision).toBeGreaterThan(changed.revision);
    expect((await renamedPublic.json()) as unknown).toMatchObject({
      publication: { publishedTitle: 'Updated public source' },
    });
  });

  it('lists only active publications, protects mutations, and revalidates caches', async () => {
    const page = await createPage('Visible page');
    const publication = await publish(page);
    const hidden = await createPage('Never visible draft');

    const list = await request('/api/public/publications', {}, false);
    expect(list.status).toBe(200);
    expect(list.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    const body = (await list.json()) as {
      publications: Array<Record<string, unknown>>;
    };
    expect(body.publications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ publicId: publication.publicId, publishedTitle: page.title }),
      ]),
    );
    expect(JSON.stringify(body)).not.toContain(hidden.id);
    expect(JSON.stringify(body)).not.toContain('pageId');

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const mutation = await request('/api/public/publications', { method }, false);
      expect(mutation.status).toBe(405);
      expect(mutation.headers.get('Allow')).toContain('GET');
    }
    const options = await request('/api/public/publications', { method: 'OPTIONS' }, false);
    expect(options.status).toBe(204);
    expect(options.headers.get('Allow')).toBe('GET, HEAD, OPTIONS');

    const privateMutation = await request(
      `/api/private/pages/${hidden.id}/publication`,
      {
        body: JSON.stringify({ baseRevision: hidden.revision }),
        method: 'PUT',
      },
      false,
    );
    expect(privateMutation.status).toBe(401);
  });

  it('publishes and unpublishes an entire page subtree as one public category', async () => {
    const root = await createPage('Public category');
    const child = await createPage('Public child', root.id);
    const grandchild = await createPage('Public grandchild', child.id);
    const privateCategory = await createPage('Private category');

    const rootPublication = await publish(root, true);
    const listResponse = await request('/api/public/publications', {}, false);
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      publications: Array<{
        parentPublicId: string | null;
        publicId: string;
        publishedTitle: string;
      }>;
    };
    const publicPages = new Map(
      list.publications.map((publication) => [publication.publishedTitle, publication]),
    );

    expect(publicPages.has(root.title)).toBe(true);
    expect(publicPages.has(child.title)).toBe(true);
    expect(publicPages.has(grandchild.title)).toBe(true);
    expect(publicPages.has(privateCategory.title)).toBe(false);
    expect(publicPages.get(child.title)?.parentPublicId).toBe(rootPublication.publicId);
    expect(publicPages.get(grandchild.title)?.parentPublicId).toBe(
      publicPages.get(child.title)?.publicId,
    );

    const currentRoot = await request(`/api/private/pages/${root.id}/publication`);
    const currentRootPublication = (
      (await currentRoot.json()) as { publication: { publicId: string; updatedAt: string } }
    ).publication;
    const unpublishResponse = await request(`/api/private/pages/${root.id}/publication`, {
      body: JSON.stringify({
        expectedUpdatedAt: currentRootPublication.updatedAt,
        publicId: currentRootPublication.publicId,
      }),
      method: 'DELETE',
    });
    expect(unpublishResponse.status).toBe(200);

    const afterUnpublish = (await (
      await request('/api/public/publications', {}, false)
    ).json()) as {
      publications: Array<{ publishedTitle: string }>;
    };
    expect(
      afterUnpublish.publications.some((publication) => publication.publishedTitle === root.title),
    ).toBe(false);
    expect(
      afterUnpublish.publications.some((publication) => publication.publishedTitle === child.title),
    ).toBe(false);
    expect(
      afterUnpublish.publications.some(
        (publication) => publication.publishedTitle === grandchild.title,
      ),
    ).toBe(false);
  });

  it('automatically publishes pages created or moved beneath a published ancestor', async () => {
    const root = await createPage('Published parent');
    const rootPublication = await publish(root, true);

    const createdChild = await createPage('Created child', root.id);
    const createdChildPublicationResponse = await request(
      `/api/private/pages/${createdChild.id}/publication`,
    );
    expect(createdChildPublicationResponse.status).toBe(200);
    const createdChildPublication = (
      (await createdChildPublicationResponse.json()) as {
        publication: { allowIndexing: boolean; publicId: string } | null;
      }
    ).publication;
    expect(createdChildPublication).toMatchObject({ allowIndexing: true });

    const createdChildPublicResponse = await request(
      `/api/public/publications/${createdChildPublication?.publicId}`,
      {},
      false,
    );
    expect(createdChildPublicResponse.status).toBe(200);
    await expect(createdChildPublicResponse.json()).resolves.toMatchObject({
      publication: {
        parentPublicId: rootPublication.publicId,
        publishedTitle: createdChild.title,
      },
    });

    const movedChild = await createPage('Moved child');
    const moveResponse = await request(`/api/private/pages/${movedChild.id}/move`, {
      body: JSON.stringify({ parentId: root.id }),
      method: 'POST',
    });
    expect(moveResponse.status).toBe(200);

    const movedChildPublicationResponse = await request(
      `/api/private/pages/${movedChild.id}/publication`,
    );
    expect(movedChildPublicationResponse.status).toBe(200);
    await expect(movedChildPublicationResponse.json()).resolves.toMatchObject({
      publication: { allowIndexing: true },
    });
  });

  it('removes inherited publications when a shared category moves to Trash', async () => {
    const root = await createPage('Trashed category');
    const child = await createPage('Trashed child', root.id);
    await publish(root);

    const deleted = await request(`/api/private/pages/${root.id}`, {
      body: JSON.stringify({ baseRevision: root.revision }),
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);

    const list = (await (await request('/api/public/publications', {}, false)).json()) as {
      publications: Array<{ publishedTitle: string }>;
    };
    expect(list.publications.some((publication) => publication.publishedTitle === root.title)).toBe(
      false,
    );
    expect(
      list.publications.some((publication) => publication.publishedTitle === child.title),
    ).toBe(false);
  });

  it('keeps public assets snapshot-scoped and handles stale unpublish safely', async () => {
    const page = await createPage('Asset page');
    const assetId = await uploadAsset(page.id);
    const unrelatedAssetId = await uploadAsset(page.id, new Uint8Array([9, 9, 9]));
    const withAsset = await updateContent(page, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Download: ' },
            { type: 'attachment', attrs: { assetId, filename: 'public-asset.bin' } },
          ],
        },
      ],
    });
    const publication = await publish(withAsset);
    const assetResponse = await request(
      `/api/public/publications/${publication.publicId}/assets/${assetId}/content`,
      {},
      false,
    );
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    await expect(assetResponse.arrayBuffer()).resolves.toEqual(
      new Uint8Array([4, 8, 15, 16, 23, 42]).buffer,
    );
    expect(
      (
        await request(
          `/api/public/publications/${publication.publicId}/assets/${unrelatedAssetId}/content`,
          {},
          false,
        )
      ).status,
    ).toBe(404);

    const updated = await publish(withAsset, true);
    const staleUnpublish = await request(`/api/private/pages/${page.id}/publication`, {
      body: JSON.stringify({
        expectedUpdatedAt: publication.updatedAt,
        publicId: publication.publicId,
      }),
      method: 'DELETE',
    });
    expect(staleUnpublish.status).toBe(409);
    expect((await request(`/api/public/publications/${updated.publicId}`, {}, false)).status).toBe(
      200,
    );

    const unpublish = await request(`/api/private/pages/${page.id}/publication`, {
      body: JSON.stringify({ expectedUpdatedAt: updated.updatedAt, publicId: updated.publicId }),
      method: 'DELETE',
    });
    expect(unpublish.status).toBe(200);
    expect((await request(`/api/public/publications/${updated.publicId}`, {}, false)).status).toBe(
      404,
    );
    expect(
      (
        await request(
          `/api/public/publications/${updated.publicId}/assets/${assetId}/content`,
          {},
          false,
        )
      ).status,
    ).toBe(404);
    const republished = await publish(withAsset);
    expect(republished.publicId).not.toBe(updated.publicId);
  });

  it('removes a publication atomically on soft delete and does not restore it automatically', async () => {
    const page = await createPage('Delete me publicly');
    const publication = await publish(page);
    const deleted = await request(`/api/private/pages/${page.id}`, {
      body: JSON.stringify({ baseRevision: page.revision }),
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);
    expect(
      (await request(`/api/public/publications/${publication.publicId}`, {}, false)).status,
    ).toBe(404);

    const restore = await request(`/api/private/pages/${page.id}/restore`, {
      body: JSON.stringify({ baseRevision: page.revision + 1 }),
      method: 'POST',
    });
    expect(restore.status).toBe(200);
    expect(
      (await request(`/api/public/publications/${publication.publicId}`, {}, false)).status,
    ).toBe(404);
  });

  it('accepts HEAD and returns uniform 404s for unknown public resources', async () => {
    const unknown = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const detail = await request(`/api/public/publications/${unknown}`, {}, false);
    expect(detail.status).toBe(404);
    await expect(detail.json()).resolves.toMatchObject({
      error: { code: 'PUBLICATION_NOT_FOUND' },
    });
    const head = await request(`/api/public/publications/${unknown}`, { method: 'HEAD' }, false);
    expect(head.status).toBe(404);
    expect(await head.text()).toBe('');
    const list = await request('/api/public/publications?limit=1', {}, false);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ publications: expect.any(Array) });
  });
});
