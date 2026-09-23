/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  MAX_PAGE_ROW_BYTES,
  type PageDetail,
  type PageSummary,
  type TiptapDocument,
} from '../../shared/pages';
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

async function createAsset(deletedAt: string | null = null) {
  const asset = createAssetFixture({ deletedAt });
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
  createdAssetKeys.add(asset.objectKey);
  return asset.id;
}

describe('Pages HTTP API', () => {
  it('supports list, create, detail, metadata update, content update, and soft delete', async () => {
    const created = await createPage('Getting Started');

    expect(created).toMatchObject({
      content: { content: [], type: 'doc' },
      contentText: '',
      position: 0,
      revision: 1,
      slug: 'getting-started',
      title: 'Getting Started',
    });

    const listResponse = await request('/api/private/pages');
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { pages: Array<Record<string, unknown>> };
    expect(list.pages).toHaveLength(1);
    expect(list.pages[0]).toEqual({
      id: created.id,
      isFavorite: false,
      parentId: null,
      position: 0,
      revision: 1,
      slug: 'getting-started',
      title: 'Getting Started',
      tags: [],
      updatedAt: created.updatedAt,
    });
    expect(list.pages[0]).not.toHaveProperty('content');

    const detailResponse = await request(`/api/private/pages/${created.id}`);
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      page: { id: created.id, contentText: '', revision: 1 },
    });

    const renameResponse = await request(`/api/private/pages/${created.id}`, {
      body: JSON.stringify({ baseRevision: 1, title: 'Renamed Page' }),
      method: 'PATCH',
    });
    expect(renameResponse.status).toBe(200);
    const renamed = (await renameResponse.json()) as { page: PageDetail };
    expect(renamed.page).toMatchObject({
      revision: 2,
      slug: 'renamed-page',
      title: 'Renamed Page',
    });

    const content: TiptapDocument = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hello' }] },
        {
          type: 'paragraph',
          content: [{ marks: [{ type: 'bold' }], text: 'world', type: 'text' }],
        },
      ],
    };
    const contentResponse = await request(`/api/private/pages/${created.id}/content`, {
      body: JSON.stringify({ baseRevision: 2, content }),
      method: 'PUT',
    });
    expect(contentResponse.status).toBe(200);
    const updated = (await contentResponse.json()) as { page: PageDetail };
    expect(updated.page).toMatchObject({
      content,
      contentText: 'Hello\nworld',
      revision: 3,
    });

    const deleteResponse = await request(`/api/private/pages/${created.id}`, {
      body: JSON.stringify({ baseRevision: 3 }),
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);
    const deleted = (await deleteResponse.json()) as { page: PageDetail };
    expect(deleted.page.deletedAt).toEqual(expect.any(String));
    expect(deleted.page.revision).toBe(4);

    expect((await request(`/api/private/pages/${created.id}`)).status).toBe(404);
    const afterDelete = (await (await request('/api/private/pages')).json()) as {
      pages: Array<{ id: string }>;
    };
    expect(afterDelete.pages).toEqual([]);
  });

  it('atomically synchronizes page asset references while retaining removed assets', async () => {
    const page = await createPage('Asset references');
    const firstAssetId = await createAsset();
    const secondAssetId = await createAsset();
    const secondAsset = await env.DB.prepare('SELECT object_key FROM assets WHERE id = ?')
      .bind(secondAssetId)
      .first<{ object_key: string }>();
    expect(secondAsset).not.toBeNull();
    await env.ASSETS.put(secondAsset!.object_key, 'retained asset');

    const firstContent: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'assetImage', attrs: { assetId: firstAssetId, alt: 'Screenshot' } },
            { type: 'attachment', attrs: { assetId: secondAssetId, filename: 'notes.txt' } },
            { type: 'assetImage', attrs: { assetId: firstAssetId, alt: 'Duplicate' } },
          ],
        },
      ],
    };

    const firstSave = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: page.revision, content: firstContent }),
      method: 'PUT',
    });
    expect(firstSave.status).toBe(200);

    const firstReferences = await env.DB.prepare(
      'SELECT asset_id FROM page_assets WHERE page_id = ? ORDER BY asset_id',
    )
      .bind(page.id)
      .all<{ asset_id: string }>();
    expect(firstReferences.results.map((row) => row.asset_id).sort()).toEqual(
      [firstAssetId, secondAssetId].sort(),
    );

    const secondContent: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'assetImage', attrs: { assetId: firstAssetId, alt: 'Kept' } }],
        },
      ],
    };
    const secondSave = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: 2, content: secondContent }),
      method: 'PUT',
    });
    expect(secondSave.status).toBe(200);

    const secondReferences = await env.DB.prepare(
      'SELECT asset_id FROM page_assets WHERE page_id = ?',
    )
      .bind(page.id)
      .all<{ asset_id: string }>();
    expect(secondReferences.results).toEqual([{ asset_id: firstAssetId }]);
    await expect(
      env.DB.prepare('SELECT id FROM assets WHERE id = ?').bind(secondAssetId).first(),
    ).resolves.toEqual({ id: secondAssetId });
    await expect(env.ASSETS.head(secondAsset!.object_key)).resolves.not.toBeNull();
  });

  it('atomically derives stable page links and exposes backlinks', async () => {
    const target = await createPage('Wiki target');
    const source = await createPage('Wiki source');
    const unresolvedTitle = 'A page to create later';
    const content: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'wikiLink',
              attrs: { targetPageId: target.id, targetTitle: target.title },
            },
            {
              type: 'wikiLink',
              attrs: { targetPageId: null, targetTitle: unresolvedTitle },
            },
            {
              type: 'wikiLink',
              attrs: { targetPageId: target.id, targetTitle: target.title },
            },
          ],
        },
      ],
    };

    const saveResponse = await request(`/api/private/pages/${source.id}/content`, {
      body: JSON.stringify({ baseRevision: source.revision, content }),
      method: 'PUT',
    });
    expect(saveResponse.status).toBe(200);

    const links = await env.DB.prepare(
      `SELECT target_page_id, target_title, target_title_normalized
       FROM page_links
       WHERE source_page_id = ?
       ORDER BY target_title_normalized`,
    )
      .bind(source.id)
      .all<{
        target_page_id: string | null;
        target_title: string;
        target_title_normalized: string;
      }>();
    expect(links.results).toEqual([
      {
        target_page_id: null,
        target_title: unresolvedTitle,
        target_title_normalized: 'a page to create later',
      },
      {
        target_page_id: target.id,
        target_title: target.title,
        target_title_normalized: 'wiki target',
      },
    ]);

    const backlinksResponse = await request(`/api/private/pages/${target.id}/backlinks`);
    expect(backlinksResponse.status).toBe(200);
    await expect(backlinksResponse.json()).resolves.toMatchObject({
      backlinks: [expect.objectContaining({ id: source.id, title: source.title })],
    });

    const renamedTargetResponse = await request(`/api/private/pages/${target.id}`, {
      body: JSON.stringify({ baseRevision: target.revision, title: 'Renamed wiki target' }),
      method: 'PATCH',
    });
    expect(renamedTargetResponse.status).toBe(200);

    const storedSource = (await (await request(`/api/private/pages/${source.id}`)).json()) as {
      page: PageDetail;
    };
    expect(storedSource.page.content).toEqual({
      ...content,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'wikiLink',
              attrs: { targetPageId: target.id, targetTitle: 'Renamed wiki target' },
            },
            {
              type: 'wikiLink',
              attrs: { targetPageId: null, targetTitle: unresolvedTitle },
            },
            {
              type: 'wikiLink',
              attrs: { targetPageId: target.id, targetTitle: 'Renamed wiki target' },
            },
          ],
        },
      ],
    });

    const clearedContent: TiptapDocument = { type: 'doc', content: [{ type: 'paragraph' }] };
    const clearResponse = await request(`/api/private/pages/${source.id}/content`, {
      body: JSON.stringify({ baseRevision: 2, content: clearedContent }),
      method: 'PUT',
    });
    expect(clearResponse.status).toBe(200);
    await expect(
      env.DB.prepare('SELECT id FROM page_links WHERE source_page_id = ?').bind(source.id).all(),
    ).resolves.toMatchObject({ results: [] });
  });

  it('searches active page titles for wiki-link autocomplete', async () => {
    const matching = await createPage('Cloudflare Workers');
    await createPage('Cloudflare R2');
    const deleted = await createPage('Cloudflare D1');
    const deleteResponse = await request(`/api/private/pages/${deleted.id}`, {
      body: JSON.stringify({ baseRevision: deleted.revision }),
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);

    const response = await request('/api/private/wiki-links?q=cloudfl&limit=10');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      pages: Array<PageSummary & { content?: unknown }>;
    };
    expect(body.pages.map((page) => page.title)).toEqual(['Cloudflare R2', matching.title]);
    expect(body.pages.every((page) => page.content === undefined)).toBe(true);
  });

  it('keeps references stable when a stale content save races with a confirmed save', async () => {
    const page = await createPage('Asset conflict');
    const assetId = await createAsset();
    const content: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'assetImage', attrs: { assetId, alt: 'Current' } }],
        },
      ],
    };

    const currentSave = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: page.revision, content }),
      method: 'PUT',
    });
    expect(currentSave.status).toBe(200);

    const staleSave = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: page.revision, content: { type: 'doc', content: [] } }),
      method: 'PUT',
    });
    expect(staleSave.status).toBe(409);

    const references = await env.DB.prepare('SELECT asset_id FROM page_assets WHERE page_id = ?')
      .bind(page.id)
      .all<{ asset_id: string }>();
    expect(references.results).toEqual([{ asset_id: assetId }]);
  });

  it('preserves documents with deleted or unavailable assets for readable recovery', async () => {
    const page = await createPage('Missing asset');
    const deletedAssetId = await createAsset('2026-09-13T00:00:00.000Z');
    const unavailableAssetId = crypto.randomUUID();
    const content: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'assetImage', attrs: { assetId: deletedAssetId, alt: 'Deleted image' } },
            { type: 'attachment', attrs: { assetId: unavailableAssetId, filename: 'missing.txt' } },
          ],
        },
      ],
    };

    const response = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: page.revision, content }),
      method: 'PUT',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ page: { content, revision: 2 } });

    const references = await env.DB.prepare('SELECT asset_id FROM page_assets WHERE page_id = ?')
      .bind(page.id)
      .all<{ asset_id: string }>();
    expect(references.results).toEqual([{ asset_id: deletedAssetId }]);
  });

  it('generates unique slugs and positions children after their siblings', async () => {
    const parent = await createPage('Project Notes');
    const duplicate = await createPage('Project Notes');
    const child = await createPage('First Child', parent.id);

    expect(duplicate.slug).toBe('project-notes-2');
    expect(child).toMatchObject({ parentId: parent.id, position: 0 });

    const list = (await (await request('/api/private/pages')).json()) as {
      pages: PageDetail[];
    };
    expect(list.pages.map((page) => page.id)).toEqual([parent.id, duplicate.id, child.id]);
  });

  it('moves pages before, after, and into siblings while normalizing positions', async () => {
    const first = await createPage('First');
    const second = await createPage('Second');
    const third = await createPage('Third');
    const child = await createPage('Child', first.id);

    const moveAfter = await request(`/api/private/pages/${second.id}/move`, {
      body: JSON.stringify({ afterId: third.id, parentId: null }),
      method: 'POST',
    });
    expect(moveAfter.status).toBe(200);
    expect(((await moveAfter.json()) as { page: PageDetail }).page).toMatchObject({
      id: second.id,
      parentId: null,
      position: 2,
      revision: 2,
    });

    const moveBefore = await request(`/api/private/pages/${second.id}/move`, {
      body: JSON.stringify({ beforeId: first.id, parentId: null }),
      method: 'POST',
    });
    expect(moveBefore.status).toBe(200);
    expect(((await moveBefore.json()) as { page: PageDetail }).page).toMatchObject({
      id: second.id,
      parentId: null,
      position: 0,
      revision: 3,
    });

    const moveInto = await request(`/api/private/pages/${third.id}/move`, {
      body: JSON.stringify({ parentId: first.id }),
      method: 'POST',
    });
    expect(moveInto.status).toBe(200);
    expect(((await moveInto.json()) as { page: PageDetail }).page).toMatchObject({
      id: third.id,
      parentId: first.id,
      position: 1,
      revision: 4,
    });

    const list = (await (await request('/api/private/pages')).json()) as {
      pages: PageSummary[];
    };
    expect(
      list.pages
        .filter((page) => page.parentId === null)
        .sort((a, b) => a.position - b.position)
        .map((page) => [page.id, page.position]),
    ).toEqual([
      [second.id, 0],
      [first.id, 1],
    ]);
    expect(
      list.pages
        .filter((page) => page.parentId === first.id)
        .sort((a, b) => a.position - b.position)
        .map((page) => [page.id, page.position]),
    ).toEqual([
      [child.id, 0],
      [third.id, 1],
    ]);
  });

  it('rejects self and descendant cycles and invalid move targets', async () => {
    const parent = await createPage('Cycle parent');
    const child = await createPage('Cycle child', parent.id);
    const grandchild = await createPage('Cycle grandchild', child.id);
    const other = await createPage('Other root');

    const selfMove = await request(`/api/private/pages/${parent.id}/move`, {
      body: JSON.stringify({ parentId: parent.id }),
      method: 'POST',
    });
    expect(selfMove.status).toBe(422);
    await expect(selfMove.json()).resolves.toMatchObject({ error: { code: 'PAGE_CYCLE' } });

    const descendantMove = await request(`/api/private/pages/${parent.id}/move`, {
      body: JSON.stringify({ parentId: grandchild.id }),
      method: 'POST',
    });
    expect(descendantMove.status).toBe(422);
    await expect(descendantMove.json()).resolves.toMatchObject({
      error: { code: 'PAGE_CYCLE' },
    });

    const invalidTarget = await request(`/api/private/pages/${child.id}/move`, {
      body: JSON.stringify({ beforeId: other.id, parentId: parent.id }),
      method: 'POST',
    });
    expect(invalidTarget.status).toBe(422);
    await expect(invalidTarget.json()).resolves.toMatchObject({
      error: { code: 'MOVE_TARGET_INVALID' },
    });
  });

  it('rejects stale writes without overwriting the current page', async () => {
    const page = await createPage('Conflict Test');
    const content: TiptapDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ text: 'new value', type: 'text' }] }],
    };

    const firstWrite = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: page.revision, content }),
      method: 'PUT',
    });
    expect(firstWrite.status).toBe(200);

    const staleWrite = await request(`/api/private/pages/${page.id}`, {
      body: JSON.stringify({ baseRevision: page.revision, title: 'Stale title' }),
      method: 'PATCH',
    });
    expect(staleWrite.status).toBe(409);
    await expect(staleWrite.json()).resolves.toMatchObject({
      error: {
        code: 'PAGE_CONFLICT',
        details: { currentRevision: 2 },
      },
    });

    const detail = (await (await request(`/api/private/pages/${page.id}`)).json()) as {
      page: PageDetail;
    };
    expect(detail.page).toMatchObject({
      contentText: 'new value',
      revision: 2,
      title: 'Conflict Test',
    });
  });

  it('keeps sibling positions contiguous after delete and create', async () => {
    const parent = await createPage('Position parent');
    const first = await createPage('First child', parent.id);
    const second = await createPage('Second child', parent.id);
    const third = await createPage('Third child', parent.id);

    const deleteResponse = await request(`/api/private/pages/${second.id}`, {
      body: JSON.stringify({ baseRevision: second.revision }),
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);

    const fourth = await createPage('Fourth child', parent.id);
    const list = (await (await request('/api/private/pages')).json()) as {
      pages: PageSummary[];
    };
    expect(
      list.pages
        .filter((page) => page.parentId === parent.id)
        .sort((a, b) => a.position - b.position)
        .map((page) => [page.id, page.position]),
    ).toEqual([
      [first.id, 0],
      [third.id, 1],
      [fourth.id, 2],
    ]);
  });

  it('rejects invalid documents and rows that exceed the D1 safety limit', async () => {
    const page = await createPage('Validation Test');

    const invalidDocument = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({
        baseRevision: page.revision,
        content: {
          content: [{ type: 'html', content: [], attrs: { html: '<script>' } }],
          type: 'doc',
        },
      }),
      method: 'PUT',
    });
    expect(invalidDocument.status).toBe(422);
    await expect(invalidDocument.json()).resolves.toMatchObject({
      error: { code: 'INVALID_DOCUMENT' },
    });

    const invalidRequest = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: '1', content: { content: [], type: 'doc' } }),
      method: 'PUT',
    });
    expect(invalidRequest.status).toBe(400);
    await expect(invalidRequest.json()).resolves.toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });

    const tooLarge = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({
        baseRevision: page.revision,
        content: {
          content: [
            {
              content: [{ text: 'x'.repeat(MAX_PAGE_ROW_BYTES), type: 'text' }],
              type: 'paragraph',
            },
          ],
          type: 'doc',
        },
      }),
      method: 'PUT',
    });
    expect(tooLarge.status).toBe(413);
    await expect(tooLarge.json()).resolves.toMatchObject({
      error: { code: 'PAGE_TOO_LARGE' },
    });
  });

  it('derives stable plaintext for semantic blocks and rejects unsafe document structures', async () => {
    const page = await createPage('Derivation Test');

    const semanticContent: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ' },
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
              text: 'the docs',
            },
            { type: 'hardBreak' },
            { type: 'text', text: 'next' },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const answer = 42;' }],
        },
      ],
    };

    const validResponse = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: page.revision, content: semanticContent }),
      method: 'PUT',
    });
    expect(validResponse.status).toBe(200);
    await expect(validResponse.json()).resolves.toMatchObject({
      page: { contentText: 'Done\nRead the docs\nnext\nconst answer = 42;', revision: 2 },
    });

    const invalidStructures = [
      {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'not an item' }] }],
          },
        ],
      },
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                text: 'unsafe',
              },
            ],
          },
        ],
      },
    ];

    for (const content of invalidStructures) {
      const invalidResponse = await request(`/api/private/pages/${page.id}/content`, {
        body: JSON.stringify({ baseRevision: 2, content }),
        method: 'PUT',
      });
      expect(invalidResponse.status).toBe(422);
      await expect(invalidResponse.json()).resolves.toMatchObject({
        error: { code: 'INVALID_DOCUMENT' },
      });
    }
  });
});
