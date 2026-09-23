/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  BACKUP_MANIFEST_FILENAME,
  backupManifestSchema,
  canonicalJson,
  sha256Hex,
} from '../../shared/backup';
import type { BackupManifest } from '../../shared/backup';
import type { PageDetail, TiptapDocument } from '../../shared/pages';
import { localDateForTimeZone, type TemplateDetail } from '../../shared/templates';
import { app } from '../index';
import { BackupService } from './service';
import { authenticatedTestBindings, createTestSession } from '../test-auth';

const testEnv = env as typeof env & { DOVARI_TEST_D1_MIGRATIONS: string };
const localEnv = authenticatedTestBindings(env);
let authCookie = '';
const createdPageIds = new Set<string>();
const createdAssetIds = new Set<string>();
const createdTagIds = new Set<string>();
const createdTemplateIds = new Set<string>();
const createdSessionIds = new Set<string>();

beforeAll(async () => {
  const migrations = JSON.parse(testEnv.DOVARI_TEST_D1_MIGRATIONS) as Array<{
    name: string;
    queries: string[];
  }>;
  await applyD1Migrations(env.DB, migrations);
  authCookie = await createTestSession(localEnv);
});

afterEach(async () => {
  for (const sessionId of createdSessionIds) {
    const staged = await env.DB.prepare(
      'SELECT object_key FROM restore_session_assets WHERE session_id = ?',
    )
      .bind(sessionId)
      .all<{ object_key: string }>();
    await env.DB.prepare('DELETE FROM restore_sessions WHERE id = ?').bind(sessionId).run();
    await Promise.all(staged.results.map((asset) => env.ASSETS.delete(asset.object_key)));
  }
  for (const pageId of createdPageIds) {
    await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId).run();
  }
  for (const tagId of createdTagIds) {
    await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(tagId).run();
  }
  for (const templateId of createdTemplateIds) {
    await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(templateId).run();
  }
  for (const assetId of createdAssetIds) {
    const asset = await env.DB.prepare('SELECT object_key FROM assets WHERE id = ?')
      .bind(assetId)
      .first<{ object_key: string }>();
    await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(assetId).run();
    if (asset) {
      await env.ASSETS.delete(asset.object_key);
    }
  }
  createdPageIds.clear();
  createdAssetIds.clear();
  createdTemplateIds.clear();
  createdSessionIds.clear();
});

function uint16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function uint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readZipEntries(bytes: Uint8Array) {
  const endOffset = bytes.length - 22;
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

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

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

async function uploadAsset(pageId: string, bytes: Uint8Array) {
  const response = await request('/api/private/assets', {
    body: bytes.buffer as ArrayBuffer,
    headers: {
      'Content-Length': String(bytes.byteLength),
      'Content-Type': 'application/octet-stream',
      'X-Dovari-Filename': encodeURIComponent('roundtrip.bin'),
      'X-Dovari-Page-Id': pageId,
    },
    method: 'POST',
  });
  expect(response.status).toBe(201);
  const assetId = ((await response.json()) as { asset: { id: string } }).asset.id;
  createdAssetIds.add(assetId);
  return assetId;
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

async function createTemplate(isDailyNote = false) {
  const content: TiptapDocument = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Backup template content' }] }],
  };
  const response = await request('/api/private/templates', {
    body: JSON.stringify({
      content,
      isDailyNote,
      title: `${isDailyNote ? 'Daily' : 'Page'} backup template ${crypto.randomUUID()}`,
    }),
    method: 'POST',
  });
  expect(response.status).toBe(201);
  const template = ((await response.json()) as { template: TemplateDetail }).template;
  createdTemplateIds.add(template.id);
  return template;
}

async function deleteWorkspace() {
  for (const pageId of createdPageIds) {
    await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId).run();
  }
  for (const tagId of createdTagIds) {
    await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(tagId).run();
  }
  for (const assetId of createdAssetIds) {
    const asset = await env.DB.prepare('SELECT object_key FROM assets WHERE id = ?')
      .bind(assetId)
      .first<{ object_key: string }>();
    await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(assetId).run();
    if (asset) {
      await env.ASSETS.delete(asset.object_key);
    }
  }
  for (const templateId of createdTemplateIds) {
    await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(templateId).run();
  }
}

describe('Dovari backup and restore', () => {
  it('round-trips pages, hierarchy, trash, revisions, links, and assets', async () => {
    const root = await createPage('Backup root');
    const child = await createPage('Backup child', root.id);
    const deleted = await createPage('Backup deleted');
    const tag = await createTag('Backup tag');
    const assignTags = await request(`/api/private/pages/${root.id}/tags`, {
      body: JSON.stringify({ tagIds: [tag.id] }),
      method: 'PUT',
    });
    expect(assignTags.status).toBe(200);
    const favorite = await request(`/api/private/pages/${root.id}/favorite`, {
      body: JSON.stringify({ isFavorite: true }),
      method: 'PUT',
    });
    expect(favorite.status).toBe(200);
    const assetBytes = new Uint8Array([4, 8, 15, 16, 23, 42]);
    const assetId = await uploadAsset(root.id, assetBytes);
    const content: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Keep this ' },
            { type: 'wikiLink', attrs: { targetPageId: child.id, targetTitle: child.title } },
            { type: 'attachment', attrs: { assetId, filename: 'roundtrip.bin' } },
          ],
        },
      ],
    };
    const save = await request(`/api/private/pages/${root.id}/content`, {
      body: JSON.stringify({ baseRevision: root.revision, content }),
      method: 'PUT',
    });
    expect(save.status).toBe(200);

    const deletedResponse = await request(`/api/private/pages/${deleted.id}`, {
      body: JSON.stringify({ baseRevision: deleted.revision }),
      method: 'DELETE',
    });
    expect(deletedResponse.status).toBe(200);

    const backupResponse = await request('/api/private/backup');
    expect(backupResponse.status).toBe(200);
    expect(backupResponse.headers.get('Content-Disposition')).toBe(
      'attachment; filename="dovari-backup-v2.zip"',
    );
    const entries = readZipEntries(new Uint8Array(await backupResponse.arrayBuffer()));
    const manifest = backupManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(entries.get(BACKUP_MANIFEST_FILENAME)!)) as unknown,
    ) as BackupManifest;
    expect(manifest.pages).toHaveLength(3);
    expect(manifest.revisions.length).toBeGreaterThanOrEqual(2);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]?.id).toBe(assetId);
    expect(manifest.tags).toEqual([expect.objectContaining({ id: tag.id, name: tag.name })]);
    expect(manifest.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: root.id, isFavorite: true, tagIds: [tag.id] }),
      ]),
    );

    await deleteWorkspace();

    const sessionResponse = await request('/api/private/restore/sessions', {
      body: JSON.stringify({
        backupVersion: 1,
        expectedAssets: manifest.assets.length,
        expectedBytes: manifest.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
        expectedPages: manifest.pages.length,
        expectedRevisions: manifest.revisions.length,
        expectedTags: manifest.tags.length,
      }),
      method: 'POST',
    });
    expect(sessionResponse.status).toBe(201);
    const session = ((await sessionResponse.json()) as { session: { id: string } }).session;
    createdSessionIds.add(session.id);

    for (const tagRecord of manifest.tags) {
      const payload = canonicalJson(tagRecord);
      const response = await request(
        `/api/private/restore/sessions/${session.id}/records/tag/${tagRecord.id}`,
        {
          body: payload,
          headers: { 'X-Dovari-SHA-256': await sha256Hex(payload) },
          method: 'PUT',
        },
      );
      expect(response.status).toBe(200);
    }
    for (const page of manifest.pages) {
      const payload = canonicalJson(page);
      const response = await request(
        `/api/private/restore/sessions/${session.id}/records/page/${page.id}`,
        {
          body: payload,
          headers: { 'X-Dovari-SHA-256': await sha256Hex(payload) },
          method: 'PUT',
        },
      );
      expect(response.status).toBe(200);
    }
    for (const revision of manifest.revisions) {
      const payload = canonicalJson(revision);
      const response = await request(
        `/api/private/restore/sessions/${session.id}/records/revision/${revision.id}`,
        {
          body: payload,
          headers: { 'X-Dovari-SHA-256': await sha256Hex(payload) },
          method: 'PUT',
        },
      );
      expect(response.status).toBe(200);
    }
    for (const asset of manifest.assets) {
      const bytes = entries.get(asset.path);
      expect(bytes).toBeDefined();
      expect(await sha256Hex(bytes!)).toBe(asset.sha256);
      const response = await request(
        `/api/private/restore/sessions/${session.id}/assets/${asset.id}`,
        {
          body: bytes!.buffer as ArrayBuffer,
          headers: {
            'Content-Length': String(bytes!.byteLength),
            'X-Dovari-Asset-Metadata': encodeBase64Url(canonicalJson(asset)),
            'X-Dovari-SHA-256': asset.sha256,
          },
          method: 'PUT',
        },
      );
      expect(response.status).toBe(200);
    }

    const finalize = await request(`/api/private/restore/sessions/${session.id}/finalize`, {
      method: 'POST',
    });
    const finalizeBody = await finalize.json();
    const sessionAfterFinalize = await env.DB.prepare(
      'SELECT status FROM restore_sessions WHERE id = ?',
    )
      .bind(session.id)
      .first<{ status: string }>();
    const pageCountAfterFinalize = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM pages',
    ).first<{
      count: number;
    }>();
    expect({ finalizeBody, pageCountAfterFinalize, sessionAfterFinalize }).toMatchObject({
      finalizeBody: { restored: true },
    });
    expect(finalize.status).toBe(200);
    expect(finalizeBody).toMatchObject({
      assetCount: 1,
      pageCount: 3,
      revisionCount: manifest.revisions.length,
      tagCount: manifest.tags.length,
    });

    const restoredRoot = await request(`/api/private/pages/${root.id}`);
    expect(restoredRoot.status).toBe(200);
    await expect(restoredRoot.json()).resolves.toMatchObject({
      page: {
        content,
        id: root.id,
        isFavorite: true,
        tags: [{ id: tag.id, name: tag.name }],
        title: root.title,
      },
    });
    const restoredTrash = await request('/api/private/trash');
    await expect(restoredTrash.json()).resolves.toMatchObject({
      pages: [expect.objectContaining({ id: deleted.id, title: deleted.title })],
    });
    await expect(
      env.DB.prepare('SELECT target_page_id FROM page_links WHERE source_page_id = ?')
        .bind(root.id)
        .all(),
    ).resolves.toMatchObject({ results: [{ target_page_id: child.id }] });
    const createdAt = new Date(manifest.assets[0]!.createdAt);
    const year = createdAt.getUTCFullYear().toString().padStart(4, '0');
    const month = (createdAt.getUTCMonth() + 1).toString().padStart(2, '0');
    await expect(env.ASSETS.get(`assets/${year}/${month}/${assetId}.bin`)).resolves.not.toBeNull();
  });

  it('round-trips v2 publications, snapshots, public ids, and publication assets', async () => {
    const page = await createPage('Public backup page');
    const assetBytes = new Uint8Array([7, 11, 13, 17]);
    const assetId = await uploadAsset(page.id, assetBytes);
    const content: TiptapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Published backup content' },
            { type: 'attachment', attrs: { assetId, filename: 'roundtrip.bin' } },
          ],
        },
      ],
    };
    const save = await request(`/api/private/pages/${page.id}/content`, {
      body: JSON.stringify({ baseRevision: page.revision, content }),
      method: 'PUT',
    });
    expect(save.status).toBe(200);
    const savedPage = ((await save.json()) as { page: PageDetail }).page;

    const publish = await request(`/api/private/pages/${page.id}/publication`, {
      body: JSON.stringify({ allowIndexing: true, baseRevision: savedPage.revision }),
      method: 'PUT',
    });
    expect(publish.status).toBe(200);

    const backupResponse = await request('/api/private/backup');
    expect(backupResponse.status).toBe(200);
    const entries = readZipEntries(new Uint8Array(await backupResponse.arrayBuffer()));
    const manifest = backupManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(entries.get(BACKUP_MANIFEST_FILENAME)!)) as unknown,
    );
    if (manifest.version !== 2) {
      throw new Error('The publication roundtrip requires a v2 backup manifest.');
    }
    expect(manifest.publications).toHaveLength(1);
    const publication = manifest.publications[0]!;
    expect(publication.pageId).toBe(page.id);
    expect(publication.assetIds).toEqual([assetId]);

    await deleteWorkspace();

    const sessionResponse = await request('/api/private/restore/sessions', {
      body: JSON.stringify({
        backupVersion: 2,
        expectedAssets: manifest.assets.length,
        expectedBytes: manifest.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
        expectedPages: manifest.pages.length,
        expectedPublications: manifest.publications.length,
        expectedRevisions: manifest.revisions.length,
      }),
      method: 'POST',
    });
    expect(sessionResponse.status).toBe(201);
    const session = ((await sessionResponse.json()) as { session: { id: string } }).session;
    createdSessionIds.add(session.id);

    for (const pageRecord of manifest.pages) {
      const payload = canonicalJson(pageRecord);
      const recordResponse = await request(
        `/api/private/restore/sessions/${session.id}/records/page/${pageRecord.id}`,
        {
          body: payload,
          headers: { 'X-Dovari-SHA-256': await sha256Hex(payload) },
          method: 'PUT',
        },
      );
      expect(recordResponse.status).toBe(200);
    }
    for (const revision of manifest.revisions) {
      const payload = canonicalJson(revision);
      const recordResponse = await request(
        `/api/private/restore/sessions/${session.id}/records/revision/${revision.id}`,
        {
          body: payload,
          headers: { 'X-Dovari-SHA-256': await sha256Hex(payload) },
          method: 'PUT',
        },
      );
      expect(recordResponse.status).toBe(200);
    }
    for (const publicationRecord of manifest.publications) {
      const payload = canonicalJson(publicationRecord);
      const recordResponse = await request(
        `/api/private/restore/sessions/${session.id}/records/publication/${publicationRecord.id}`,
        {
          body: payload,
          headers: { 'X-Dovari-SHA-256': await sha256Hex(payload) },
          method: 'PUT',
        },
      );
      expect(recordResponse.status).toBe(200);
    }
    for (const asset of manifest.assets) {
      const bytes = entries.get(asset.path);
      expect(bytes).toBeDefined();
      const recordResponse = await request(
        `/api/private/restore/sessions/${session.id}/assets/${asset.id}`,
        {
          body: bytes!.buffer as ArrayBuffer,
          headers: {
            'Content-Length': String(bytes!.byteLength),
            'X-Dovari-Asset-Metadata': encodeBase64Url(canonicalJson(asset)),
            'X-Dovari-SHA-256': asset.sha256,
          },
          method: 'PUT',
        },
      );
      expect(recordResponse.status).toBe(200);
    }

    const finalize = await request(`/api/private/restore/sessions/${session.id}/finalize`, {
      method: 'POST',
    });
    expect(finalize.status).toBe(200);
    await expect(finalize.json()).resolves.toMatchObject({
      assetCount: 1,
      pageCount: 1,
      publicationCount: 1,
      revisionCount: manifest.revisions.length,
      restored: true,
    });

    const publicResponse = await request(
      `/api/public/publications/${publication.publicId}`,
      {},
      false,
    );
    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.json()).resolves.toMatchObject({
      publication: {
        allowIndexing: true,
        content: publication.content,
        publicId: publication.publicId,
        publishedTitle: publication.publishedTitle,
      },
    });
    const publicAssetResponse = await request(
      `/api/public/publications/${publication.publicId}/assets/${assetId}/content`,
      {},
      false,
    );
    expect(publicAssetResponse.status).toBe(200);
    await expect(publicAssetResponse.arrayBuffer()).resolves.toEqual(assetBytes.buffer);
  });

  it('round-trips templates and daily-note metadata in a v2 backup', async () => {
    const pageTemplate = await createTemplate();
    const dailyTemplate = await createTemplate(true);
    const localDate = localDateForTimeZone(new Date(), 'UTC');
    const dailyNoteResponse = await request(`/api/private/daily-notes/${localDate}`, {
      body: JSON.stringify({ timeZone: 'UTC' }),
      method: 'PUT',
    });
    expect(dailyNoteResponse.status).toBe(200);
    const dailyNote = (await dailyNoteResponse.json()) as {
      dailyNote: { id: string; pageId: string; templateId: string };
      page: PageDetail;
    };
    createdPageIds.add(dailyNote.page.id);

    const backupResponse = await request('/api/private/backup');
    expect(backupResponse.status).toBe(200);
    const entries = readZipEntries(new Uint8Array(await backupResponse.arrayBuffer()));
    const manifest = backupManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(entries.get(BACKUP_MANIFEST_FILENAME)!)) as unknown,
    );
    if (manifest.version !== 2) {
      throw new Error('The template roundtrip requires a v2 backup manifest.');
    }
    expect(manifest.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pageTemplate.id, isDailyNote: false }),
        expect.objectContaining({ id: dailyTemplate.id, isDailyNote: true }),
      ]),
    );
    expect(manifest.dailyNotes).toEqual([
      expect.objectContaining({
        localDate,
        pageId: dailyNote.page.id,
        templateId: dailyTemplate.id,
      }),
    ]);

    await deleteWorkspace();

    const sessionResponse = await request('/api/private/restore/sessions', {
      body: JSON.stringify({
        backupVersion: 2,
        expectedAssets: manifest.assets.length,
        expectedBytes: 0,
        expectedDailyNotes: manifest.dailyNotes.length,
        expectedPages: manifest.pages.length,
        expectedPublications: manifest.publications.length,
        expectedRevisions: manifest.revisions.length,
        expectedTags: manifest.tags.length,
        expectedTemplates: manifest.templates.length,
      }),
      method: 'POST',
    });
    expect(sessionResponse.status).toBe(201);
    const session = ((await sessionResponse.json()) as { session: { id: string } }).session;
    createdSessionIds.add(session.id);

    async function uploadRecord(
      type: 'page' | 'revision' | 'publication' | 'tag' | 'template' | 'dailyNote',
      record: Record<string, unknown>,
    ) {
      const payload = canonicalJson(record);
      const response = await request(
        `/api/private/restore/sessions/${session.id}/records/${type}/${record.id}`,
        {
          body: payload,
          headers: { 'X-Dovari-SHA-256': await sha256Hex(payload) },
          method: 'PUT',
        },
      );
      expect(response.status).toBe(200);
    }

    for (const page of manifest.pages) await uploadRecord('page', page);
    for (const revision of manifest.revisions) await uploadRecord('revision', revision);
    for (const tag of manifest.tags) await uploadRecord('tag', tag);
    for (const publication of manifest.publications) await uploadRecord('publication', publication);
    for (const template of manifest.templates) await uploadRecord('template', template);
    for (const note of manifest.dailyNotes) await uploadRecord('dailyNote', note);

    const finalize = await request(`/api/private/restore/sessions/${session.id}/finalize`, {
      method: 'POST',
    });
    expect(finalize.status).toBe(200);
    await expect(finalize.json()).resolves.toMatchObject({
      dailyNoteCount: 1,
      pageCount: 1,
      templateCount: 2,
      restored: true,
    });

    const restoredTemplate = await request(`/api/private/templates/${pageTemplate.id}`);
    expect(restoredTemplate.status).toBe(200);
    await expect(restoredTemplate.json()).resolves.toMatchObject({
      template: { id: pageTemplate.id, title: pageTemplate.title },
    });
    const restoredDailyNote = await request(`/api/private/daily-notes/${localDate}`, {
      body: JSON.stringify({ timeZone: 'UTC' }),
      method: 'PUT',
    });
    expect(restoredDailyNote.status).toBe(200);
    await expect(restoredDailyNote.json()).resolves.toMatchObject({
      dailyNote: { id: dailyNote.dailyNote.id, templateId: dailyTemplate.id },
      page: { id: dailyNote.page.id },
    });
  });

  it('rejects incomplete backups before offering a download', async () => {
    const page = await createPage('Incomplete backup');
    const assetId = await uploadAsset(page.id, new Uint8Array([1, 2, 3]));
    const row = await env.DB.prepare('SELECT object_key FROM assets WHERE id = ?')
      .bind(assetId)
      .first<{ object_key: string }>();
    await env.ASSETS.delete(row!.object_key);

    const response = await request('/api/private/backup');
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'BACKUP_INCOMPLETE', details: { assetIds: [assetId] } },
    });
    await deleteWorkspace();
  });

  it('creates a backup when the workspace has no assets', async () => {
    const page = await createPage('No asset backup');
    const rename = await request(`/api/private/pages/${page.id}`, {
      body: JSON.stringify({ baseRevision: page.revision, title: 'Renamed no asset backup' }),
      method: 'PATCH',
    });
    expect(rename.status).toBe(200);
    const response = await request('/api/private/backup');
    expect(response.status).toBe(200);
    await new BackupService(env.DB, env.ASSETS).prepareBackup();
  });

  it('supports idempotent records, rejects mismatches, and aborts session data', async () => {
    const pageIdForSession = '33333333-3333-4333-8333-333333333333';
    const sessionResponse = await request('/api/private/restore/sessions', {
      body: JSON.stringify({
        backupVersion: 1,
        expectedAssets: 0,
        expectedBytes: 0,
        expectedPages: 1,
        expectedRevisions: 0,
      }),
      method: 'POST',
    });
    expect(sessionResponse.status).toBe(201);
    const session = ((await sessionResponse.json()) as { session: { id: string } }).session;
    createdSessionIds.add(session.id);
    const page = {
      content: { content: [], type: 'doc' as const },
      createdAt: '2026-09-13T00:00:00.000Z',
      deletedAt: null,
      id: pageIdForSession,
      parentId: null,
      position: 0,
      revision: 1,
      slug: 'staged-page',
      title: 'Staged page',
      updatedAt: '2026-09-13T00:00:00.000Z',
    };
    const payload = canonicalJson(page);
    const headers = { 'X-Dovari-SHA-256': await sha256Hex(payload) };
    const first = await request(
      `/api/private/restore/sessions/${session.id}/records/page/${pageIdForSession}`,
      { body: payload, headers, method: 'PUT' },
    );
    expect(first.status).toBe(200);
    const repeated = await request(
      `/api/private/restore/sessions/${session.id}/records/page/${pageIdForSession}`,
      { body: payload, headers, method: 'PUT' },
    );
    expect(repeated.status).toBe(200);
    const mismatch = await request(
      `/api/private/restore/sessions/${session.id}/records/page/${pageIdForSession}`,
      {
        body: canonicalJson({ ...page, title: 'Different' }),
        headers: {
          'X-Dovari-SHA-256': await sha256Hex(canonicalJson({ ...page, title: 'Different' })),
        },
        method: 'PUT',
      },
    );
    expect(mismatch.status).toBe(409);
    await expect(mismatch.json()).resolves.toMatchObject({
      error: { code: 'RESTORE_RECORD_MISMATCH' },
    });

    const secondSession = await request('/api/private/restore/sessions', {
      body: JSON.stringify({
        backupVersion: 1,
        expectedAssets: 0,
        expectedBytes: 0,
        expectedPages: 0,
        expectedRevisions: 0,
      }),
      method: 'POST',
    });
    expect(secondSession.status).toBe(409);

    const abort = await request(`/api/private/restore/sessions/${session.id}`, {
      method: 'DELETE',
    });
    expect(abort.status).toBe(200);
    await expect(abort.json()).resolves.toEqual({ deleted: true, sessionId: session.id });
    await expect(request(`/api/private/restore/sessions/${session.id}`)).resolves.toMatchObject({
      status: 404,
    });
  });
});
