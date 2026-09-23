/// <reference types="@cloudflare/vitest-plugin/types" />

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  createAssetFixture,
  createPageAssetFixture,
  createPageFixture,
  createPageLinkFixture,
} from './fixtures';
import { assets, pageAssets, pageLinks, pages } from './schema';

const db = drizzle(env.DB);
const createdPageIds = new Set<string>();
const testEnv = env as typeof env & { DOVARI_TEST_D1_MIGRATIONS: string };

beforeAll(async () => {
  const migrations = JSON.parse(testEnv.DOVARI_TEST_D1_MIGRATIONS) as Array<{
    name: string;
    queries: string[];
  }>;

  await applyD1Migrations(env.DB, migrations);
});

afterEach(async () => {
  for (const pageId of createdPageIds) {
    await env.DB.prepare('DELETE FROM page_links WHERE source_page_id = ? OR target_page_id = ?')
      .bind(pageId, pageId)
      .run();
    await env.DB.prepare('DELETE FROM page_assets WHERE page_id = ?').bind(pageId).run();
    await env.DB.prepare('DELETE FROM assets WHERE uploaded_for_page_id = ?').bind(pageId).run();
    await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId).run();
  }

  createdPageIds.clear();
});

function registerPage<T extends { id: string }>(page: T): T {
  createdPageIds.add(page.id);
  return page;
}

async function ftsRows(term: string) {
  return env.DB.prepare(
    `SELECT pages.id, pages.title
     FROM pages_fts
     INNER JOIN pages ON pages.search_id = pages_fts.rowid
     WHERE pages_fts MATCH ?
     ORDER BY pages.search_id`,
  )
    .bind(term)
    .all<{ id: string; title: string }>();
}

async function publicFtsRows(term: string) {
  return env.DB.prepare(
    `SELECT page_publications.public_id, page_publications.published_title
     FROM publications_fts
     INNER JOIN page_publications ON page_publications.rowid = publications_fts.rowid
     WHERE publications_fts MATCH ?
     ORDER BY page_publications.public_id`,
  )
    .bind(term)
    .all<{ public_id: string; published_title: string }>();
}

describe('D1 schema', () => {
  it('exposes the normal tables through Drizzle with their typed relations', async () => {
    const parent = registerPage(
      createPageFixture({ title: 'Fixture parent', slug: 'fixture-parent' }),
    );
    const child = registerPage(
      createPageFixture({
        parentId: parent.id,
        title: 'Fixture child',
        slug: 'fixture-child',
      }),
    );
    const asset = createAssetFixture({ uploadedForPageId: parent.id });

    await db.insert(pages).values([parent, child]).run();
    await db.insert(assets).values(asset).run();
    await db.insert(pageAssets).values(createPageAssetFixture(parent.id, asset.id)).run();
    await db
      .insert(pageLinks)
      .values(
        createPageLinkFixture(parent.id, {
          targetPageId: child.id,
          targetTitle: child.title,
          targetTitleNormalized: child.title.toLocaleLowerCase('en-US'),
        }),
      )
      .run();

    const storedPage = await db.select().from(pages).where(eq(pages.id, parent.id)).get();
    const storedAsset = await db.select().from(assets).where(eq(assets.id, asset.id)).get();
    const storedPageAsset = await db
      .select()
      .from(pageAssets)
      .where(eq(pageAssets.pageId, parent.id))
      .get();
    const storedPageLink = await db
      .select()
      .from(pageLinks)
      .where(eq(pageLinks.sourcePageId, parent.id))
      .get();

    expect(storedPage).toMatchObject({
      id: parent.id,
      title: 'Fixture parent',
      contentJson: '{"type":"doc","content":[]}',
      contentText: 'Fixture page content',
    });
    expect(storedAsset).toMatchObject({
      id: asset.id,
      uploadedForPageId: parent.id,
    });
    expect(storedPageAsset).toEqual({ pageId: parent.id, assetId: asset.id });
    expect(storedPageLink).toMatchObject({
      sourcePageId: parent.id,
      targetPageId: child.id,
      targetTitle: child.title,
    });

    const tableColumns = await env.DB.prepare('PRAGMA table_info(pages)').all<{
      name: string;
    }>();
    expect(tableColumns.results.map((column) => column.name)).not.toContain('content_markdown');
  });

  it('enforces foreign keys, checks, and case-insensitive uniqueness', async () => {
    const page = registerPage(
      createPageFixture({ title: 'Constraint fixture', slug: 'constraint-fixture' }),
    );
    await db.insert(pages).values(page).run();

    await expect(
      db
        .insert(pages)
        .values(createPageFixture({ title: 'Other', slug: 'CONSTRAINT-FIXTURE' }))
        .run(),
    ).rejects.toThrow();

    await expect(
      db.insert(pageAssets).values(createPageAssetFixture(page.id, 'missing-asset')).run(),
    ).rejects.toThrow();

    await expect(
      db
        .insert(pages)
        .values(createPageFixture({ title: '', slug: 'invalid-empty-title' }))
        .run(),
    ).rejects.toThrow();

    await expect(
      db
        .insert(pages)
        .values(createPageFixture({ position: -1, slug: 'invalid-position' }))
        .run(),
    ).rejects.toThrow();

    await expect(
      db
        .insert(assets)
        .values(createAssetFixture({ sizeBytes: -1 }))
        .run(),
    ).rejects.toThrow();
  });
});

describe('pages FTS5 synchronization', () => {
  it('keeps inserts, updates, soft deletes, and restores synchronized', async () => {
    const page = registerPage(
      createPageFixture({
        title: 'Cloudflare D1 fixture',
        slug: 'cloudflare-d1-fixture',
        contentText: 'Searchable worker content',
      }),
    );

    await db.insert(pages).values(page).run();

    await expect(ftsRows('Cloudflare')).resolves.toMatchObject({
      results: [{ id: page.id, title: page.title }],
    });
    await expect(ftsRows('worker')).resolves.toMatchObject({
      results: [{ id: page.id, title: page.title }],
    });

    await db
      .update(pages)
      .set({ title: 'Renamed D1 fixture', contentText: 'Updated searchable text' })
      .where(eq(pages.id, page.id))
      .run();

    await expect(ftsRows('Cloudflare')).resolves.toMatchObject({ results: [] });
    await expect(ftsRows('Updated')).resolves.toMatchObject({
      results: [{ id: page.id, title: 'Renamed D1 fixture' }],
    });

    await db
      .update(pages)
      .set({ deletedAt: '2026-09-12T01:00:00.000Z' })
      .where(eq(pages.id, page.id))
      .run();
    await expect(ftsRows('Updated')).resolves.toMatchObject({ results: [] });

    await db.update(pages).set({ deletedAt: null }).where(eq(pages.id, page.id)).run();
    await expect(ftsRows('Updated')).resolves.toMatchObject({
      results: [{ id: page.id, title: 'Renamed D1 fixture' }],
    });
  });

  it('passes SQLite foreign-key and FTS integrity checks', async () => {
    const foreignKeys = await env.DB.prepare('PRAGMA foreign_key_check').all();
    expect(foreignKeys.results).toEqual([]);

    await expect(
      env.DB.prepare("INSERT INTO pages_fts(pages_fts) VALUES ('integrity-check')").run(),
    ).resolves.toMatchObject({ success: true });
  });
});

describe('publications FTS5 synchronization', () => {
  it('indexes only publication snapshot title and plaintext and supports integrity checks', async () => {
    const page = registerPage(
      createPageFixture({ title: 'Private source title', slug: 'public-fts-fixture' }),
    );
    const publicId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await db.insert(pages).values(page).run();
    await env.DB.prepare(
      `INSERT INTO page_publications
        (id, page_id, public_id, source_revision, published_content_json,
         published_content_text, published_title, allow_indexing,
         published_parent_public_id, published_position, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        page.id,
        publicId,
        1,
        '{"type":"doc","content":[]}',
        'Public snapshot marker',
        'Published FTS title',
        0,
        null,
        0,
        '2026-09-14T00:00:00.000Z',
        '2026-09-14T00:00:00.000Z',
      )
      .run();

    await expect(publicFtsRows('snapshot')).resolves.toMatchObject({
      results: [{ public_id: publicId, published_title: 'Published FTS title' }],
    });
    await expect(publicFtsRows('Private')).resolves.toMatchObject({ results: [] });

    await env.DB.prepare(
      `UPDATE page_publications
       SET published_title = ?, published_content_text = ?
       WHERE public_id = ?`,
    )
      .bind('Renamed published title', 'Updated public marker', publicId)
      .run();
    await expect(publicFtsRows('snapshot')).resolves.toMatchObject({ results: [] });
    await expect(publicFtsRows('Updated')).resolves.toMatchObject({
      results: [{ public_id: publicId, published_title: 'Renamed published title' }],
    });

    await env.DB.prepare('DELETE FROM page_publications WHERE public_id = ?').bind(publicId).run();
    await expect(publicFtsRows('Updated')).resolves.toMatchObject({ results: [] });
    await expect(
      env.DB.prepare(
        "INSERT INTO publications_fts(publications_fts) VALUES ('integrity-check')",
      ).run(),
    ).resolves.toMatchObject({ success: true });
  });
});
