import type { AssetRecord } from '../assets/repository';

export interface PublicationRecord {
  id: string;
  pageId: string;
  publicId: string;
  sourceRevision: number;
  publishedContentJson: string;
  publishedContentText: string;
  publishedTitle: string;
  publishedTagsJson: string;
  allowIndexing: boolean;
  publishedParentPublicId: string | null;
  publishedPosition: number;
  publishedAt: string;
  updatedAt: string;
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

const PUBLICATION_COLUMNS = `
  page_publications.id AS id,
  page_publications.page_id AS page_id,
  page_publications.public_id AS public_id,
  page_publications.source_revision AS source_revision,
  page_publications.published_content_json AS published_content_json,
  page_publications.published_content_text AS published_content_text,
  page_publications.published_title AS published_title,
  page_publications.published_tags_json AS published_tags_json,
  page_publications.allow_indexing AS allow_indexing,
  page_publications.published_parent_public_id AS published_parent_public_id,
  page_publications.published_position AS published_position,
  page_publications.published_at AS published_at,
  page_publications.updated_at AS updated_at
`;

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

export interface PublicationAssetRow extends AssetRecord {
  publicationId: string;
}

interface PublicationAssetDatabaseRow {
  publication_id: string;
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

function toPublicationAssetRecord(row: PublicationAssetDatabaseRow): PublicationAssetRow {
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
    publicationId: row.publication_id,
  };
}

export interface PublicationCursor {
  timestamp: string;
  publicId: string;
}

export interface PublicationWriteInput {
  id: string;
  pageId: string;
  publicId: string;
  sourceRevision: number;
  publishedContentJson: string;
  publishedContentText: string;
  publishedTitle: string;
  publishedTagsJson: string;
  allowIndexing: boolean;
  publishedParentPublicId: string | null;
  publishedPosition: number;
  publishedAt: string;
  updatedAt: string;
  assetIds: string[];
}

function currentPagesCondition(inputs: readonly PublicationWriteInput[]) {
  const pageIds = inputs.map((input) => input.pageId);
  const pageIdPlaceholders = pageIds.map(() => '?').join(', ');
  const mismatches = inputs.map(() => '(id = ? AND revision <> ?)').join(' OR ');

  return {
    sql: `(SELECT COUNT(*) FROM pages
             WHERE id IN (${pageIdPlaceholders}) AND deleted_at IS NULL) = ?
           AND NOT EXISTS (
             SELECT 1 FROM pages WHERE ${mismatches}
           )`,
    bindings: [
      ...pageIds,
      pageIds.length,
      ...inputs.flatMap((input) => [input.pageId, input.sourceRevision]),
    ],
  };
}

export class PublicationRepository {
  constructor(readonly db: D1Database) {}

  async findByPageId(pageId: string, includeDeletedPage = false) {
    const pageClause = includeDeletedPage ? '' : ' AND pages.deleted_at IS NULL';
    const row = await this.db
      .prepare(
        `SELECT ${PUBLICATION_COLUMNS}
         FROM page_publications
         INNER JOIN pages ON pages.id = page_publications.page_id
         WHERE page_publications.page_id = ?${pageClause}`,
      )
      .bind(pageId)
      .first<PublicationDatabaseRow>();
    return row ? toPublicationRecord(row) : null;
  }

  async findByPublicId(publicId: string) {
    const row = await this.db
      .prepare(
        `SELECT ${PUBLICATION_COLUMNS}
         FROM page_publications
         INNER JOIN pages ON pages.id = page_publications.page_id
         WHERE page_publications.public_id = ? AND pages.deleted_at IS NULL`,
      )
      .bind(publicId)
      .first<PublicationDatabaseRow>();
    return row ? toPublicationRecord(row) : null;
  }

  async listPublications(cursor: PublicationCursor | null, limit: number) {
    const cursorClause =
      cursor === null
        ? ''
        : ' AND (page_publications.updated_at < ? OR (page_publications.updated_at = ? AND page_publications.public_id < ?))';
    const bindings =
      cursor === null ? [limit] : [cursor.timestamp, cursor.timestamp, cursor.publicId, limit];
    const result = await this.db
      .prepare(
        `SELECT ${PUBLICATION_COLUMNS}
         FROM page_publications
         INNER JOIN pages ON pages.id = page_publications.page_id
         WHERE pages.deleted_at IS NULL${cursorClause}
         ORDER BY page_publications.updated_at DESC, page_publications.public_id DESC
         LIMIT ?`,
      )
      .bind(...bindings)
      .all<PublicationDatabaseRow>();
    return result.results.map(toPublicationRecord);
  }

  async listActivePublications() {
    const result = await this.db
      .prepare(
        `SELECT ${PUBLICATION_COLUMNS}
         FROM page_publications
         INNER JOIN pages ON pages.id = page_publications.page_id
         WHERE pages.deleted_at IS NULL
         ORDER BY page_publications.published_position ASC,
                  page_publications.published_title COLLATE NOCASE ASC,
                  page_publications.public_id ASC`,
      )
      .all<PublicationDatabaseRow>();
    return result.results.map(toPublicationRecord);
  }

  async findNearestPublishedAncestor(pageId: string) {
    const row = await this.db
      .prepare(
        `WITH RECURSIVE ancestors(page_id, depth) AS (
           SELECT parent_id, 1
           FROM pages
           WHERE id = ? AND deleted_at IS NULL AND parent_id IS NOT NULL
           UNION ALL
           SELECT pages.parent_id, ancestors.depth + 1
           FROM ancestors
           INNER JOIN pages ON pages.id = ancestors.page_id
           WHERE pages.deleted_at IS NULL
             AND pages.parent_id IS NOT NULL
             AND ancestors.depth < 100
         )
         SELECT page_publications.public_id
         FROM ancestors
         INNER JOIN page_publications ON page_publications.page_id = ancestors.page_id
         INNER JOIN pages ON pages.id = page_publications.page_id
         WHERE pages.deleted_at IS NULL
         ORDER BY ancestors.depth ASC
         LIMIT 1`,
      )
      .bind(pageId)
      .first<{ public_id: string }>();
    return row?.public_id ?? null;
  }

  async findActiveTargetsByPageIds(pageIds: string[]) {
    const publications = new Map<string, PublicationRecord>();
    for (let offset = 0; offset < pageIds.length; offset += 900) {
      const chunk = pageIds.slice(offset, offset + 900);
      if (chunk.length === 0) continue;
      const placeholders = chunk.map(() => '?').join(', ');
      const result = await this.db
        .prepare(
          `SELECT ${PUBLICATION_COLUMNS}
           FROM page_publications
           INNER JOIN pages ON pages.id = page_publications.page_id
           WHERE pages.deleted_at IS NULL AND page_publications.page_id IN (${placeholders})`,
        )
        .bind(...chunk)
        .all<PublicationDatabaseRow>();
      result.results.forEach((row) => publications.set(row.page_id, toPublicationRecord(row)));
    }
    return publications;
  }

  async listAll() {
    const result = await this.db
      .prepare(`SELECT ${PUBLICATION_COLUMNS} FROM page_publications ORDER BY id`)
      .all<PublicationDatabaseRow>();
    return result.results.map(toPublicationRecord);
  }

  async listAssetIds(publicationId: string) {
    const result = await this.db
      .prepare(
        `SELECT asset_id
         FROM publication_assets
         WHERE publication_id = ?
         ORDER BY asset_id`,
      )
      .bind(publicationId)
      .all<{ asset_id: string }>();
    return result.results.map((row) => row.asset_id);
  }

  async findAsset(publicId: string, assetId: string) {
    const result = await this.db
      .prepare(
        `SELECT
           publication_assets.publication_id,
           assets.id,
           assets.object_key,
           assets.original_filename,
           assets.mime_type,
           assets.size_bytes,
           assets.width,
           assets.height,
           assets.sha256,
           assets.uploaded_for_page_id,
           assets.created_at,
           assets.deleted_at
         FROM publication_assets
         INNER JOIN page_publications
           ON page_publications.id = publication_assets.publication_id
         INNER JOIN pages ON pages.id = page_publications.page_id
         INNER JOIN assets ON assets.id = publication_assets.asset_id
         WHERE page_publications.public_id = ?
           AND publication_assets.asset_id = ?
           AND pages.deleted_at IS NULL
           AND assets.deleted_at IS NULL`,
      )
      .bind(publicId, assetId)
      .first<PublicationAssetDatabaseRow>();
    return result ? toPublicationAssetRecord(result) : null;
  }

  async publishMany(inputs: readonly PublicationWriteInput[]) {
    if (inputs.length === 0) return 0;

    const currentPages = currentPagesCondition(inputs);
    const statements: D1PreparedStatement[] = [];
    const publicationChangeIndexes: number[] = [];

    for (const input of inputs) {
      publicationChangeIndexes.push(statements.length);
      statements.push(
        this.db
          .prepare(
            `UPDATE page_publications
             SET public_id = ?, source_revision = ?, published_content_json = ?,
                 published_content_text = ?, published_title = ?, published_tags_json = ?,
                 allow_indexing = ?,
                 published_parent_public_id = ?, published_position = ?,
                 published_at = ?, updated_at = ?
             WHERE page_id = ? AND ${currentPages.sql}`,
          )
          .bind(
            input.publicId,
            input.sourceRevision,
            input.publishedContentJson,
            input.publishedContentText,
            input.publishedTitle,
            input.publishedTagsJson,
            input.allowIndexing ? 1 : 0,
            input.publishedParentPublicId,
            input.publishedPosition,
            input.publishedAt,
            input.updatedAt,
            input.pageId,
            ...currentPages.bindings,
          ),
      );
      publicationChangeIndexes.push(statements.length);
      statements.push(
        this.db
          .prepare(
            `INSERT INTO page_publications
               (id, page_id, public_id, source_revision, published_content_json,
                published_content_text, published_title, published_tags_json, allow_indexing,
                published_parent_public_id, published_position, published_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM page_publications WHERE page_id = ?)
               AND ${currentPages.sql}`,
          )
          .bind(
            input.id,
            input.pageId,
            input.publicId,
            input.sourceRevision,
            input.publishedContentJson,
            input.publishedContentText,
            input.publishedTitle,
            input.publishedTagsJson,
            input.allowIndexing ? 1 : 0,
            input.publishedParentPublicId,
            input.publishedPosition,
            input.publishedAt,
            input.updatedAt,
            input.pageId,
            ...currentPages.bindings,
          ),
      );
      statements.push(
        this.db
          .prepare(
            `DELETE FROM publication_assets
             WHERE publication_id = ? AND ${currentPages.sql}`,
          )
          .bind(input.id, ...currentPages.bindings),
      );

      for (const assetId of input.assetIds) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO publication_assets (publication_id, asset_id)
               SELECT ?, ?
               WHERE ${currentPages.sql}
                 AND EXISTS (
                   SELECT 1 FROM page_publications
                   WHERE id = ? AND page_id = ?
                 )
                 AND EXISTS (
                   SELECT 1 FROM assets
                   WHERE id = ? AND deleted_at IS NULL
                 )`,
            )
            .bind(input.id, assetId, ...currentPages.bindings, input.id, input.pageId, assetId),
        );
      }
    }

    const results = await this.db.batch(statements);
    return publicationChangeIndexes.reduce(
      (changes, index) => changes + (results[index]?.meta.changes ?? 0),
      0,
    );
  }

  async unpublishSubtree(pageId: string, publicId: string, expectedUpdatedAt: string) {
    const result = await this.db
      .prepare(
        `WITH RECURSIVE subtree(page_id) AS (
           SELECT id
           FROM pages
           WHERE id = ? AND deleted_at IS NULL
           UNION ALL
           SELECT child.id
           FROM pages AS child
           INNER JOIN subtree ON subtree.page_id = child.parent_id
           WHERE child.deleted_at IS NULL
         )
         DELETE FROM page_publications
         WHERE page_id IN (SELECT page_id FROM subtree)
           AND EXISTS (
             SELECT 1
             FROM page_publications AS root_publication
             WHERE root_publication.page_id = ?
               AND root_publication.public_id = ?
               AND root_publication.updated_at = ?
           )`,
      )
      .bind(pageId, pageId, publicId, expectedUpdatedAt)
      .run();
    return result;
  }
}
