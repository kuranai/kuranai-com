import { z } from 'zod';

import { MAX_ASSET_FILENAME_LENGTH, MAX_ASSET_SIZE_BYTES, assetIdSchema } from './assets';
import {
  PAGE_SLUG_MAX_LENGTH,
  PAGE_TITLE_MAX_LENGTH,
  baseRevisionSchema,
  pageIdSchema,
  tiptapDocumentSchema,
  type TiptapDocument,
} from './pages';
import { publicIdSchema, publicTiptapDocumentSchema } from './publications';
import { localDateSchema, timeZoneSchema } from './templates';
import {
  TAG_MAX_LIMIT,
  tagIdSchema,
  tagNameSchema,
  pageTagIdsSchema,
  type TagSummary,
} from './tags';

export const BACKUP_FORMAT = 'dovari-backup' as const;
export const BACKUP_V1_VERSION = 1 as const;
export const BACKUP_VERSION = 2 as const;
export const BACKUP_V1_FILENAME = 'dovari-backup-v1.zip';
export const BACKUP_FILENAME = 'dovari-backup-v2.zip';
export const BACKUP_MANIFEST_FILENAME = 'backup.json';
export const RESTORE_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;

const timestampSchema = z.string().datetime({ offset: true });
const nonnegativeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeTextSchema = z
  .string()
  .max(MAX_ASSET_FILENAME_LENGTH)
  .refine(
    (value) =>
      ![...value].some(
        (character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
      ),
    {
      message: 'Text contains control characters.',
    },
  );

export const backupPageRecordSchema = z
  .object({
    id: pageIdSchema,
    title: z.string().trim().min(1).max(PAGE_TITLE_MAX_LENGTH),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(PAGE_SLUG_MAX_LENGTH)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    content: tiptapDocumentSchema,
    parentId: pageIdSchema.nullable(),
    position: nonnegativeIntegerSchema,
    revision: baseRevisionSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullable(),
    isFavorite: z.boolean().default(false),
    tagIds: pageTagIdsSchema.default([]),
  })
  .strict();

export type BackupPageRecord = z.infer<typeof backupPageRecordSchema>;

export const backupRevisionRecordSchema = z
  .object({
    id: pageIdSchema,
    pageId: pageIdSchema,
    sourceRevision: baseRevisionSchema,
    title: z.string().trim().min(1).max(PAGE_TITLE_MAX_LENGTH),
    content: tiptapDocumentSchema,
    trigger: z.enum(['interval', 'delete', 'restore']),
    createdAt: timestampSchema,
  })
  .strict();

export type BackupRevisionRecord = z.infer<typeof backupRevisionRecordSchema>;

export const backupTagRecordSchema = z
  .object({
    id: tagIdSchema,
    name: tagNameSchema,
    nameNormalized: tagNameSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type BackupTagRecord = z.infer<typeof backupTagRecordSchema>;

export const backupTemplateRecordSchema = z
  .object({
    id: pageIdSchema,
    title: z.string().trim().min(1).max(PAGE_TITLE_MAX_LENGTH),
    content: tiptapDocumentSchema,
    revision: baseRevisionSchema,
    isDailyNote: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type BackupTemplateRecord = z.infer<typeof backupTemplateRecordSchema>;

export const backupDailyNoteRecordSchema = z
  .object({
    id: pageIdSchema,
    localDate: localDateSchema,
    timeZone: timeZoneSchema,
    pageId: pageIdSchema,
    templateId: pageIdSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type BackupDailyNoteRecord = z.infer<typeof backupDailyNoteRecordSchema>;

const backupPathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^assets\/[^/\\]+$/u)
  .refine(
    (value) =>
      !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') &&
      ![...value].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      }),
    { message: 'The backup path is unsafe.' },
  );

export const backupAssetRecordSchema = z
  .object({
    id: assetIdSchema,
    originalFilename: safeTextSchema.min(1),
    mimeType: z.string().trim().min(1).max(255),
    sizeBytes: nonnegativeIntegerSchema.max(MAX_ASSET_SIZE_BYTES),
    width: z.number().int().positive().max(100_000).nullable(),
    height: z.number().int().positive().max(100_000).nullable(),
    uploadedForPageId: pageIdSchema.nullable(),
    createdAt: timestampSchema,
    deletedAt: timestampSchema.nullable(),
    path: backupPathSchema,
    sha256: sha256Schema,
  })
  .strict();

export type BackupAssetRecord = z.infer<typeof backupAssetRecordSchema>;

const assetIdListSchema = z
  .array(assetIdSchema)
  .max(10_000)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Asset ids must be unique.',
  });

export const backupPublicationRecordSchema = z
  .object({
    id: pageIdSchema,
    pageId: pageIdSchema,
    publicId: publicIdSchema,
    sourceRevision: baseRevisionSchema,
    content: publicTiptapDocumentSchema,
    publishedTitle: z.string().trim().min(1).max(PAGE_TITLE_MAX_LENGTH),
    allowIndexing: z.boolean(),
    publishedParentPublicId: publicIdSchema.nullable().optional(),
    publishedPosition: z.number().int().nonnegative().optional(),
    publishedAt: timestampSchema,
    updatedAt: timestampSchema,
    assetIds: assetIdListSchema,
    tags: z.array(tagNameSchema).max(TAG_MAX_LIMIT).default([]),
  })
  .strict();

export type BackupPublicationRecord = z.infer<typeof backupPublicationRecordSchema>;

export const backupManifestV1Schema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_V1_VERSION),
    exportedAt: timestampSchema,
    pages: z.array(backupPageRecordSchema),
    revisions: z.array(backupRevisionRecordSchema),
    assets: z.array(backupAssetRecordSchema),
    tags: z.array(backupTagRecordSchema).max(TAG_MAX_LIMIT).default([]),
  })
  .strict();

export type BackupManifestV1 = z.infer<typeof backupManifestV1Schema>;

export const backupManifestV2Schema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    exportedAt: timestampSchema,
    pages: z.array(backupPageRecordSchema),
    revisions: z.array(backupRevisionRecordSchema),
    assets: z.array(backupAssetRecordSchema),
    publications: z.array(backupPublicationRecordSchema),
    tags: z.array(backupTagRecordSchema).max(TAG_MAX_LIMIT).default([]),
    templates: z.array(backupTemplateRecordSchema).max(200).default([]),
    dailyNotes: z.array(backupDailyNoteRecordSchema).max(10_000).default([]),
  })
  .strict();

export type BackupManifestV2 = z.infer<typeof backupManifestV2Schema>;

export const backupManifestSchema = z.discriminatedUnion('version', [
  backupManifestV1Schema,
  backupManifestV2Schema,
]);

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export const restoreSessionCreateRequestSchema = z
  .object({
    backupVersion: z.union([z.literal(BACKUP_V1_VERSION), z.literal(BACKUP_VERSION)]),
    expectedPages: nonnegativeIntegerSchema,
    expectedRevisions: nonnegativeIntegerSchema,
    expectedAssets: nonnegativeIntegerSchema,
    expectedTags: nonnegativeIntegerSchema.default(0),
    expectedPublications: nonnegativeIntegerSchema.default(0),
    expectedTemplates: nonnegativeIntegerSchema.default(0),
    expectedDailyNotes: nonnegativeIntegerSchema.default(0),
    expectedBytes: nonnegativeIntegerSchema,
  })
  .strict();

export type RestoreSessionCreateRequest = z.infer<typeof restoreSessionCreateRequestSchema>;

export const restoreSessionStatusSchema = z
  .object({
    id: pageIdSchema,
    status: z.enum(['uploading', 'finalizing', 'failed']),
    backupVersion: z.union([z.literal(BACKUP_V1_VERSION), z.literal(BACKUP_VERSION)]),
    expectedPages: nonnegativeIntegerSchema,
    expectedRevisions: nonnegativeIntegerSchema,
    expectedAssets: nonnegativeIntegerSchema,
    expectedTags: nonnegativeIntegerSchema.default(0),
    expectedPublications: nonnegativeIntegerSchema.default(0),
    expectedTemplates: nonnegativeIntegerSchema.default(0),
    expectedDailyNotes: nonnegativeIntegerSchema.default(0),
    expectedBytes: nonnegativeIntegerSchema,
    receivedPages: nonnegativeIntegerSchema,
    receivedRevisions: nonnegativeIntegerSchema,
    receivedAssets: nonnegativeIntegerSchema,
    receivedTags: nonnegativeIntegerSchema.default(0),
    receivedTemplates: nonnegativeIntegerSchema.default(0),
    receivedDailyNotes: nonnegativeIntegerSchema.default(0),
    receivedBytes: nonnegativeIntegerSchema,
    pageIds: z.array(pageIdSchema),
    revisionIds: z.array(pageIdSchema),
    assetIds: z.array(assetIdSchema),
    tagIds: z.array(tagIdSchema).default([]),
    publicationIds: z.array(pageIdSchema).default([]),
    templateIds: z.array(pageIdSchema).default([]),
    dailyNoteIds: z.array(pageIdSchema).default([]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict();

export type RestoreSessionStatus = z.infer<typeof restoreSessionStatusSchema>;

export const restoreSessionResponseSchema = z
  .object({ session: restoreSessionStatusSchema })
  .strict();
export type RestoreSessionResponse = z.infer<typeof restoreSessionResponseSchema>;

export const restoreRecordResponseSchema = z
  .object({
    accepted: z.literal(true),
    recordType: z.enum(['page', 'revision', 'publication', 'tag', 'template', 'dailyNote']),
    recordId: pageIdSchema,
  })
  .strict();

export type RestoreRecordResponse = z.infer<typeof restoreRecordResponseSchema>;

export const restoreAssetResponseSchema = z
  .object({ accepted: z.literal(true), assetId: assetIdSchema })
  .strict();

export type RestoreAssetResponse = z.infer<typeof restoreAssetResponseSchema>;

export const restoreFinalizeResponseSchema = z
  .object({
    restored: z.literal(true),
    pageCount: nonnegativeIntegerSchema,
    revisionCount: nonnegativeIntegerSchema,
    assetCount: nonnegativeIntegerSchema,
    tagCount: nonnegativeIntegerSchema.default(0),
    publicationCount: nonnegativeIntegerSchema.default(0),
    templateCount: nonnegativeIntegerSchema.default(0),
    dailyNoteCount: nonnegativeIntegerSchema.default(0),
  })
  .strict();

export type RestoreFinalizeResponse = z.infer<typeof restoreFinalizeResponseSchema>;

export const restoreDeleteResponseSchema = z
  .object({ deleted: z.literal(true), sessionId: pageIdSchema })
  .strict();

export type RestoreDeleteResponse = z.infer<typeof restoreDeleteResponseSchema>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }

  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export async function sha256Hex(value: string | Uint8Array | ArrayBuffer) {
  const bytes =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isTiptapDocument(value: unknown): value is TiptapDocument {
  return tiptapDocumentSchema.safeParse(value).success;
}

export function tagSummaryFromBackup(record: BackupTagRecord): TagSummary {
  return { id: record.id, name: record.name };
}
