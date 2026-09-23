import type { TagSummary } from '../../shared/tags';

export interface TagRecord extends TagSummary {
  nameNormalized: string;
  createdAt: string;
  updatedAt: string;
}

interface TagDatabaseRow {
  id: string;
  name: string;
  name_normalized: string;
  created_at: string;
  updated_at: string;
}

function toTagRecord(row: TagDatabaseRow): TagRecord {
  return {
    id: row.id,
    name: row.name,
    nameNormalized: row.name_normalized,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TAG_COLUMNS = `
  id,
  name,
  name_normalized,
  created_at,
  updated_at
`;

export class TagRepository {
  constructor(readonly db: D1Database) {}

  async list() {
    const result = await this.db
      .prepare(
        `SELECT ${TAG_COLUMNS}
         FROM tags
         ORDER BY name_normalized, name, id
         LIMIT 200`,
      )
      .all<TagDatabaseRow>();
    return result.results.map(toTagRecord);
  }

  async findById(id: string) {
    const row = await this.db
      .prepare(`SELECT ${TAG_COLUMNS} FROM tags WHERE id = ?`)
      .bind(id)
      .first<TagDatabaseRow>();
    return row ? toTagRecord(row) : null;
  }

  async findByNameNormalized(nameNormalized: string, excludeId?: string) {
    const excludeClause = excludeId === undefined ? '' : ' AND id <> ?';
    const bindings = excludeId === undefined ? [nameNormalized] : [nameNormalized, excludeId];
    const row = await this.db
      .prepare(
        `SELECT ${TAG_COLUMNS}
         FROM tags
         WHERE name_normalized = ?${excludeClause}`,
      )
      .bind(...bindings)
      .first<TagDatabaseRow>();
    return row ? toTagRecord(row) : null;
  }

  async findByIds(ids: string[]) {
    if (ids.length === 0) {
      return [];
    }

    const result = await this.db
      .prepare(
        `SELECT ${TAG_COLUMNS}
         FROM tags
         WHERE id IN (${ids.map(() => '?').join(', ')})
         ORDER BY name_normalized, name, id`,
      )
      .bind(...ids)
      .all<TagDatabaseRow>();
    return result.results.map(toTagRecord);
  }

  async insert(input: {
    id: string;
    name: string;
    nameNormalized: string;
    createdAt: string;
    updatedAt: string;
  }) {
    return this.db
      .prepare(
        `INSERT INTO tags (id, name, name_normalized, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.name, input.nameNormalized, input.createdAt, input.updatedAt)
      .run();
  }

  async update(id: string, name: string, nameNormalized: string, updatedAt: string) {
    return this.db
      .prepare(
        `UPDATE tags
         SET name = ?, name_normalized = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(name, nameNormalized, updatedAt, id)
      .run();
  }

  async delete(id: string) {
    return this.db.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
  }

  async replacePageTags(pageId: string, tagIds: string[]) {
    const statements: D1PreparedStatement[] = [
      this.db.prepare('DELETE FROM page_tags WHERE page_id = ?').bind(pageId),
    ];

    if (tagIds.length > 0) {
      const placeholders = tagIds.map(() => '?').join(', ');
      statements.push(
        this.db
          .prepare(
            `INSERT INTO page_tags (page_id, tag_id)
             SELECT ?, id
             FROM tags
             WHERE id IN (${placeholders})`,
          )
          .bind(pageId, ...tagIds),
      );
    }

    return this.db.batch(statements);
  }
}
