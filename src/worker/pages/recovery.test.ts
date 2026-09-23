/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type PageDetail, type PageSummary, type TiptapDocument } from '../../shared/pages';
import { app } from '../index';
import { createAssetFixture } from '../db/fixtures';
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
    await env.DB.prepare('DELETE FROM page_assets WHERE asset_id = ?').bind(assetId).run();
    await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(assetId).run();
  }

  createdPageIds.clear();
  createdAssetIds.clear();
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

async function createAsset() {
  const asset = createAssetFixture();
  await env.DB.prepare(
    `INSERT INTO assets
      (id, object_key, original_filename, mime_type, size_bytes, width, height, sha256,
       uploaded_for_page_id, created_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      asset.id,
      asset.objectKey,
      asset.originalFilename,
      asset.mimeType,
      asset.sizeBytes,
      asset.width,
      asset.height,
      asset.sha256,
      asset.uploadedForPageId,
      asset.createdAt,
      asset.deletedAt,
    )
    .run();
  createdAssetIds.add(asset.id);
  return asset.id;
}

describe('Trash and revision HTTP API', () => {
  it('snapshots successful mutations, respects the interval, and ignores conflicts', async () => {
    const page = await createPage('Snapshot page');

    const rename = await request(`/api/private/pages/${page.id}`, {
      body: JSON.stringify({ baseRevision: page.revision, title: 'Renamed snapshot page' }),
      method: 'PATCH',
    });
    expect(rename.status).toBe(200);
    const renamed = (await rename.json()) as { page: PageDetail };

    const content: TiptapDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Current content' }] }],
    };
    const save = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: renamed.page.revision, content }),
      method: 'PUT',
    });
    expect(save.status).toBe(200);
    const saved = (await save.json()) as { page: PageDetail };

    const stale = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({
        baseRevision: renamed.page.revision,
        content: { type: 'doc', content: [] },
      }),
      method: 'PUT',
    });
    expect(stale.status).toBe(409);

    const deleteResponse = await request(`/api/private/pages/${page.id}`, {
      body: JSON.stringify({ baseRevision: saved.page.revision }),
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);

    const revisions = await env.DB.prepare(
      `SELECT source_revision, title, trigger
       FROM page_revisions
       WHERE page_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
      .bind(page.id)
      .all<{ source_revision: number; title: string; trigger: string }>();
    expect(revisions.results).toEqual([
      { source_revision: 1, title: 'Snapshot page', trigger: 'interval' },
      { source_revision: 3, title: 'Renamed snapshot page', trigger: 'delete' },
    ]);

    const trashResponse = await request('/api/private/trash');
    expect(trashResponse.status).toBe(200);
    await expect(trashResponse.json()).resolves.toMatchObject({
      pages: [
        expect.objectContaining({
          deletedAt: expect.any(String),
          id: page.id,
          revision: 4,
          title: 'Renamed snapshot page',
        }),
      ],
      nextCursor: null,
    });
  });

  it('restores a revision and rebuilds asset and wiki-link references', async () => {
    const target = await createPage('Revision target');
    const page = await createPage('Revision source');
    const assetId = await createAsset();

    const firstContent: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'First version' },
            { type: 'wikiLink', attrs: { targetPageId: target.id, targetTitle: target.title } },
            { type: 'assetImage', attrs: { assetId, alt: 'first image' } },
          ],
        },
      ],
    };
    const firstSave = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: page.revision, content: firstContent }),
      method: 'PUT',
    });
    expect(firstSave.status).toBe(200);
    const first = (await firstSave.json()) as { page: PageDetail };

    await env.DB.prepare('UPDATE page_revisions SET created_at = ? WHERE page_id = ?')
      .bind('2020-01-01T00:00:00.000Z', page.id)
      .run();

    const secondContent: TiptapDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second version' }] }],
    };
    const secondSave = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: first.page.revision, content: secondContent }),
      method: 'PUT',
    });
    expect(secondSave.status).toBe(200);
    const second = (await secondSave.json()) as { page: PageDetail };

    const revisionList = (await (
      await request(`/api/private/pages/${page.id}/revisions`)
    ).json()) as {
      revisions: Array<PageSummary & { id: string; sourceRevision: number; trigger: string }>;
    };
    expect(revisionList.revisions).toHaveLength(2);
    const firstVersion = revisionList.revisions.find(
      (revision) => revision.sourceRevision === first.page.revision,
    );
    expect(firstVersion).toMatchObject({ trigger: 'interval', title: page.title });

    const restoreResponse = await request(
      `/api/private/pages/${page.id}/revisions/${firstVersion!.id}/restore`,
      {
        body: JSON.stringify({ baseRevision: second.page.revision }),
        method: 'POST',
      },
    );
    expect(restoreResponse.status).toBe(200);
    const restored = (await restoreResponse.json()) as { page: PageDetail };
    expect(restored.page).toMatchObject({
      content: firstContent,
      contentText: 'First versionRevision targetfirst image',
      revision: 4,
    });

    await expect(
      env.DB.prepare('SELECT asset_id FROM page_assets WHERE page_id = ?').bind(page.id).all(),
    ).resolves.toMatchObject({ results: [{ asset_id: assetId }] });
    await expect(
      env.DB.prepare('SELECT target_page_id FROM page_links WHERE source_page_id = ?')
        .bind(page.id)
        .all(),
    ).resolves.toMatchObject({ results: [{ target_page_id: target.id }] });
  });

  it('restores deleted pages to an active parent or the root and permanently deletes only trash', async () => {
    const parent = await createPage('Recovery parent');
    const child = await createPage('Recovery child', parent.id);

    const deleteChild = await request(`/api/private/pages/${child.id}`, {
      body: JSON.stringify({ baseRevision: child.revision }),
      method: 'DELETE',
    });
    expect(deleteChild.status).toBe(200);
    const deletedChild = (await deleteChild.json()) as { page: PageDetail };

    const restoreChild = await request(`/api/private/pages/${child.id}/restore`, {
      body: JSON.stringify({ baseRevision: deletedChild.page.revision }),
      method: 'POST',
    });
    expect(restoreChild.status).toBe(200);
    const restoredChild = (await restoreChild.json()) as { page: PageDetail };
    expect(restoredChild.page).toMatchObject({
      parentId: parent.id,
      position: 0,
      revision: 3,
    });

    const deleteParent = await request(`/api/private/pages/${parent.id}`, {
      body: JSON.stringify({ baseRevision: parent.revision }),
      method: 'DELETE',
    });
    expect(deleteParent.status).toBe(200);
    const deletedParent = (await deleteParent.json()) as { page: PageDetail };

    const permanentWhileActive = await request(`/api/private/pages/${child.id}/permanent`, {
      body: JSON.stringify({ baseRevision: 3, confirmationTitle: 'Recovery child' }),
      method: 'DELETE',
    });
    expect(permanentWhileActive.status).toBe(422);
    await expect(permanentWhileActive.json()).resolves.toMatchObject({
      error: { code: 'PAGE_NOT_DELETED' },
    });

    const restoreParent = await request(`/api/private/pages/${parent.id}/restore`, {
      body: JSON.stringify({ baseRevision: deletedParent.page.revision }),
      method: 'POST',
    });
    expect(restoreParent.status).toBe(200);

    const deleteAgain = await request(`/api/private/pages/${child.id}`, {
      body: JSON.stringify({ baseRevision: 3 }),
      method: 'DELETE',
    });
    expect(deleteAgain.status).toBe(200);
    const deletedAgain = (await deleteAgain.json()) as { page: PageDetail };

    const permanent = await request(`/api/private/pages/${child.id}/permanent`, {
      body: JSON.stringify({
        baseRevision: deletedAgain.page.revision,
        confirmationTitle: 'Recovery child',
      }),
      method: 'DELETE',
    });
    expect(permanent.status).toBe(200);
    await expect(permanent.json()).resolves.toEqual({ deleted: true, pageId: child.id });
    await expect(
      env.DB.prepare('SELECT id FROM pages WHERE id = ?').bind(child.id).first(),
    ).resolves.toBeNull();
    await expect(
      env.DB.prepare('SELECT id FROM page_revisions WHERE page_id = ?').bind(child.id).all(),
    ).resolves.toMatchObject({ results: [] });
  });
});
