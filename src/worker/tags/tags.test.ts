/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PageDetail } from '../../shared/pages';
import { app } from '../index';
import { authenticatedTestBindings, createTestSession } from '../test-auth';

const testEnv = env as typeof env & { DOVARI_TEST_D1_MIGRATIONS: string };
const localEnv = authenticatedTestBindings(env);
let authCookie = '';
const createdPageIds = new Set<string>();
const createdTagIds = new Set<string>();

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
  for (const tagId of createdTagIds) {
    await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(tagId).run();
  }
  createdPageIds.clear();
  createdTagIds.clear();
});

async function request(path: string, init: RequestInit = {}, authenticated = true) {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set('Cookie', authCookie);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.method !== undefined && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    headers.set('Origin', 'http://localhost');
  }
  return app.fetch(new Request(`http://localhost${path}`, { ...init, headers }), localEnv);
}

async function createPage(title: string) {
  const response = await request('/api/private/pages', {
    body: JSON.stringify({ parentId: null, title }),
    method: 'POST',
  });
  expect(response.status).toBe(201);
  const page = ((await response.json()) as { page: PageDetail }).page;
  createdPageIds.add(page.id);
  return page;
}

async function createTag(name: string) {
  const response = await request('/api/private/tags', {
    body: JSON.stringify({ name }),
    method: 'POST',
  });
  expect(response.status).toBe(201);
  const tag = ((await response.json()) as { tag: { id: string; name: string } }).tag;
  createdTagIds.add(tag.id);
  return tag;
}

describe('Tags and favorites HTTP API', () => {
  it('normalizes tag names, filters search, and survives page restore', async () => {
    const page = await createPage('Organized notes');
    const project = await createTag('  Project   Alpha ');
    const work = await createTag('Work');

    expect(project.name).toBe('Project Alpha');
    const duplicate = await request('/api/private/tags', {
      body: JSON.stringify({ name: 'project alpha' }),
      method: 'POST',
    });
    expect(duplicate.status).toBe(409);

    const renamed = await request(`/api/private/tags/${work.id}`, {
      body: JSON.stringify({ name: '  Work Notes ' }),
      method: 'PATCH',
    });
    expect(renamed.status).toBe(200);

    const assigned = await request(`/api/private/pages/${page.id}/tags`, {
      body: JSON.stringify({ tagIds: [project.id, work.id] }),
      method: 'PUT',
    });
    expect(assigned.status).toBe(200);
    const assignedPage = ((await assigned.json()) as { page: PageDetail }).page;
    expect(assignedPage.revision).toBe(page.revision);
    expect(assignedPage.tags.map((tag) => tag.name)).toEqual(['Project Alpha', 'Work Notes']);

    const favorite = await request(`/api/private/pages/${page.id}/favorite`, {
      body: JSON.stringify({ isFavorite: true }),
      method: 'PUT',
    });
    expect(favorite.status).toBe(200);
    expect(((await favorite.json()) as { page: PageDetail }).page).toMatchObject({
      isFavorite: true,
      revision: page.revision,
    });

    const firstPublicationResponse = await request(`/api/private/pages/${page.id}/publication`, {
      body: JSON.stringify({
        allowIndexing: false,
        baseRevision: page.revision,
        tagIds: [project.id],
      }),
      method: 'PUT',
    });
    expect(firstPublicationResponse.status).toBe(200);
    const firstPublication = (
      (await firstPublicationResponse.json()) as {
        publication: { publicId: string; tags: string[] };
      }
    ).publication;
    expect(firstPublication.tags).toEqual(['Project Alpha']);
    const firstPublicResponse = await request(
      `/api/public/publications/${firstPublication.publicId}`,
      {},
      false,
    );
    expect(firstPublicResponse.status).toBe(200);
    expect(
      ((await firstPublicResponse.json()) as { publication: { tags: string[] } }).publication.tags,
    ).toEqual(['Project Alpha']);

    const filtered = await request(
      `/api/private/pages?favorite=true&tag=${encodeURIComponent('work notes')}`,
    );
    expect(filtered.status).toBe(200);
    expect(((await filtered.json()) as { pages: Array<{ id: string }> }).pages).toEqual([
      expect.objectContaining({ id: page.id }),
    ]);

    const search = await request('/api/private/search?q=project%20alpha');
    expect(search.status).toBe(200);
    expect(
      ((await search.json()) as { results: Array<{ id: string; tags: unknown[] }> }).results,
    ).toEqual([
      expect.objectContaining({
        id: page.id,
        tags: [
          { id: project.id, name: 'Project Alpha' },
          { id: work.id, name: 'Work Notes' },
        ],
      }),
    ]);

    const deleted = await request(`/api/private/pages/${page.id}`, {
      body: JSON.stringify({ baseRevision: page.revision }),
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);
    const deletedPage = ((await deleted.json()) as { page: PageDetail }).page;
    const restored = await request(`/api/private/pages/${page.id}/restore`, {
      body: JSON.stringify({ baseRevision: deletedPage.revision }),
      method: 'POST',
    });
    expect(restored.status).toBe(200);
    const restoredPage = ((await restored.json()) as { page: PageDetail }).page;
    expect(restoredPage).toMatchObject({
      isFavorite: true,
      tags: [
        { id: project.id, name: 'Project Alpha' },
        { id: work.id, name: 'Work Notes' },
      ],
    });

    expect(
      (await request(`/api/public/publications/${firstPublication.publicId}`, {}, false)).status,
    ).toBe(404);
    const secondPublicationResponse = await request(`/api/private/pages/${page.id}/publication`, {
      body: JSON.stringify({
        baseRevision: restoredPage.revision,
        tagIds: [work.id],
      }),
      method: 'PUT',
    });
    expect(secondPublicationResponse.status).toBe(200);
    const secondPublication = (
      (await secondPublicationResponse.json()) as {
        publication: { publicId: string; tags: string[] };
      }
    ).publication;
    expect(secondPublication.tags).toEqual(['Work Notes']);

    const deletedTag = await request(`/api/private/tags/${work.id}`, { method: 'DELETE' });
    expect(deletedTag.status).toBe(200);
    const afterTagDelete = await request(`/api/private/pages/${page.id}`);
    expect(((await afterTagDelete.json()) as { page: PageDetail }).page.tags).toEqual([
      { id: project.id, name: 'Project Alpha' },
    ]);
    const retainedSnapshot = await request(
      `/api/public/publications/${secondPublication.publicId}`,
      {},
      false,
    );
    expect(retainedSnapshot.status).toBe(200);
    expect(
      ((await retainedSnapshot.json()) as { publication: { tags: string[] } }).publication.tags,
    ).toEqual(['Work Notes']);
  });
});
