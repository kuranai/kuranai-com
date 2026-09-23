import {
  backupAssetRecordSchema,
  backupManifestSchema,
  backupPageRecordSchema,
  backupPublicationRecordSchema,
  backupRevisionRecordSchema,
  backupTagRecordSchema,
  backupTemplateRecordSchema,
  backupDailyNoteRecordSchema,
  canonicalJson,
  type BackupAssetRecord,
  type BackupPageRecord,
  type BackupRevisionRecord,
  type BackupTagRecord,
  type BackupTemplateRecord,
  type BackupDailyNoteRecord,
} from '../../shared/backup';
import { assetTypeForMimeType } from '../assets/formats';
import type { AssetRecord } from '../assets/repository';
import type { PageRecord, PageRevisionRecord } from '../pages/repository';
import type { PublicationRecord } from '../publications/repository';
import type { TagRecord } from '../tags/repository';
import type { DailyNoteRecord, TemplateRecord } from '../templates/repository';
import type { PublicTiptapDocument } from '../../shared/publications';
import { BackupError } from './errors';

export function compareText(left: string, right: string) {
  const normalizedLeft = left.normalize('NFKC').toLowerCase();
  const normalizedRight = right.normalize('NFKC').toLowerCase();
  if (normalizedLeft < normalizedRight) {
    return -1;
  }
  if (normalizedLeft > normalizedRight) {
    return 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function sanitizeFilename(filename: string, assetId: string) {
  const sanitized = filename
    .normalize('NFKC')
    .split('')
    .filter((character) => !/[\p{Cc}\p{Cf}]/u.test(character))
    .join('')
    .replace(/[<>:"/\\|?*]/gu, '_')
    .trim()
    .replace(/[. ]+$/gu, '');
  const basename = sanitized || `asset-${assetId}`;
  const reservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(basename);
  return reservedName ? `_${basename}` : basename;
}

function splitFilename(filename: string) {
  const extensionStart = filename.lastIndexOf('.');
  if (extensionStart <= 0) {
    return { extension: '', stem: filename };
  }
  return {
    extension: filename.slice(extensionStart),
    stem: filename.slice(0, extensionStart),
  };
}

function allocateAssetPath(filename: string, assetId: string, usedPaths: Set<string>) {
  const safeFilename = sanitizeFilename(filename, assetId);
  const { extension, stem } = splitFilename(safeFilename);

  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const suffixText = suffix === 1 ? '' : `-${suffix}`;
    const maxStemLength = Math.max(1, 255 - extension.length - suffixText.length);
    const candidate = `${stem.slice(0, maxStemLength)}${suffixText}${extension}`;
    const path = `assets/${candidate}`;
    const key = path.toLocaleLowerCase('en-US');
    if (!usedPaths.has(key)) {
      usedPaths.add(key);
      return path;
    }
  }

  throw new BackupError(
    500,
    'BACKUP_FAILED',
    'The backup contains too many colliding asset names.',
  );
}

export function assetArchivePathMap(records: AssetRecord[]) {
  const usedPaths = new Set<string>();
  const paths = new Map<string, string>();
  for (const record of [...records].sort((left, right) => compareText(left.id, right.id))) {
    paths.set(record.id, allocateAssetPath(record.originalFilename, record.id, usedPaths));
  }
  return paths;
}

export function pageBackupRecord(page: PageRecord, content: BackupPageRecord['content']) {
  return backupPageRecordSchema.parse({
    id: page.id,
    title: page.title,
    slug: page.slug,
    content,
    parentId: page.parentId,
    position: page.position,
    revision: page.revision,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    deletedAt: page.deletedAt,
    isFavorite: page.isFavorite,
    tagIds: page.tags.map((tag) => tag.id),
  });
}

export function tagBackupRecord(tag: TagRecord): BackupTagRecord {
  return backupTagRecordSchema.parse({
    id: tag.id,
    name: tag.name,
    nameNormalized: tag.nameNormalized,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  });
}

export function revisionBackupRecord(
  revision: PageRevisionRecord,
  content: BackupRevisionRecord['content'],
) {
  return backupRevisionRecordSchema.parse({
    id: revision.id,
    pageId: revision.pageId,
    sourceRevision: revision.sourceRevision,
    title: revision.title,
    content,
    trigger: revision.trigger,
    createdAt: revision.createdAt,
  });
}

export function templateBackupRecord(
  template: TemplateRecord,
  content: BackupTemplateRecord['content'],
) {
  return backupTemplateRecordSchema.parse({
    id: template.id,
    title: template.title,
    content,
    revision: template.revision,
    isDailyNote: template.isDailyNote,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  });
}

export function dailyNoteBackupRecord(note: DailyNoteRecord): BackupDailyNoteRecord {
  return backupDailyNoteRecordSchema.parse({
    id: note.id,
    localDate: note.localDate,
    timeZone: note.timeZone,
    pageId: note.pageId,
    templateId: note.templateId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  });
}

export function publicationBackupRecord(
  publication: PublicationRecord,
  content: PublicTiptapDocument,
  assetIds: string[],
) {
  let tags: unknown;
  try {
    tags = JSON.parse(publication.publishedTagsJson) as unknown;
  } catch {
    throw new BackupError(500, 'BACKUP_FAILED', 'A stored publication contains invalid tags.');
  }
  return backupPublicationRecordSchema.parse({
    id: publication.id,
    pageId: publication.pageId,
    publicId: publication.publicId,
    sourceRevision: publication.sourceRevision,
    content,
    publishedTitle: publication.publishedTitle,
    allowIndexing: publication.allowIndexing,
    publishedParentPublicId: publication.publishedParentPublicId,
    publishedPosition: publication.publishedPosition,
    publishedAt: publication.publishedAt,
    updatedAt: publication.updatedAt,
    assetIds,
    tags,
  });
}

export function assetBackupRecord(
  asset: AssetRecord,
  path: string,
  sha256: string,
): BackupAssetRecord {
  return backupAssetRecordSchema.parse({
    id: asset.id,
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    uploadedForPageId: asset.uploadedForPageId,
    createdAt: asset.createdAt,
    deletedAt: asset.deletedAt,
    path,
    sha256,
  });
}

export function validateBackupManifest(value: unknown) {
  const parsed = backupManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The backup manifest is invalid.');
  }
  return parsed.data;
}

export function parseStoredBackupContent(contentJson: string) {
  try {
    return JSON.parse(contentJson) as unknown;
  } catch {
    throw new BackupError(500, 'BACKUP_FAILED', 'A stored document could not be read.');
  }
}

export function canonicalRecordJson(value: unknown) {
  return canonicalJson(value);
}

export function assetPermanentObjectKey(asset: BackupAssetRecord) {
  const type = assetTypeForMimeType(asset.mimeType);
  const date = new Date(asset.createdAt);
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  return `assets/${year}/${month}/${asset.id}.${type.extension}`;
}

export function restoreTemporaryObjectKey(sessionId: string, assetId: string) {
  return `restore/${sessionId}/${assetId}`;
}

export function parseSha256Header(value: string | null) {
  if (value === null || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The asset checksum is invalid.');
  }
  return value;
}

function bytesToHex(value: ArrayBuffer | ArrayBufferView) {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.byteLength !== 32) {
    return null;
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeSha256(value: string) {
  if (/^[a-f0-9]{64}$/iu.test(value)) {
    return value.toLowerCase();
  }

  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = atob(`${normalized}${padding}`);
    return bytesToHex(Uint8Array.from(decoded, (character) => character.charCodeAt(0)));
  } catch {
    return null;
  }
}

function checksumToHex(value: unknown) {
  if (typeof value === 'string') {
    return normalizeSha256(value);
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return bytesToHex(value);
  }
  return null;
}

export async function objectSha256(object: R2Object | R2ObjectBody) {
  try {
    const direct = checksumToHex(object.checksums.sha256);
    if (direct !== null) {
      return direct;
    }
    const serialized = checksumToHex(object.checksums.toJSON().sha256);
    if (serialized !== null) {
      return serialized;
    }
  } catch {
    // Some local R2 implementations do not expose checksums on head().
  }

  if (!('body' in object)) {
    return null;
  }

  const bytes = await new Response(object.body).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
