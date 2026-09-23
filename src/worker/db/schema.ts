import { desc, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { emptyDocument } from '../../shared/pages';

export { emptyDocument };

export const pages = sqliteTable(
  'pages',
  {
    searchId: integer('search_id').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    contentJson: text('content_json').notNull().default(emptyDocument),
    contentText: text('content_text').notNull().default(''),
    parentId: text('parent_id'),
    position: integer('position').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    uniqueIndex('pages_slug_unique').on(sql`${table.slug} COLLATE NOCASE`),
    index('pages_parent_position').on(table.parentId, table.position, table.title),
    index('pages_updated_at').on(desc(table.updatedAt)),
    index('pages_deleted_at').on(table.deletedAt),
    check('pages_title_length', sql`length(${table.title}) BETWEEN 1 AND 200`),
    check('pages_position_nonnegative', sql`${table.position} >= 0`),
    check('pages_revision_positive', sql`${table.revision} > 0`),
    check('pages_is_favorite_boolean', sql`${table.isFavorite} IN (0, 1)`),
    check(
      'pages_parent_not_self',
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'pages_parent_id_fkey',
    }).onDelete('set null'),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('tags_name_normalized_unique').on(table.nameNormalized),
    check('tags_name_length', sql`length(${table.name}) BETWEEN 1 AND 50`),
    check('tags_name_normalized_length', sql`length(${table.nameNormalized}) BETWEEN 1 AND 50`),
  ],
);

export const pageTags = sqliteTable(
  'page_tags',
  {
    pageId: text('page_id').notNull(),
    tagId: text('tag_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.pageId, table.tagId] }),
    index('page_tags_tag').on(table.tagId),
    foreignKey({
      columns: [table.pageId],
      foreignColumns: [pages.id],
      name: 'page_tags_page_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tagId],
      foreignColumns: [tags.id],
      name: 'page_tags_tag_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    objectKey: text('object_key').notNull().unique(),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    sha256: text('sha256'),
    uploadedForPageId: text('uploaded_for_page_id'),
    createdAt: text('created_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('assets_uploaded_for_page').on(table.uploadedForPageId, table.createdAt),
    check('assets_size_nonnegative', sql`${table.sizeBytes} >= 0`),
    check('assets_width_positive', sql`${table.width} IS NULL OR ${table.width} > 0`),
    check('assets_height_positive', sql`${table.height} IS NULL OR ${table.height} > 0`),
    foreignKey({
      columns: [table.uploadedForPageId],
      foreignColumns: [pages.id],
      name: 'assets_uploaded_for_page_id_fkey',
    }).onDelete('set null'),
  ],
);

export const pageAssets = sqliteTable(
  'page_assets',
  {
    pageId: text('page_id').notNull(),
    assetId: text('asset_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.pageId, table.assetId] }),
    index('page_assets_asset').on(table.assetId),
    foreignKey({
      columns: [table.pageId],
      foreignColumns: [pages.id],
      name: 'page_assets_page_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.assetId],
      foreignColumns: [assets.id],
      name: 'page_assets_asset_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const pageLinks = sqliteTable(
  'page_links',
  {
    id: text('id').primaryKey(),
    sourcePageId: text('source_page_id').notNull(),
    targetPageId: text('target_page_id'),
    targetTitle: text('target_title').notNull(),
    targetTitleNormalized: text('target_title_normalized').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('page_links_source').on(table.sourcePageId),
    index('page_links_target').on(table.targetPageId),
    uniqueIndex('page_links_source_title').on(table.sourcePageId, table.targetTitleNormalized),
    foreignKey({
      columns: [table.sourcePageId],
      foreignColumns: [pages.id],
      name: 'page_links_source_page_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.targetPageId],
      foreignColumns: [pages.id],
      name: 'page_links_target_page_id_fkey',
    }).onDelete('set null'),
  ],
);

export const pageRevisions = sqliteTable(
  'page_revisions',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id').notNull(),
    sourceRevision: integer('source_revision').notNull(),
    title: text('title').notNull(),
    contentJson: text('content_json').notNull(),
    trigger: text('trigger').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('page_revisions_page_created').on(table.pageId, desc(table.createdAt), desc(table.id)),
    check('page_revisions_source_revision_positive', sql`${table.sourceRevision} > 0`),
    check(
      'page_revisions_trigger_allowed',
      sql`${table.trigger} IN ('interval', 'delete', 'restore')`,
    ),
    check('page_revisions_title_length', sql`length(${table.title}) BETWEEN 1 AND 200`),
    foreignKey({
      columns: [table.pageId],
      foreignColumns: [pages.id],
      name: 'page_revisions_page_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const pagePublications = sqliteTable(
  'page_publications',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id').notNull().unique(),
    publicId: text('public_id').notNull().unique(),
    sourceRevision: integer('source_revision').notNull(),
    publishedContentJson: text('published_content_json').notNull(),
    publishedContentText: text('published_content_text').notNull().default(''),
    publishedTitle: text('published_title').notNull(),
    allowIndexing: integer('allow_indexing', { mode: 'boolean' }).notNull().default(false),
    publishedParentPublicId: text('published_parent_public_id'),
    publishedPosition: integer('published_position').notNull().default(0),
    publishedAt: text('published_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    publishedTagsJson: text('published_tags_json').notNull().default('[]'),
  },
  (table) => [
    index('page_publications_updated').on(desc(table.updatedAt), desc(table.publicId)),
    check('page_publications_source_revision_positive', sql`${table.sourceRevision} > 0`),
    check('page_publications_title_length', sql`length(${table.publishedTitle}) BETWEEN 1 AND 200`),
    check('page_publications_allow_indexing_boolean', sql`${table.allowIndexing} IN (0, 1)`),
    check('page_publications_position_nonnegative', sql`${table.publishedPosition} >= 0`),
    foreignKey({
      columns: [table.pageId],
      foreignColumns: [pages.id],
      name: 'page_publications_page_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    contentJson: text('content_json').notNull(),
    revision: integer('revision').notNull().default(1),
    isDailyNote: integer('is_daily_note', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('templates_title_unique').on(sql`${table.title} COLLATE NOCASE`),
    uniqueIndex('templates_daily_note_unique')
      .on(table.isDailyNote)
      .where(sql`${table.isDailyNote} = 1`),
    check('templates_title_length', sql`length(${table.title}) BETWEEN 1 AND 200`),
    check('templates_revision_positive', sql`${table.revision} > 0`),
    check('templates_is_daily_note_boolean', sql`${table.isDailyNote} IN (0, 1)`),
  ],
);

export const dailyNotes = sqliteTable(
  'daily_notes',
  {
    id: text('id').primaryKey(),
    localDate: text('local_date').notNull().unique(),
    timeZone: text('time_zone').notNull(),
    pageId: text('page_id').notNull().unique(),
    templateId: text('template_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('daily_notes_page').on(table.pageId),
    index('daily_notes_template').on(table.templateId),
    check(
      'daily_notes_local_date_format',
      sql`${table.localDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    foreignKey({
      columns: [table.pageId],
      foreignColumns: [pages.id],
      name: 'daily_notes_page_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.templateId],
      foreignColumns: [templates.id],
      name: 'daily_notes_template_id_fkey',
    }).onDelete('set null'),
  ],
);

export const publicationAssets = sqliteTable(
  'publication_assets',
  {
    publicationId: text('publication_id').notNull(),
    assetId: text('asset_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.assetId] }),
    index('publication_assets_asset').on(table.assetId),
    foreignKey({
      columns: [table.publicationId],
      foreignColumns: [pagePublications.id],
      name: 'publication_assets_publication_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.assetId],
      foreignColumns: [assets.id],
      name: 'publication_assets_asset_id_fkey',
    }).onDelete('restrict'),
  ],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    workerVersion: text('worker_version').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    index('auth_sessions_expires_at').on(table.expiresAt),
    check('auth_sessions_created_at_nonnegative', sql`${table.createdAt} >= 0`),
    check('auth_sessions_expires_after_created', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const authLoginAttempts = sqliteTable(
  'auth_login_attempts',
  {
    sourceHash: text('source_hash').primaryKey(),
    windowStartedAt: integer('window_started_at').notNull(),
    failureCount: integer('failure_count').notNull(),
  },
  (table) => [
    check('auth_login_attempts_window_nonnegative', sql`${table.windowStartedAt} >= 0`),
    check('auth_login_attempts_count_positive', sql`${table.failureCount} > 0`),
  ],
);

export const restoreSessions = sqliteTable(
  'restore_sessions',
  {
    id: text('id').primaryKey(),
    ownerIdentity: text('owner_identity').notNull(),
    status: text('status').notNull(),
    backupVersion: integer('backup_version').notNull(),
    expectedPages: integer('expected_pages').notNull(),
    expectedRevisions: integer('expected_revisions').notNull(),
    expectedAssets: integer('expected_assets').notNull(),
    expectedTags: integer('expected_tags').notNull().default(0),
    expectedPublications: integer('expected_publications').notNull().default(0),
    expectedTemplates: integer('expected_templates').notNull().default(0),
    expectedDailyNotes: integer('expected_daily_notes').notNull().default(0),
    expectedBytes: integer('expected_bytes').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    check(
      'restore_sessions_status_allowed',
      sql`${table.status} IN ('uploading', 'finalizing', 'failed')`,
    ),
    check('restore_sessions_backup_version_supported', sql`${table.backupVersion} IN (1, 2)`),
    check('restore_sessions_expected_pages_nonnegative', sql`${table.expectedPages} >= 0`),
    check('restore_sessions_expected_revisions_nonnegative', sql`${table.expectedRevisions} >= 0`),
    check('restore_sessions_expected_assets_nonnegative', sql`${table.expectedAssets} >= 0`),
    check('restore_sessions_expected_tags_nonnegative', sql`${table.expectedTags} >= 0`),
    check(
      'restore_sessions_expected_publications_nonnegative',
      sql`${table.expectedPublications} >= 0`,
    ),
    check('restore_sessions_expected_templates_nonnegative', sql`${table.expectedTemplates} >= 0`),
    check(
      'restore_sessions_expected_daily_notes_nonnegative',
      sql`${table.expectedDailyNotes} >= 0`,
    ),
    check('restore_sessions_expected_bytes_nonnegative', sql`${table.expectedBytes} >= 0`),
    index('restore_sessions_owner_updated').on(table.ownerIdentity, desc(table.updatedAt)),
    index('restore_sessions_status').on(table.status),
  ],
);

export const restoreSessionRecords = sqliteTable(
  'restore_session_records',
  {
    sessionId: text('session_id').notNull(),
    recordType: text('record_type').notNull(),
    recordId: text('record_id').notNull(),
    payloadJson: text('payload_json').notNull(),
    sha256: text('sha256').notNull(),
    uploadedAt: text('uploaded_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.recordType, table.recordId] }),
    index('restore_session_records_session').on(table.sessionId, table.recordType),
    check(
      'restore_session_records_type_allowed',
      sql`${table.recordType} IN ('page', 'revision', 'publication', 'tag', 'template', 'dailyNote')`,
    ),
    foreignKey({
      columns: [table.sessionId],
      foreignColumns: [restoreSessions.id],
      name: 'restore_session_records_session_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const restoreSessionAssets = sqliteTable(
  'restore_session_assets',
  {
    sessionId: text('session_id').notNull(),
    assetId: text('asset_id').notNull(),
    objectKey: text('object_key').notNull(),
    metadataJson: text('metadata_json').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    uploadedAt: text('uploaded_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.assetId] }),
    index('restore_session_assets_session').on(table.sessionId),
    check('restore_session_assets_size_nonnegative', sql`${table.sizeBytes} >= 0`),
    foreignKey({
      columns: [table.sessionId],
      foreignColumns: [restoreSessions.id],
      name: 'restore_session_assets_session_id_fkey',
    }).onDelete('cascade'),
  ],
);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type PageTag = typeof pageTags.$inferSelect;
export type NewPageTag = typeof pageTags.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type PageAsset = typeof pageAssets.$inferSelect;
export type NewPageAsset = typeof pageAssets.$inferInsert;
export type PageLink = typeof pageLinks.$inferSelect;
export type NewPageLink = typeof pageLinks.$inferInsert;
export type PageRevision = typeof pageRevisions.$inferSelect;
export type NewPageRevision = typeof pageRevisions.$inferInsert;
export type PagePublication = typeof pagePublications.$inferSelect;
export type NewPagePublication = typeof pagePublications.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
export type DailyNote = typeof dailyNotes.$inferSelect;
export type NewDailyNote = typeof dailyNotes.$inferInsert;
export type PublicationAsset = typeof publicationAssets.$inferSelect;
export type NewPublicationAsset = typeof publicationAssets.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
export type AuthLoginAttempt = typeof authLoginAttempts.$inferSelect;
export type NewAuthLoginAttempt = typeof authLoginAttempts.$inferInsert;
export type RestoreSession = typeof restoreSessions.$inferSelect;
export type NewRestoreSession = typeof restoreSessions.$inferInsert;
export type RestoreSessionRecord = typeof restoreSessionRecords.$inferSelect;
export type NewRestoreSessionRecord = typeof restoreSessionRecords.$inferInsert;
export type RestoreSessionAsset = typeof restoreSessionAssets.$inferSelect;
export type NewRestoreSessionAsset = typeof restoreSessionAssets.$inferInsert;
