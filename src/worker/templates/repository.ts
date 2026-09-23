export interface TemplateRecord {
  id: string;
  title: string;
  contentJson: string;
  revision: number;
  isDailyNote: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DailyNoteRecord {
  id: string;
  localDate: string;
  timeZone: string;
  pageId: string;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
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

const templateColumns = `
  id,
  title,
  content_json,
  revision,
  is_daily_note,
  created_at,
  updated_at
`;

const dailyNoteColumns = `
  id,
  local_date,
  time_zone,
  page_id,
  template_id,
  created_at,
  updated_at
`;

export class TemplateRepository {
  constructor(readonly db: D1Database) {}

  async list() {
    const result = await this.db
      .prepare(
        `SELECT ${templateColumns}
         FROM templates
         ORDER BY is_daily_note DESC, title COLLATE NOCASE, id`,
      )
      .all<TemplateDatabaseRow>();
    return result.results.map(toTemplateRecord);
  }

  async findById(id: string) {
    const row = await this.db
      .prepare(`SELECT ${templateColumns} FROM templates WHERE id = ?`)
      .bind(id)
      .first<TemplateDatabaseRow>();
    return row ? toTemplateRecord(row) : null;
  }

  async findByTitle(title: string) {
    const row = await this.db
      .prepare(`SELECT ${templateColumns} FROM templates WHERE title COLLATE NOCASE = ?`)
      .bind(title)
      .first<TemplateDatabaseRow>();
    return row ? toTemplateRecord(row) : null;
  }

  async findDailyNoteTemplate() {
    const row = await this.db
      .prepare(`SELECT ${templateColumns} FROM templates WHERE is_daily_note = 1 LIMIT 1`)
      .first<TemplateDatabaseRow>();
    return row ? toTemplateRecord(row) : null;
  }

  async insert(template: TemplateRecord) {
    return this.db
      .prepare(
        `INSERT INTO templates
          (id, title, content_json, revision, is_daily_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        template.id,
        template.title,
        template.contentJson,
        template.revision,
        template.isDailyNote ? 1 : 0,
        template.createdAt,
        template.updatedAt,
      )
      .run();
  }

  async update(
    id: string,
    baseRevision: number,
    values: { title: string; contentJson: string; isDailyNote: boolean; updatedAt: string },
  ) {
    return this.db
      .prepare(
        `UPDATE templates
         SET title = ?, content_json = ?, is_daily_note = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .bind(
        values.title,
        values.contentJson,
        values.isDailyNote ? 1 : 0,
        values.updatedAt,
        id,
        baseRevision,
      )
      .run();
  }

  async delete(id: string, baseRevision: number) {
    return this.db
      .prepare('DELETE FROM templates WHERE id = ? AND revision = ?')
      .bind(id, baseRevision)
      .run();
  }

  async findDailyNote(localDate: string) {
    const row = await this.db
      .prepare(`SELECT ${dailyNoteColumns} FROM daily_notes WHERE local_date = ?`)
      .bind(localDate)
      .first<DailyNoteDatabaseRow>();
    return row ? toDailyNoteRecord(row) : null;
  }

  async listDailyNotes() {
    const result = await this.db
      .prepare(`SELECT ${dailyNoteColumns} FROM daily_notes ORDER BY local_date, id`)
      .all<DailyNoteDatabaseRow>();
    return result.results.map(toDailyNoteRecord);
  }
}
