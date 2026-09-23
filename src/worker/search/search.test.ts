/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFtsMatchQuery,
  parseSearchSnippet,
  searchResponseSchema,
  type SearchResponse,
} from '../../shared/search';
import type { TiptapDocument } from '../../shared/pages';
import { app } from '../index';
import { checkPagesFtsIntegrity, rebuildPagesFts } from '../db/fts';
import type { PageDetail } from '../../shared/pages';
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
    await env.DB.prepare('DELETE FROM page_links WHERE source_page_id = ? OR target_page_id = ?')
      .bind(pageId, pageId)
      .run();
    await env.DB.prepare('DELETE FROM page_assets WHERE page_id = ?').bind(pageId).run();
    await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId).run();
  }

  createdPageIds.clear();
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

function textDocument(text: string): TiptapDocument {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

async function updateContent(page: PageDetail, text: string) {
  const response = await request(`/api/private/pages/${page.id}/content`, {
    body: JSON.stringify({ baseRevision: page.revision, content: textDocument(text) }),
    method: 'PUT',
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { page: PageDetail }).page;
}

async function search(query: string, limit?: number): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (limit !== undefined) {
    params.set('limit', String(limit));
  }

  const response = await request(`/api/private/search?${params.toString()}`);
  expect(response.status, await response.clone().text()).toBe(200);
  return searchResponseSchema.parse(await response.json());
}

describe('search query construction', () => {
  it('quotes every token and applies prefix matching only to the last searchable token', () => {
    expect(buildFtsMatchQuery('Cloudflare OR "Workers')).toBe('"Cloudflare" "OR" """Workers"*');
    expect(buildFtsMatchQuery('*** + :')).toBe('');
  });

  it('parses snippet markers into safe text segments', () => {
    expect(parseSearchSnippet('Before <mark>match</mark> after')).toEqual([
      { highlighted: false, text: 'Before ' },
      { highlighted: true, text: 'match' },
      { highlighted: false, text: ' after' },
    ]);
  });
});

describe('Search API', () => {
  it('returns prefix matches with snippets, canonical URLs, and breadcrumbs', async () => {
    const root = await createPage('Programming');
    const child = await createPage('Cloudflare Notes', root.id);
    await updateContent(child, 'Deploy Cloudflare workers from a local D1 database.');

    const response = await search('cloudfl');
    const result = response.results.find((page) => page.id === child.id);

    expect(result).toMatchObject({
      id: child.id,
      slug: child.slug,
      title: child.title,
      url: `/app/pages/${child.id}`,
      breadcrumb: [
        {
          id: root.id,
          slug: root.slug,
          title: root.title,
          url: `/app/pages/${root.id}`,
        },
      ],
    });
    expect(result?.snippet).toContain('<mark>Cloudfl');
  });

  it('reflects content updates, renames, and soft deletes', async () => {
    const page = await createPage('Old Search Title');
    const contentPage = await createPage('Mutable Content');

    await expect(search('old search')).resolves.toMatchObject({
      results: [expect.objectContaining({ id: page.id })],
    });
    await expect(search('before-index')).resolves.toMatchObject({ results: [] });

    const renamedResponse = await request(`/api/private/pages/${page.id}`, {
      body: JSON.stringify({ baseRevision: page.revision, title: 'New Search Title' }),
      method: 'PATCH',
    });
    expect(renamedResponse.status).toBe(200);

    await updateContent(contentPage, 'after-index content');
    await expect(search('old search')).resolves.toMatchObject({ results: [] });
    await expect(search('new search')).resolves.toMatchObject({
      results: [expect.objectContaining({ id: page.id })],
    });
    await expect(search('after-index')).resolves.toMatchObject({
      results: [expect.objectContaining({ id: contentPage.id })],
    });

    const deleteResponse = await request(`/api/private/pages/${page.id}`, {
      body: JSON.stringify({ baseRevision: 2 }),
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);
    await expect(search('new search')).resolves.toMatchObject({ results: [] });
  });

  it('keeps FTS operators and punctuation harmless and enforces empty and bounded searches', async () => {
    await createPage('Safe Search Fixture');

    for (const query of ['OR', 'NEAR(title body)', '"unterminated', 'title:fixture', '***']) {
      const response = await request(`/api/private/search?q=${encodeURIComponent(query)}`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ results: expect.any(Array) });
    }

    await expect(search('')).resolves.toEqual({ results: [] });

    const invalidLimit = await request('/api/private/search?q=fixture&limit=0');
    expect(invalidLimit.status).toBe(400);
    await expect(invalidLimit.json()).resolves.toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });

    const bounded = await search('fixture', 999);
    expect(bounded.results.length).toBeLessThanOrEqual(50);
  });

  it('prefers a title match through the configured BM25 title weighting', async () => {
    const titleMatch = await createPage('Weighting reference');
    const contentMatch = await createPage('Unrelated notes');
    await updateContent(
      contentMatch,
      'weighting weighting weighting weighting weighting weighting weighting weighting',
    );

    const response = await search('weight');
    expect(response.results[0]?.id).toBe(titleMatch.id);
  });

  it('exposes rebuild and integrity operations for the FTS index', async () => {
    await createPage('Rebuild fixture');

    await expect(rebuildPagesFts(env.DB)).resolves.toMatchObject({ success: true });
    await expect(checkPagesFtsIntegrity(env.DB)).resolves.toBeUndefined();
    await expect(search('rebuild')).resolves.toMatchObject({
      results: [expect.objectContaining({ title: 'Rebuild fixture' })],
    });
  });
});
