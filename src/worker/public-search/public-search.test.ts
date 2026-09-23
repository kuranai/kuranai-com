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
  createdPageIds.clear();
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

async function publish(page: PageDetail, allowIndexing = false) {
  const response = await request(`/api/private/pages/${page.id}/publication`, {
    body: JSON.stringify({ allowIndexing, baseRevision: page.revision }),
    method: 'PUT',
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { publication: { publicId: string; updatedAt: string } })
    .publication;
}

describe('public search and discovery', () => {
  it('searches only published snapshots and returns public hierarchy breadcrumbs', async () => {
    const root = await createPage('Published root');
    const rootPublication = await publish(root, true);
    const hiddenParent = await createPage('Private intermediate', root.id);
    const hiddenParentPublicationResponse = await request(
      `/api/private/pages/${hiddenParent.id}/publication`,
    );
    expect(hiddenParentPublicationResponse.status).toBe(200);
    const hiddenParentPublication = (
      (await hiddenParentPublicationResponse.json()) as {
        publication: { publicId: string } | null;
      }
    ).publication;
    expect(hiddenParentPublication).not.toBeNull();
    const child = await createPage('Published child', hiddenParent.id);
    const childWithContent = await updateContent(child, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Snapshot discovery marker' }] },
      ],
    });
    const childPublication = await publish(childWithContent, true);

    const search = await request('/api/public/search?q=discovery%20marker', {}, false);
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as {
      results: Array<{
        publicId: string;
        breadcrumb: Array<{ publishedTitle: string }>;
      }>;
    };
    expect(searchBody.results).toEqual([
      expect.objectContaining({ publicId: childPublication.publicId }),
    ]);
    expect(searchBody.results[0]?.breadcrumb).toEqual([
      {
        publicId: rootPublication.publicId,
        publishedTitle: root.title,
        url: `/p/${rootPublication.publicId}`,
      },
      {
        publicId: hiddenParentPublication?.publicId,
        publishedTitle: hiddenParent.title,
        url: `/p/${hiddenParentPublication?.publicId}`,
      },
    ]);
    const serialized = JSON.stringify(searchBody);
    expect(serialized).not.toContain(root.id);
    expect(serialized).not.toContain(hiddenParent.id);
    expect(serialized).not.toContain(child.id);
    expect(serialized).toContain(hiddenParent.title);

    const list = await request('/api/public/publications', {}, false);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      publications: Array<{ publicId: string; parentPublicId: string | null }>;
    };
    expect(listBody.publications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parentPublicId: hiddenParentPublication?.publicId,
          publicId: childPublication.publicId,
        }),
      ]),
    );
    expect(JSON.stringify(listBody)).toContain(hiddenParent.title);
  });

  it('updates and removes snapshot search entries on republish and unpublish', async () => {
    const page = await createPage('Search lifecycle');
    const oldContent = await updateContent(page, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old public marker' }] }],
    });
    const publication = await publish(oldContent);

    await expect(
      (await request('/api/public/search?q=old%20public%20marker', {}, false)).json(),
    ).resolves.toMatchObject({
      results: [expect.objectContaining({ publicId: publication.publicId })],
    });

    const newContent = await updateContent(oldContent, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new public marker' }] }],
    });
    await publish(newContent, true);

    await expect(
      (await request('/api/public/search?q=old%20public%20marker', {}, false)).json(),
    ).resolves.toMatchObject({
      results: [],
    });
    await expect(
      (await request('/api/public/search?q=new%20public%20marker', {}, false)).json(),
    ).resolves.toMatchObject({
      results: [expect.objectContaining({ publicId: publication.publicId })],
    });

    const current = await request(`/api/private/pages/${page.id}/publication`);
    const currentBody = (await current.json()) as {
      publication: { publicId: string; updatedAt: string };
    };
    const unpublished = await request(`/api/private/pages/${page.id}/publication`, {
      body: JSON.stringify({
        expectedUpdatedAt: currentBody.publication.updatedAt,
        publicId: currentBody.publication.publicId,
      }),
      method: 'DELETE',
    });
    expect(unpublished.status).toBe(200);
    await expect(
      (await request('/api/public/search?q=new%20public%20marker', {}, false)).json(),
    ).resolves.toMatchObject({
      results: [],
    });
  });

  it('restricts robots and sitemap to explicitly indexable publications and revalidates lists', async () => {
    const indexable = await createPage('Indexable public page');
    const indexablePublication = await publish(indexable, true);
    const noindex = await createPage('Private-by-default public page');
    const noindexPublication = await publish(noindex, false);

    const robots = await request('/robots.txt', {}, false);
    expect(robots.status).toBe(200);
    const robotsText = await robots.text();
    expect(robotsText).toContain(`/p/${indexablePublication.publicId}`);
    expect(robotsText).not.toContain(noindexPublication.publicId);

    const sitemap = await request('/sitemap.xml', {}, false);
    expect(sitemap.status).toBe(200);
    const sitemapText = await sitemap.text();
    expect(sitemapText).toContain(`/p/${indexablePublication.publicId}`);
    expect(sitemapText).not.toContain(noindexPublication.publicId);
    expect(sitemapText).not.toContain(noindex.id);

    const list = await request('/api/public/publications', {}, false);
    const etag = list.headers.get('ETag');
    expect(etag).toBeTruthy();
    const revalidated = await request(
      '/api/public/publications',
      { headers: { 'If-None-Match': etag! } },
      false,
    );
    expect(revalidated.status).toBe(304);
  });
});
