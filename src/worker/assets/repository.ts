export interface AssetRecord {
  id: string;
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
  uploadedForPageId: string | null;
  createdAt: string;
  deletedAt: string | null;
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

const ASSET_COLUMNS = `
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

export interface NewAssetRecord {
  id: string;
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
  uploadedForPageId: string | null;
  createdAt: string;
}

export class AssetRepository {
  constructor(private readonly db: D1Database) {}

  async findActiveById(id: string) {
    const row = await this.db
      .prepare(`SELECT ${ASSET_COLUMNS} FROM assets WHERE id = ? AND deleted_at IS NULL`)
      .bind(id)
      .first<AssetDatabaseRow>();
    return row ? toAssetRecord(row) : null;
  }

  async findActiveByIds(ids: string[]) {
    if (ids.length === 0) {
      return [];
    }

    const records = new Map<string, AssetRecord>();
    for (let offset = 0; offset < ids.length; offset += 900) {
      const chunk = ids.slice(offset, offset + 900);
      const placeholders = chunk.map(() => '?').join(', ');
      const result = await this.db
        .prepare(
          `SELECT ${ASSET_COLUMNS}
           FROM assets
           WHERE deleted_at IS NULL AND id IN (${placeholders})`,
        )
        .bind(...chunk)
        .all<AssetDatabaseRow>();

      result.results.forEach((row) => records.set(row.id, toAssetRecord(row)));
    }

    return ids.flatMap((id) => {
      const record = records.get(id);
      return record === undefined ? [] : [record];
    });
  }

  async hasActivePage(id: string) {
    const row = await this.db
      .prepare('SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL')
      .bind(id)
      .first<{ id: string }>();
    return row !== null;
  }

  async insert(asset: NewAssetRecord) {
    return this.db
      .prepare(
        `INSERT INTO assets
          (id, object_key, original_filename, mime_type, size_bytes, width, height, sha256,
           uploaded_for_page_id, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
      )
      .run();
  }

  async softDelete(id: string, deletedAt: string) {
    return this.db
      .prepare(
        `UPDATE assets
         SET deleted_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(deletedAt, id)
      .run();
  }
}
