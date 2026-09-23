import type { AssetRecord } from '../assets/repository';
import type { PageRecord, PageRevisionRecord } from '../pages/repository';
import type { PublicationRecord } from '../publications/repository';
import type { TagRecord } from '../tags/repository';
import type { DailyNoteRecord, TemplateRecord } from '../templates/repository';

interface PageDatabaseRow {
  search_id: number;
  id: string;
  title: string;
  slug: string;
  content_json: string;
  content_text: string;
  parent_id: string | null;
  position: number;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  is_favorite: number;
  tags_json: string;
}

interface RevisionDatabaseRow {
  id: string;
  page_id: string;
  source_revision: number;
  title: string;
  content_json: string;
  trigger: PageRevisionRecord['trigger'];
  created_at: string;
}

interface AssetDatabaseRow {
  id: string;
  object_key: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
  uploaded_for_page_id: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface PublicationDatabaseRow {
  id: string;
  page_id: string;
  public_id: string;
  source_revision: number;
  published_content_json: string;
  published_content_text: string;
  published_title: string;
  published_tags_json: string;
  allow_indexing: number;
  published_parent_public_id: string | null;
  published_position: number;
  published_at: string;
  updated_at: string;
}

interface TemplateDatabaseRow {
  id: string;
  title: string;
  content_json: string;
  revision: number;
  is_daily_note: number;
  created_at: string;
  updated_at: string;
}

interface DailyNoteDatabaseRow {
  id: string;
  local_date: string;
  time_zone: string;
  page_id: string;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RestoreSessionRecordRow {
  session_id: string;
  record_type: 'page' | 'revision' | 'publication' | 'tag' | 'template' | 'dailyNote';
  record_id: string;
  payload_json: string;
  sha256: string;
  uploaded_at: string;
}

export interface RestoreSessionAssetRow {
  session_id: string;
  asset_id: string;
  object_key: string;
  metadata_json: string;
  size_bytes: number;
  sha256: string;
  uploaded_at: string;
}

export interface RestoreSessionRow {
  id: string;
  owner_identity: string;
  status: 'uploading' | 'finalizing' | 'failed';
  backup_version: 1 | 2;
  expected_pages: number;
  expected_revisions: number;
  expected_assets: number;
  expected_tags: number;
  expected_publications: number;
  expected_templates: number;
  expected_daily_notes: number;
  expected_bytes: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

function toPageRecord(row: PageDatabaseRow): PageRecord {
  let tags: PageRecord['tags'] = [];
  try {
    const value = JSON.parse(row.tags_json) as unknown;
    if (Array.isArray(value)) {
      tags = value.filter(
        (tag): tag is PageRecord['tags'][number] =>
          typeof tag === 'object' &&
          tag !== null &&
          !Array.isArray(tag) &&
          typeof (tag as { id?: unknown }).id === 'string' &&
          typeof (tag as { name?: unknown }).name === 'string',
      );
    }
  } catch {
    tags = [];
  }
  return {
    searchId: row.search_id,
    id: row.id,
    title: row.title,
    slug: row.slug,
    contentJson: row.content_json,
    contentText: row.content_text,
    parentId: row.parent_id,
    position: row.position,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    isFavorite: row.is_favorite === 1,
    tags,
  };
}

function toRevisionRecord(row: RevisionDatabaseRow): PageRevisionRecord {
  return {
    id: row.id,
    pageId: row.page_id,
    sourceRevision: row.source_revision,
    title: row.title,
    contentJson: row.content_json,
    trigger: row.trigger,
    createdAt: row.created_at,
  };
}

function toAssetRecord(row: AssetDatabaseRow): AssetRecord {
  return {
    id: row.id,
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    uploadedForPageId: row.uploaded_for_page_id,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function toPublicationRecord(row: PublicationDatabaseRow): PublicationRecord {
  return {
    id: row.id,
    pageId: row.page_id,
    publicId: row.public_id,
    sourceRevision: row.source_revision,
    publishedContentJson: row.published_content_json,
    publishedContentText: row.published_content_text,
    publishedTitle: row.published_title,
    publishedTagsJson: row.published_tags_json,
    allowIndexing: row.allow_indexing === 1,
    publishedParentPublicId: row.published_parent_public_id,
    publishedPosition: row.published_position,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

function toTagRecord(row: {
  id: string;
  name: string;
  name_normalized: string;
  created_at: string;
  updated_at: string;
}): TagRecord {
  return {
    id: row.id,
    name: row.name,
    nameNormalized: row.name_normalized,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTemplateRecord(row: TemplateDatabaseRow): TemplateRecord {
  return {
    id: row.id,
    title: row.title,
    contentJson: row.content_json,
    revision: row.revision,
    isDailyNote: row.is_daily_note === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDailyNoteRecord(row: DailyNoteDatabaseRow): DailyNoteRecord {
  return {
    id: row.id,
    localDate: row.local_date,
    timeZone: row.time_zone,
    pageId: row.page_id,
    templateId: row.template_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const pageColumns = `
  search_id,
  id,
  title,
  slug,
  content_json,
  content_text,
  parent_id,
  position,
  revision,
  created_at,
  updated_at,
  deleted_at,
  is_favorite,
  (
    SELECT COALESCE(json_group_array(json_object('id', ordered_tags.id, 'name', ordered_tags.name)), '[]')
    FROM (
      SELECT tags.id, tags.name
      FROM page_tags
      INNER JOIN tags ON tags.id = page_tags.tag_id
      WHERE page_tags.page_id = pages.id
      ORDER BY tags.name_normalized, tags.id
    ) AS ordered_tags
  ) AS tags_json
`;

const assetColumns = `
  id,
  object_key,
  original_filename,
  mime_type,
  size_bytes,
  width,
  height,
  sha256,
  uploaded_for_page_id,
  created_at,
  deleted_at
`;

const publicationColumns = `
  id,
  page_id,
  public_id,
  source_revision,
  published_content_json,
  published_content_text,
  published_title,
  published_tags_json,
  allow_indexing,
  published_parent_public_id,
  published_position,
  published_at,
  updated_at
`;

export class BackupRepository {
  constructor(readonly db: D1Database) {}

  async listPages(): Promise<PageRecord[]> {
    const result = await this.db
      .prepare(`SELECT ${pageColumns} FROM pages ORDER BY id`)
      .all<PageDatabaseRow>();
    return result.results.map(toPageRecord);
  }

  async listRevisions(): Promise<PageRevisionRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT id, page_id, source_revision, title, content_json, trigger, created_at
         FROM page_revisions
         ORDER BY id`,
      )
      .all<RevisionDatabaseRow>();
    return result.results.map(toRevisionRecord);
  }

  async listAssets(): Promise<AssetRecord[]> {
    const result = await this.db
      .prepare(`SELECT ${assetColumns} FROM assets ORDER BY id`)
      .all<AssetDatabaseRow>();
    return result.results.map(toAssetRecord);
  }

  async listPublications(): Promise<PublicationRecord[]> {
    const result = await this.db
      .prepare(`SELECT ${publicationColumns} FROM page_publications ORDER BY id`)
      .all<PublicationDatabaseRow>();
    return result.results.map(toPublicationRecord);
  }

  async listTags(): Promise<TagRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT id, name, name_normalized, created_at, updated_at
         FROM tags
         ORDER BY name_normalized, id`,
      )
      .all<{
        id: string;
        name: string;
        name_normalized: string;
        created_at: string;
        updated_at: string;
      }>();
    return result.results.map(toTagRecord);
  }

  async listTemplates(): Promise<TemplateRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT id, title, content_json, revision, is_daily_note, created_at, updated_at
         FROM templates
         ORDER BY id`,
      )
      .all<TemplateDatabaseRow>();
    return result.results.map(toTemplateRecord);
  }

  async listDailyNotes(): Promise<DailyNoteRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT id, local_date, time_zone, page_id, template_id, created_at, updated_at
         FROM daily_notes
         ORDER BY id`,
      )
      .all<DailyNoteDatabaseRow>();
    return result.results.map(toDailyNoteRecord);
  }

  async listPublicationAssetIds(publicationId: string) {
    const result = await this.db
      .prepare(`SELECT asset_id FROM publication_assets WHERE publication_id = ? ORDER BY asset_id`)
      .bind(publicationId)
      .all<{ asset_id: string }>();
    return result.results.map((row) => row.asset_id);
  }

  async hasWorkspaceData() {
    const row = await this.db
      .prepare(
        `SELECT EXISTS(SELECT 1 FROM pages LIMIT 1) AS has_pages,
                EXISTS(SELECT 1 FROM assets LIMIT 1) AS has_assets,
                EXISTS(SELECT 1 FROM tags LIMIT 1) AS has_tags,
                EXISTS(SELECT 1 FROM templates LIMIT 1) AS has_templates,
                EXISTS(SELECT 1 FROM daily_notes LIMIT 1) AS has_daily_notes`,
      )
      .first<{
        has_pages: number;
        has_assets: number;
        has_tags: number;
        has_templates: number;
        has_daily_notes: number;
      }>();
    return (
      row !== null &&
      (row.has_pages === 1 ||
        row.has_assets === 1 ||
        row.has_tags === 1 ||
        row.has_templates === 1 ||
        row.has_daily_notes === 1)
    );
  }

  async findActiveSession() {
    return this.db
      .prepare(
        `SELECT id, owner_identity, status, backup_version, expected_pages, expected_revisions,
                expected_assets, expected_tags, expected_publications, expected_templates,
                expected_daily_notes, expected_bytes,
                created_at, updated_at, expires_at
         FROM restore_sessions
         WHERE status IN ('uploading', 'finalizing', 'failed')
         ORDER BY created_at
         LIMIT 1`,
      )
      .first<RestoreSessionRow>();
  }

  async findSession(id: string, ownerIdentity: string) {
    return this.db
      .prepare(
        `SELECT id, owner_identity, status, backup_version, expected_pages, expected_revisions,
                expected_assets, expected_tags, expected_publications, expected_templates,
                expected_daily_notes, expected_bytes,
                created_at, updated_at, expires_at
         FROM restore_sessions
         WHERE id = ? AND owner_identity = ?`,
      )
      .bind(id, ownerIdentity)
      .first<RestoreSessionRow>();
  }

  async insertSession(session: {
    id: string;
    ownerIdentity: string;
    backupVersion: 1 | 2;
    expectedPages: number;
    expectedRevisions: number;
    expectedAssets: number;
    expectedTags: number;
    expectedPublications: number;
    expectedTemplates: number;
    expectedDailyNotes: number;
    expectedBytes: number;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
  }) {
    return this.db
      .prepare(
        `INSERT INTO restore_sessions
          (id, owner_identity, status, backup_version, expected_pages, expected_revisions,
           expected_assets, expected_tags, expected_publications, expected_templates,
           expected_daily_notes, expected_bytes,
           created_at, updated_at, expires_at)
         SELECT ?, ?, 'uploading', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM restore_sessions
           WHERE status IN ('uploading', 'finalizing', 'failed')
         )`,
      )
      .bind(
        session.id,
        session.ownerIdentity,
        session.backupVersion,
        session.expectedPages,
        session.expectedRevisions,
        session.expectedAssets,
        session.expectedTags,
        session.expectedPublications,
        session.expectedTemplates,
        session.expectedDailyNotes,
        session.expectedBytes,
        session.createdAt,
        session.updatedAt,
        session.expiresAt,
      )
      .run();
  }

  async listRecords(sessionId: string) {
    const result = await this.db
      .prepare(
        `SELECT session_id, record_type, record_id, payload_json, sha256, uploaded_at
         FROM restore_session_records
         WHERE session_id = ?
         ORDER BY record_type, record_id`,
      )
      .bind(sessionId)
      .all<RestoreSessionRecordRow>();
    return result.results;
  }

  async findRecord(
    sessionId: string,
    recordType: 'page' | 'revision' | 'publication' | 'tag' | 'template' | 'dailyNote',
    recordId: string,
  ) {
    return this.db
      .prepare(
        `SELECT session_id, record_type, record_id, payload_json, sha256, uploaded_at
         FROM restore_session_records
         WHERE session_id = ? AND record_type = ? AND record_id = ?`,
      )
      .bind(sessionId, recordType, recordId)
      .first<RestoreSessionRecordRow>();
  }

  async insertRecord(record: {
    sessionId: string;
    recordType: 'page' | 'revision' | 'publication' | 'tag' | 'template' | 'dailyNote';
    recordId: string;
    payloadJson: string;
    sha256: string;
    uploadedAt: string;
  }) {
    return this.db
      .prepare(
        `INSERT INTO restore_session_records
          (session_id, record_type, record_id, payload_json, sha256, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.sessionId,
        record.recordType,
        record.recordId,
        record.payloadJson,
        record.sha256,
        record.uploadedAt,
      )
      .run();
  }

  async listSessionAssets(sessionId: string) {
    const result = await this.db
      .prepare(
        `SELECT session_id, asset_id, object_key, metadata_json, size_bytes, sha256, uploaded_at
         FROM restore_session_assets
         WHERE session_id = ?
         ORDER BY asset_id`,
      )
      .bind(sessionId)
      .all<RestoreSessionAssetRow>();
    return result.results;
  }

  async findAsset(sessionId: string, assetId: string) {
    return this.db
      .prepare(
        `SELECT session_id, asset_id, object_key, metadata_json, size_bytes, sha256, uploaded_at
         FROM restore_session_assets
         WHERE session_id = ? AND asset_id = ?`,
      )
      .bind(sessionId, assetId)
      .first<RestoreSessionAssetRow>();
  }

  async insertAsset(asset: {
    sessionId: string;
    assetId: string;
    objectKey: string;
    metadataJson: string;
    sizeBytes: number;
    sha256: string;
    uploadedAt: string;
  }) {
    return this.db
      .prepare(
        `INSERT INTO restore_session_assets
          (session_id, asset_id, object_key, metadata_json, size_bytes, sha256, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        asset.sessionId,
        asset.assetId,
        asset.objectKey,
        asset.metadataJson,
        asset.sizeBytes,
        asset.sha256,
        asset.uploadedAt,
      )
      .run();
  }

  async deleteAsset(sessionId: string, assetId: string) {
    return this.db
      .prepare('DELETE FROM restore_session_assets WHERE session_id = ? AND asset_id = ?')
      .bind(sessionId, assetId)
      .run();
  }

  async updateStatus(id: string, ownerIdentity: string, status: RestoreSessionRow['status']) {
    return this.db
      .prepare(
        `UPDATE restore_sessions
         SET status = ?, updated_at = ?
         WHERE id = ? AND owner_identity = ?`,
      )
      .bind(status, new Date().toISOString(), id, ownerIdentity)
      .run();
  }

  async deleteSession(id: string, ownerIdentity: string) {
    return this.db
      .prepare('DELETE FROM restore_sessions WHERE id = ? AND owner_identity = ?')
      .bind(id, ownerIdentity)
      .run();
  }
}
