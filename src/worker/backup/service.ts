import {
  BACKUP_FILENAME,
  BACKUP_MANIFEST_FILENAME,
  BACKUP_VERSION,
  RESTORE_SESSION_TTL_MS,
  backupAssetRecordSchema,
  backupManifestSchema,
  backupPageRecordSchema,
  backupPublicationRecordSchema,
  backupRevisionRecordSchema,
  backupTagRecordSchema,
  backupTemplateRecordSchema,
  backupDailyNoteRecordSchema,
  canonicalJson,
  restoreSessionCreateRequestSchema,
  sha256Hex,
  type BackupAssetRecord,
  type BackupManifest,
  type BackupPageRecord,
  type BackupPublicationRecord,
  type BackupRevisionRecord,
  type BackupTagRecord,
  type BackupTemplateRecord,
  type BackupDailyNoteRecord,
  type RestoreSessionCreateRequest,
  type RestoreSessionStatus,
} from '../../shared/backup';
import { MAX_ASSET_SIZE_BYTES } from '../../shared/assets';
import {
  MAX_PAGE_REQUEST_BYTES,
  MAX_PAGE_ROW_BYTES,
  collectAssetIds,
  collectWikiLinkReferences,
  derivePlainText,
  estimatePageRowBytes,
  tiptapDocumentSchema,
} from '../../shared/pages';
import {
  collectPublicAssetIds,
  derivePublicPlainText,
  publicTiptapDocumentSchema,
} from '../../shared/publications';
import { normalizeTagName, normalizeTagNameForComparison } from '../../shared/tags';
import { assetTypeForMimeType } from '../assets/formats';
import type { AuthIdentity } from '../auth/password';
import type { AssetRecord } from '../assets/repository';
import type { PageRecord } from '../pages/repository';
import { BackupError } from './errors';
import {
  assetArchivePathMap,
  assetBackupRecord,
  assetPermanentObjectKey,
  canonicalRecordJson,
  compareText,
  objectSha256,
  normalizeSha256,
  pageBackupRecord,
  publicationBackupRecord,
  dailyNoteBackupRecord,
  parseSha256Header,
  parseStoredBackupContent,
  restoreTemporaryObjectKey,
  revisionBackupRecord,
  tagBackupRecord,
  templateBackupRecord,
} from './format';
import {
  BackupRepository,
  type RestoreSessionAssetRow,
  type RestoreSessionRecordRow,
  type RestoreSessionRow,
} from './repository';
import { createZipStream, textZipEntry, type ZipEntrySource } from '../export/zip';

const RECORD_TYPE_VALUES = [
  'page',
  'revision',
  'publication',
  'tag',
  'template',
  'dailyNote',
] as const;
type RestoreRecordType = (typeof RECORD_TYPE_VALUES)[number];

function isRecordType(value: string): value is RestoreRecordType {
  return (RECORD_TYPE_VALUES as readonly string[]).includes(value);
}

function nowIso() {
  return new Date().toISOString();
}

function isConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|unique/i.test(message);
}

function isSafeFilename(value: string) {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The asset metadata is invalid.');
  }

  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(`${normalized}${padding}`);
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The asset metadata is invalid.');
  }
}

function restoreSessionNotFound() {
  return new BackupError(404, 'RESTORE_SESSION_NOT_FOUND', 'The restore session was not found.');
}

function sessionConflict() {
  return new BackupError(
    409,
    'RESTORE_SESSION_CONFLICT',
    'Another restore session is already active or the session is being finalized.',
  );
}

function workspaceNotEmpty() {
  return new BackupError(
    409,
    'RESTORE_WORKSPACE_NOT_EMPTY',
    'Restore is only available in an empty workspace.',
  );
}

function incompleteRestore(message = 'The restore session is incomplete.') {
  return new BackupError(422, 'RESTORE_INCOMPLETE', message);
}

function recordMismatch(message = 'The restore record does not match the backup version.') {
  return new BackupError(422, 'RESTORE_RECORD_MISMATCH', message);
}

function canonicalAssetMetadata(value: BackupAssetRecord) {
  return canonicalJson(value);
}

function pageContent(record: PageRecord) {
  const value = parseStoredBackupContent(record.contentJson);
  const parsed = tiptapDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new BackupError(500, 'BACKUP_FAILED', 'A stored page contains invalid content.');
  }
  return parsed.data;
}

function ownerSubject(identity: AuthIdentity | undefined) {
  return identity?.kind === 'password' ? 'password:owner' : 'unauthenticated';
}

function summaryFromSession(
  session: RestoreSessionRow,
  received: {
    pages: string[];
    revisions: string[];
    publications: string[];
    tags: string[];
    templates: string[];
    dailyNotes: string[];
    assets: string[];
    bytes: number;
  },
): RestoreSessionStatus {
  return {
    id: session.id,
    status: session.status,
    backupVersion: session.backup_version,
    expectedPages: session.expected_pages,
    expectedRevisions: session.expected_revisions,
    expectedAssets: session.expected_assets,
    expectedTags: session.expected_tags,
    expectedPublications: session.expected_publications,
    expectedTemplates: session.expected_templates,
    expectedDailyNotes: session.expected_daily_notes,
    expectedBytes: session.expected_bytes,
    receivedPages: received.pages.length,
    receivedRevisions: received.revisions.length,
    receivedAssets: received.assets.length,
    receivedTags: received.tags.length,
    receivedTemplates: received.templates.length,
    receivedDailyNotes: received.dailyNotes.length,
    receivedBytes: received.bytes,
    pageIds: received.pages,
    revisionIds: received.revisions,
    publicationIds: received.publications,
    assetIds: received.assets,
    tagIds: received.tags,
    templateIds: received.templates,
    dailyNoteIds: received.dailyNotes,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    expiresAt: session.expires_at,
  };
}

export interface PreparedBackup {
  body: ReadableStream<Uint8Array>;
  filename: string;
}

export class BackupService {
  private readonly repository: BackupRepository;

  constructor(
    db: D1Database,
    private readonly bucket: R2Bucket,
  ) {
    this.repository = new BackupRepository(db);
  }

  private async verifiedObjectChecksum(record: AssetRecord) {
    let head: R2Object | null;
    try {
      head = await this.bucket.head(record.objectKey);
    } catch {
      head = null;
    }

    if (head === null || head.size !== record.sizeBytes) {
      return null;
    }

    let checksum = await objectSha256(head);
    if (checksum === null) {
      const object = await this.bucket.get(record.objectKey);
      if (object !== null) {
        checksum = await objectSha256(object);
      }
    }
    if (checksum === null) {
      return null;
    }

    if (record.sha256 !== null && normalizeSha256(record.sha256) !== checksum) {
      return null;
    }

    return checksum;
  }

  async prepareBackup(): Promise<PreparedBackup> {
    const [pages, revisions, assets, publications, tags, templates, dailyNotes] = await Promise.all(
      [
        this.repository.listPages(),
        this.repository.listRevisions(),
        this.repository.listAssets(),
        this.repository.listPublications(),
        this.repository.listTags(),
        this.repository.listTemplates(),
        this.repository.listDailyNotes(),
      ],
    );

    let pageRecords: BackupPageRecord[];
    let revisionRecords: BackupRevisionRecord[];
    let publicationRecords: BackupPublicationRecord[];
    let tagRecords: BackupTagRecord[];
    let templateRecords: BackupTemplateRecord[];
    let dailyNoteRecords: BackupDailyNoteRecord[];
    try {
      pageRecords = pages
        .map((page) => pageBackupRecord(page, pageContent(page)))
        .sort((left, right) => compareText(left.id, right.id));
      revisionRecords = revisions
        .map((revision) => {
          const content = parseStoredBackupContent(revision.contentJson);
          const parsed = tiptapDocumentSchema.safeParse(content);
          if (!parsed.success) {
            throw new BackupError(
              500,
              'BACKUP_FAILED',
              'A stored revision contains invalid content.',
            );
          }
          return revisionBackupRecord(revision, parsed.data);
        })
        .sort((left, right) => compareText(left.id, right.id));
      publicationRecords = [];
      for (const publication of publications) {
        const contentValue = parseStoredBackupContent(publication.publishedContentJson);
        const content = publicTiptapDocumentSchema.safeParse(contentValue);
        if (!content.success) {
          throw new BackupError(
            500,
            'BACKUP_FAILED',
            'A stored publication contains invalid content.',
          );
        }
        const [documentAssetIds, relationAssetIds] = await Promise.all([
          Promise.resolve(collectPublicAssetIds(content.data)),
          this.repository.listPublicationAssetIds(publication.id),
        ]);
        const sortedDocumentAssetIds = [...documentAssetIds].sort(compareText);
        const sortedRelationAssetIds = [...relationAssetIds].sort(compareText);
        if (
          sortedDocumentAssetIds.length !== sortedRelationAssetIds.length ||
          sortedDocumentAssetIds.some((assetId, index) => assetId !== sortedRelationAssetIds[index])
        ) {
          throw new BackupError(
            500,
            'BACKUP_FAILED',
            'Publication asset metadata is inconsistent.',
          );
        }
        publicationRecords.push(
          publicationBackupRecord(publication, content.data, sortedDocumentAssetIds),
        );
      }
      publicationRecords.sort((left, right) => compareText(left.id, right.id));
      tagRecords = tags.map(tagBackupRecord).sort((left, right) => compareText(left.id, right.id));
      templateRecords = templates
        .map((template) => {
          const content = parseStoredBackupContent(template.contentJson);
          const parsed = tiptapDocumentSchema.safeParse(content);
          if (!parsed.success) {
            throw new BackupError(
              500,
              'BACKUP_FAILED',
              'A stored template contains invalid content.',
            );
          }
          return templateBackupRecord(template, parsed.data);
        })
        .sort((left, right) => compareText(left.id, right.id));
      dailyNoteRecords = dailyNotes
        .map(dailyNoteBackupRecord)
        .sort((left, right) => compareText(left.id, right.id));
    } catch (error) {
      if (error instanceof BackupError) {
        throw error;
      }
      throw new BackupError(500, 'BACKUP_FAILED', 'The backup contains invalid stored data.');
    }

    const missingAssetIds: string[] = [];
    const paths = assetArchivePathMap(assets);
    const assetRecords: BackupAssetRecord[] = [];
    for (const asset of assets) {
      const checksum = await this.verifiedObjectChecksum(asset);
      if (checksum === null) {
        missingAssetIds.push(asset.id);
        continue;
      }
      try {
        assetRecords.push(assetBackupRecord(asset, paths.get(asset.id)!, checksum));
      } catch (error) {
        if (error instanceof BackupError) {
          throw error;
        }
        throw new BackupError(500, 'BACKUP_FAILED', 'The backup contains invalid asset data.');
      }
    }

    if (missingAssetIds.length > 0) {
      throw new BackupError(
        422,
        'BACKUP_INCOMPLETE',
        'The backup could not be completed because one or more assets are unavailable.',
        { assetIds: missingAssetIds.sort(compareText) },
      );
    }

    const manifest: BackupManifest = backupManifestSchema.parse({
      format: 'dovari-backup',
      version: BACKUP_VERSION,
      exportedAt: nowIso(),
      pages: pageRecords,
      revisions: revisionRecords,
      assets: assetRecords.sort((left, right) => compareText(left.id, right.id)),
      publications: publicationRecords,
      tags: tagRecords,
      templates: templateRecords,
      dailyNotes: dailyNoteRecords,
    });
    const manifestJson = `${canonicalJson(manifest)}\n`;

    const entries: ZipEntrySource[] = [textZipEntry(BACKUP_MANIFEST_FILENAME, manifestJson)];
    for (const asset of manifest.assets) {
      const databaseAsset = assets.find((candidate) => candidate.id === asset.id);
      if (!databaseAsset) {
        throw new BackupError(500, 'BACKUP_FAILED', 'The backup asset metadata is inconsistent.');
      }

      entries.push({
        name: asset.path,
        open: async () => {
          const object = await this.bucket.get(databaseAsset.objectKey);
          if (object === null || !('body' in object)) {
            throw new BackupError(422, 'BACKUP_INCOMPLETE', 'An asset changed during backup.', {
              assetIds: [asset.id],
            });
          }
          return object.body;
        },
      });
    }

    return { body: createZipStream(entries), filename: BACKUP_FILENAME };
  }

  private async sessionStatus(session: RestoreSessionRow): Promise<RestoreSessionStatus> {
    const [records, assets] = await Promise.all([
      this.repository.listRecords(session.id),
      this.repository.listSessionAssets(session.id),
    ]);
    const pageIds = records
      .filter((record) => record.record_type === 'page')
      .map((record) => record.record_id)
      .sort(compareText);
    const revisionIds = records
      .filter((record) => record.record_type === 'revision')
      .map((record) => record.record_id)
      .sort(compareText);
    const publicationIds = records
      .filter((record) => record.record_type === 'publication')
      .map((record) => record.record_id)
      .sort(compareText);
    const tagIds = records
      .filter((record) => record.record_type === 'tag')
      .map((record) => record.record_id)
      .sort(compareText);
    const templateIds = records
      .filter((record) => record.record_type === 'template')
      .map((record) => record.record_id)
      .sort(compareText);
    const dailyNoteIds = records
      .filter((record) => record.record_type === 'dailyNote')
      .map((record) => record.record_id)
      .sort(compareText);
    const receivedAssetIds: string[] = [];
    let receivedBytes = 0;
    for (const asset of assets) {
      const object = await this.bucket.head(asset.object_key);
      if (object === null || object.size !== asset.size_bytes) {
        continue;
      }
      const checksum = await objectSha256(object);
      if (checksum !== null && checksum === asset.sha256) {
        receivedAssetIds.push(asset.asset_id);
        receivedBytes += asset.size_bytes;
      }
    }

    return summaryFromSession(session, {
      assets: receivedAssetIds.sort(compareText),
      bytes: receivedBytes,
      pages: pageIds,
      publications: publicationIds,
      revisions: revisionIds,
      tags: tagIds,
      templates: templateIds,
      dailyNotes: dailyNoteIds,
    });
  }

  private async getOwnedSession(id: string, identity: AuthIdentity | undefined) {
    const session = await this.repository.findSession(id, ownerSubject(identity));
    if (!session) {
      throw restoreSessionNotFound();
    }
    return session;
  }

  private async getWritableSession(id: string, identity: AuthIdentity | undefined) {
    const session = await this.getOwnedSession(id, identity);
    if (session.status === 'finalizing') {
      throw sessionConflict();
    }
    return session;
  }

  async createSession(input: RestoreSessionCreateRequest, identity?: AuthIdentity) {
    const parsed = restoreSessionCreateRequestSchema.parse(input);
    if (parsed.backupVersion === 1 && parsed.expectedPublications !== 0) {
      throw recordMismatch('Backup version 1 cannot contain publications.');
    }
    if (
      parsed.backupVersion === 1 &&
      (parsed.expectedTemplates !== 0 || parsed.expectedDailyNotes !== 0)
    ) {
      throw recordMismatch('Backup version 1 cannot contain templates or daily notes.');
    }
    if (await this.repository.hasWorkspaceData()) {
      throw workspaceNotEmpty();
    }

    if (await this.repository.findActiveSession()) {
      throw sessionConflict();
    }

    const createdAt = nowIso();
    const session = {
      id: crypto.randomUUID(),
      ownerIdentity: ownerSubject(identity),
      backupVersion: parsed.backupVersion,
      expectedPages: parsed.expectedPages,
      expectedRevisions: parsed.expectedRevisions,
      expectedAssets: parsed.expectedAssets,
      expectedTags: parsed.expectedTags,
      expectedPublications: parsed.expectedPublications,
      expectedTemplates: parsed.expectedTemplates,
      expectedDailyNotes: parsed.expectedDailyNotes,
      expectedBytes: parsed.expectedBytes,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.now() + RESTORE_SESSION_TTL_MS).toISOString(),
    } as const;

    try {
      const result = await this.repository.insertSession(session);
      if (result.meta.changes !== 1) {
        throw sessionConflict();
      }
    } catch (error) {
      if (isConstraintError(error)) {
        throw sessionConflict();
      }
      throw error;
    }

    const stored = await this.repository.findSession(session.id, session.ownerIdentity);
    if (!stored) {
      throw new BackupError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    return this.sessionStatus(stored);
  }

  async getSession(id: string, identity?: AuthIdentity) {
    return this.sessionStatus(await this.getOwnedSession(id, identity));
  }

  async putRecord(
    id: string,
    recordTypeValue: string,
    recordId: string,
    request: Request,
    identity?: AuthIdentity,
  ) {
    const session = await this.getWritableSession(id, identity);
    if (!isRecordType(recordTypeValue) || !/^[0-9a-f-]{36}$/iu.test(recordId)) {
      throw new BackupError(400, 'INVALID_REQUEST', 'The restore record identifier is invalid.');
    }
    if (session.backup_version === 1 && recordTypeValue === 'publication') {
      throw recordMismatch('Backup version 1 cannot contain publications.');
    }
    if (
      session.backup_version === 1 &&
      (recordTypeValue === 'template' || recordTypeValue === 'dailyNote')
    ) {
      throw recordMismatch('Backup version 1 cannot contain templates or daily notes.');
    }

    const contentLength = request.headers.get('Content-Length');
    if (
      contentLength !== null &&
      (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_PAGE_REQUEST_BYTES)
    ) {
      throw new BackupError(413, 'PAGE_TOO_LARGE', 'The restore record is too large.');
    }

    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_PAGE_REQUEST_BYTES) {
      throw new BackupError(413, 'PAGE_TOO_LARGE', 'The restore record is too large.');
    }

    let value: unknown;
    try {
      value = JSON.parse(body) as unknown;
    } catch {
      throw new BackupError(
        422,
        'RESTORE_RECORD_MISMATCH',
        'The restore record is not valid JSON.',
      );
    }

    const parsed =
      recordTypeValue === 'page'
        ? backupPageRecordSchema.safeParse(value)
        : recordTypeValue === 'revision'
          ? backupRevisionRecordSchema.safeParse(value)
          : recordTypeValue === 'publication'
            ? backupPublicationRecordSchema.safeParse(value)
            : recordTypeValue === 'tag'
              ? backupTagRecordSchema.safeParse(value)
              : recordTypeValue === 'template'
                ? backupTemplateRecordSchema.safeParse(value)
                : backupDailyNoteRecordSchema.safeParse(value);
    if (!parsed.success || parsed.data.id !== recordId) {
      throw new BackupError(
        422,
        'RESTORE_RECORD_MISMATCH',
        'The restore record does not match its identifier.',
      );
    }

    const rawPayloadJson = canonicalRecordJson(value);
    const payloadJson = canonicalRecordJson(parsed.data);
    const sha256 = await sha256Hex(payloadJson);
    const rawSha256 = await sha256Hex(rawPayloadJson);
    const declaredSha = request.headers.get('X-Dovari-SHA-256');
    if (declaredSha !== null && declaredSha !== sha256 && declaredSha !== rawSha256) {
      throw new BackupError(
        422,
        'RESTORE_RECORD_MISMATCH',
        'The restore record checksum is invalid.',
      );
    }

    const existing = await this.repository.findRecord(session.id, recordTypeValue, recordId);
    if (existing) {
      if (existing.sha256 !== sha256 || existing.payload_json !== payloadJson) {
        throw new BackupError(
          409,
          'RESTORE_RECORD_MISMATCH',
          'A different record is already staged.',
        );
      }
      return { accepted: true as const, recordType: recordTypeValue, recordId };
    }

    const currentRecords = await this.repository.listRecords(session.id);
    const expectedCount =
      recordTypeValue === 'page'
        ? session.expected_pages
        : recordTypeValue === 'revision'
          ? session.expected_revisions
          : recordTypeValue === 'publication'
            ? session.expected_publications
            : recordTypeValue === 'tag'
              ? session.expected_tags
              : recordTypeValue === 'template'
                ? session.expected_templates
                : session.expected_daily_notes;
    if (
      currentRecords.filter((record) => record.record_type === recordTypeValue).length >=
      expectedCount
    ) {
      throw new BackupError(
        409,
        'RESTORE_RECORD_MISMATCH',
        'The restore session received too many records.',
      );
    }

    if (session.status === 'failed') {
      await this.repository.updateStatus(session.id, ownerSubject(identity), 'uploading');
    }

    try {
      await this.repository.insertRecord({
        sessionId: session.id,
        recordType: recordTypeValue,
        recordId,
        payloadJson,
        sha256,
        uploadedAt: nowIso(),
      });
    } catch (error) {
      if (isConstraintError(error)) {
        throw new BackupError(
          409,
          'RESTORE_RECORD_MISMATCH',
          'The restore record could not be staged.',
        );
      }
      throw error;
    }

    return { accepted: true as const, recordType: recordTypeValue, recordId };
  }

  private async metadataFromRequest(request: Request, assetId: string) {
    const encoded = request.headers.get('X-Dovari-Asset-Metadata');
    if (encoded === null) {
      throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The asset metadata is required.');
    }

    let value: unknown;
    try {
      value = JSON.parse(decodeBase64Url(encoded)) as unknown;
    } catch (error) {
      if (error instanceof BackupError) {
        throw error;
      }
      throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The asset metadata is invalid.');
    }
    const parsed = backupAssetRecordSchema.safeParse(value);
    if (!parsed.success || parsed.data.id !== assetId) {
      throw new BackupError(
        422,
        'RESTORE_RECORD_MISMATCH',
        'The asset metadata does not match its identifier.',
      );
    }

    if (!isSafeFilename(parsed.data.originalFilename)) {
      throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The asset filename is invalid.');
    }
    try {
      assetTypeForMimeType(parsed.data.mimeType);
    } catch {
      throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The asset MIME type is not allowed.');
    }

    const declaredSha = parseSha256Header(request.headers.get('X-Dovari-SHA-256'));
    if (declaredSha !== parsed.data.sha256) {
      throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The asset checksum is invalid.');
    }

    return parsed.data;
  }

  private async objectMatches(key: string, sizeBytes: number, sha256: string) {
    const head = await this.bucket.head(key);
    if (head === null || head.size !== sizeBytes) {
      return false;
    }
    let actual = await objectSha256(head);
    if (actual === null) {
      const object = await this.bucket.get(key);
      if (object !== null) {
        actual = await objectSha256(object);
      }
    }
    return actual === sha256;
  }

  async putAsset(id: string, assetId: string, request: Request, identity?: AuthIdentity) {
    const session = await this.getWritableSession(id, identity);
    const metadata = await this.metadataFromRequest(request, assetId);
    if (metadata.sizeBytes > MAX_ASSET_SIZE_BYTES) {
      throw new BackupError(413, 'ASSET_TOO_LARGE', 'The restore asset is too large.');
    }

    const rawLength = request.headers.get('Content-Length');
    if (
      rawLength !== null &&
      (!/^\d+$/u.test(rawLength) || Number(rawLength) !== metadata.sizeBytes)
    ) {
      throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The asset size is invalid.');
    }

    const metadataJson = canonicalAssetMetadata(metadata);
    const existing = await this.repository.findAsset(session.id, assetId);
    const temporaryKey = restoreTemporaryObjectKey(session.id, assetId);
    if (existing) {
      if (
        existing.metadata_json !== metadataJson ||
        existing.size_bytes !== metadata.sizeBytes ||
        existing.sha256 !== metadata.sha256
      ) {
        throw new BackupError(
          409,
          'RESTORE_RECORD_MISMATCH',
          'A different asset is already staged.',
        );
      }

      if (await this.objectMatches(existing.object_key, metadata.sizeBytes, metadata.sha256)) {
        return { accepted: true as const, assetId };
      }

      await this.repository.deleteAsset(session.id, assetId);
    }

    const assets = await this.repository.listSessionAssets(session.id);
    if (existing === null && assets.length >= session.expected_assets) {
      throw new BackupError(
        409,
        'RESTORE_RECORD_MISMATCH',
        'The restore session received too many assets.',
      );
    }

    const body = request.body ?? new Uint8Array();
    try {
      await this.bucket.put(temporaryKey, body, {
        httpMetadata: { contentType: metadata.mimeType },
      });
      if (!(await this.objectMatches(temporaryKey, metadata.sizeBytes, metadata.sha256))) {
        await this.bucket.delete(temporaryKey);
        throw incompleteRestore('The uploaded asset does not match its declared checksum.');
      }

      if (session.status === 'failed') {
        await this.repository.updateStatus(session.id, ownerSubject(identity), 'uploading');
      }
      await this.repository.insertAsset({
        sessionId: session.id,
        assetId,
        objectKey: temporaryKey,
        metadataJson,
        sizeBytes: metadata.sizeBytes,
        sha256: metadata.sha256,
        uploadedAt: nowIso(),
      });
    } catch (error) {
      await this.bucket.delete(temporaryKey);
      if (error instanceof BackupError) {
        throw error;
      }
      if (isConstraintError(error)) {
        throw new BackupError(409, 'RESTORE_RECORD_MISMATCH', 'The asset could not be staged.');
      }
      throw new BackupError(500, 'RESTORE_FINALIZE_FAILED', 'The asset upload failed.');
    }

    return { accepted: true as const, assetId };
  }

  private async validateStaged(
    session: RestoreSessionRow,
    recordRows: RestoreSessionRecordRow[],
    assetRows: RestoreSessionAssetRow[],
  ) {
    const pageRows = recordRows.filter((row) => row.record_type === 'page');
    const revisionRows = recordRows.filter((row) => row.record_type === 'revision');
    const publicationRows = recordRows.filter((row) => row.record_type === 'publication');
    const tagRows = recordRows.filter((row) => row.record_type === 'tag');
    const templateRows = recordRows.filter((row) => row.record_type === 'template');
    const dailyNoteRows = recordRows.filter((row) => row.record_type === 'dailyNote');
    if (
      pageRows.length !== session.expected_pages ||
      revisionRows.length !== session.expected_revisions ||
      publicationRows.length !== session.expected_publications ||
      tagRows.length !== session.expected_tags ||
      templateRows.length !== session.expected_templates ||
      dailyNoteRows.length !== session.expected_daily_notes ||
      assetRows.length !== session.expected_assets
    ) {
      throw incompleteRestore();
    }

    const tags: BackupTagRecord[] = [];
    const tagIds = new Set<string>();
    const tagNames = new Set<string>();
    for (const row of tagRows) {
      let value: unknown;
      try {
        value = JSON.parse(row.payload_json) as unknown;
      } catch {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'A staged tag record is invalid.');
      }
      const parsed = backupTagRecordSchema.safeParse(value);
      if (!parsed.success || parsed.data.id !== row.record_id) {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'A staged tag record is invalid.');
      }
      if (
        canonicalJson(parsed.data) !== row.payload_json ||
        (await sha256Hex(row.payload_json)) !== row.sha256 ||
        tagIds.has(parsed.data.id) ||
        tagNames.has(parsed.data.nameNormalized) ||
        parsed.data.name !== normalizeTagName(parsed.data.name) ||
        parsed.data.nameNormalized !== normalizeTagNameForComparison(parsed.data.name)
      ) {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The staged tag metadata changed.');
      }
      tagIds.add(parsed.data.id);
      tagNames.add(parsed.data.nameNormalized);
      tags.push(parsed.data);
    }

    const pages: BackupPageRecord[] = [];
    const pageIds = new Set<string>();
    for (const row of pageRows) {
      let value: unknown;
      try {
        value = JSON.parse(row.payload_json) as unknown;
      } catch {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'A staged page record is invalid.');
      }
      const parsed = backupPageRecordSchema.safeParse(value);
      if (!parsed.success || parsed.data.id !== row.record_id) {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'A staged page record is invalid.');
      }
      if (
        canonicalJson(parsed.data) !== row.payload_json ||
        (await sha256Hex(row.payload_json)) !== row.sha256
      ) {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'A staged page record changed.');
      }
      if (pageIds.has(parsed.data.id)) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'The backup contains duplicate pages.',
        );
      }
      pageIds.add(parsed.data.id);
      if (parsed.data.tagIds.some((tagId) => !tagIds.has(tagId))) {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'A page references a missing tag.');
      }
      pages.push(parsed.data);
    }

    const revisions: BackupRevisionRecord[] = [];
    const revisionIds = new Set<string>();
    for (const row of revisionRows) {
      let value: unknown;
      try {
        value = JSON.parse(row.payload_json) as unknown;
      } catch {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A staged revision record is invalid.',
        );
      }
      const parsed = backupRevisionRecordSchema.safeParse(value);
      if (!parsed.success || parsed.data.id !== row.record_id) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A staged revision record is invalid.',
        );
      }
      if (
        canonicalJson(parsed.data) !== row.payload_json ||
        (await sha256Hex(row.payload_json)) !== row.sha256
      ) {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'A staged revision record changed.');
      }
      if (revisionIds.has(parsed.data.id)) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'The backup contains duplicate revisions.',
        );
      }
      revisionIds.add(parsed.data.id);
      revisions.push(parsed.data);
    }

    const publications: BackupPublicationRecord[] = [];
    const publicationIds = new Set<string>();
    const publicIds = new Set<string>();
    for (const row of publicationRows) {
      let value: unknown;
      try {
        value = JSON.parse(row.payload_json) as unknown;
      } catch {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A staged publication record is invalid.',
        );
      }
      const parsed = backupPublicationRecordSchema.safeParse(value);
      if (!parsed.success || parsed.data.id !== row.record_id) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A staged publication record is invalid.',
        );
      }
      if (
        canonicalJson(parsed.data) !== row.payload_json ||
        (await sha256Hex(row.payload_json)) !== row.sha256 ||
        publicationIds.has(parsed.data.id) ||
        publicIds.has(parsed.data.publicId)
      ) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'The staged publication metadata changed.',
        );
      }
      publicationIds.add(parsed.data.id);
      publicIds.add(parsed.data.publicId);
      publications.push(parsed.data);
    }

    const assets: BackupAssetRecord[] = [];
    const assetIds = new Set<string>();
    let expectedBytes = 0;
    const paths = new Set<string>();
    for (const row of assetRows) {
      let value: unknown;
      try {
        value = JSON.parse(row.metadata_json) as unknown;
      } catch {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'A staged asset record is invalid.');
      }
      const parsed = backupAssetRecordSchema.safeParse(value);
      if (!parsed.success || parsed.data.id !== row.asset_id) {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'A staged asset record is invalid.');
      }
      if (
        canonicalJson(parsed.data) !== row.metadata_json ||
        row.sha256 !== parsed.data.sha256 ||
        row.size_bytes !== parsed.data.sizeBytes ||
        assetIds.has(parsed.data.id) ||
        paths.has(parsed.data.path)
      ) {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The staged asset metadata changed.');
      }
      if (!isSafeFilename(parsed.data.originalFilename)) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A staged asset filename is invalid.',
        );
      }
      try {
        assetTypeForMimeType(parsed.data.mimeType);
      } catch {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A staged asset MIME type is invalid.',
        );
      }
      if (!(await this.objectMatches(row.object_key, parsed.data.sizeBytes, parsed.data.sha256))) {
        throw incompleteRestore('A staged asset is missing or has a different checksum.');
      }
      expectedBytes += parsed.data.sizeBytes;
      if (!Number.isSafeInteger(expectedBytes)) {
        throw incompleteRestore('The restore asset total is too large.');
      }
      assetIds.add(parsed.data.id);
      paths.add(parsed.data.path);
      assets.push(parsed.data);
    }
    if (expectedBytes !== session.expected_bytes) {
      throw new BackupError(
        422,
        'RESTORE_RECORD_MISMATCH',
        'The staged asset total does not match the backup.',
      );
    }

    const templates: BackupTemplateRecord[] = [];
    const templateIds = new Set<string>();
    const templateTitles = new Set<string>();
    const dailyTemplateIds = new Set<string>();
    for (const row of templateRows) {
      let value: unknown;
      try {
        value = JSON.parse(row.payload_json) as unknown;
      } catch {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A staged template record is invalid.',
        );
      }
      const parsed = backupTemplateRecordSchema.safeParse(value);
      if (!parsed.success || parsed.data.id !== row.record_id) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A staged template record is invalid.',
        );
      }
      const normalizedTitle = parsed.data.title.toLocaleLowerCase();
      if (
        canonicalJson(parsed.data) !== row.payload_json ||
        (await sha256Hex(row.payload_json)) !== row.sha256 ||
        templateIds.has(parsed.data.id) ||
        templateTitles.has(normalizedTitle) ||
        (parsed.data.isDailyNote && dailyTemplateIds.size > 0)
      ) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'The staged template metadata changed.',
        );
      }
      templateIds.add(parsed.data.id);
      templateTitles.add(normalizedTitle);
      if (parsed.data.isDailyNote) dailyTemplateIds.add(parsed.data.id);
      templates.push(parsed.data);
    }

    const dailyNotes: BackupDailyNoteRecord[] = [];
    const dailyNoteIds = new Set<string>();
    const dailyNoteDates = new Set<string>();
    const dailyNotePageIds = new Set<string>();
    for (const row of dailyNoteRows) {
      let value: unknown;
      try {
        value = JSON.parse(row.payload_json) as unknown;
      } catch {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A staged daily-note record is invalid.',
        );
      }
      const parsed = backupDailyNoteRecordSchema.safeParse(value);
      if (!parsed.success || parsed.data.id !== row.record_id) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A staged daily-note record is invalid.',
        );
      }
      if (
        canonicalJson(parsed.data) !== row.payload_json ||
        (await sha256Hex(row.payload_json)) !== row.sha256 ||
        dailyNoteIds.has(parsed.data.id) ||
        dailyNoteDates.has(parsed.data.localDate) ||
        dailyNotePageIds.has(parsed.data.pageId)
      ) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'The staged daily-note metadata changed.',
        );
      }
      dailyNoteIds.add(parsed.data.id);
      dailyNoteDates.add(parsed.data.localDate);
      dailyNotePageIds.add(parsed.data.pageId);
      dailyNotes.push(parsed.data);
    }

    const pagesById = new Map(pages.map((page) => [page.id, page]));
    const slugs = new Set<string>();
    const siblingPositions = new Map<string, Set<number>>();
    for (const page of pages) {
      if (slugs.has(page.slug.toLowerCase())) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'The backup contains duplicate page slugs.',
        );
      }
      slugs.add(page.slug.toLowerCase());
      if (page.parentId === page.id || (page.parentId !== null && !pagesById.has(page.parentId))) {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The page hierarchy is invalid.');
      }
      const key = page.parentId ?? 'root';
      const positions = siblingPositions.get(key) ?? new Set<number>();
      if (positions.has(page.position)) {
        throw new BackupError(422, 'RESTORE_RECORD_MISMATCH', 'The page positions are invalid.');
      }
      positions.add(page.position);
      siblingPositions.set(key, positions);
      const contentJson = canonicalJson(page.content);
      const contentText = derivePlainText(page.content);
      if (
        estimatePageRowBytes({
          id: page.id,
          title: page.title,
          slug: page.slug,
          contentJson,
          contentText,
          parentId: page.parentId,
          position: page.position,
          revision: page.revision,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
        }) > MAX_PAGE_ROW_BYTES
      ) {
        throw new BackupError(413, 'PAGE_TOO_LARGE', 'A restored page is too large.');
      }
    }

    for (const template of templates) {
      for (const assetId of collectAssetIds(template.content)) {
        if (!assetIds.has(assetId)) {
          throw new BackupError(
            422,
            'RESTORE_RECORD_MISMATCH',
            'A template references a missing asset.',
          );
        }
      }
    }
    const templatesById = new Map(templates.map((template) => [template.id, template]));
    for (const dailyNote of dailyNotes) {
      if (!pageIds.has(dailyNote.pageId)) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A daily note references a missing page.',
        );
      }
      if (
        dailyNote.templateId !== null &&
        (!templatesById.get(dailyNote.templateId)?.isDailyNote ||
          !templatesById.has(dailyNote.templateId))
      ) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A daily note references an invalid template.',
        );
      }
    }

    for (const publication of publications) {
      const page = pagesById.get(publication.pageId);
      if (!page || page.deletedAt !== null || publication.sourceRevision > page.revision) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A publication references an invalid page.',
        );
      }
      const documentAssets = collectPublicAssetIds(publication.content).sort(compareText);
      const declaredAssets = [...publication.assetIds].sort(compareText);
      if (
        documentAssets.length !== declaredAssets.length ||
        documentAssets.some((assetId, index) => assetId !== declaredAssets[index]) ||
        documentAssets.some((assetId) => !assetIds.has(assetId))
      ) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A publication references an invalid asset.',
        );
      }
      const targetPublicIds = new Set<string>();
      const visit = (node: {
        type: string;
        attrs?: Record<string, unknown>;
        content?: unknown[];
      }) => {
        if (node.type === 'publicWikiLink' && typeof node.attrs?.targetPublicId === 'string') {
          targetPublicIds.add(node.attrs.targetPublicId);
        }
        if (Array.isArray(node.content)) {
          node.content.forEach((child) => {
            if (typeof child === 'object' && child !== null) {
              visit(
                child as { type: string; attrs?: Record<string, unknown>; content?: unknown[] },
              );
            }
          });
        }
      };
      publication.content.content.forEach((node) => visit(node));
      if ([...targetPublicIds].some((targetId) => !publicIds.has(targetId))) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A publication references a missing public page.',
        );
      }
      if (
        publication.publishedParentPublicId !== undefined &&
        publication.publishedParentPublicId !== null &&
        !publicIds.has(publication.publishedParentPublicId)
      ) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A publication references a missing public parent.',
        );
      }
    }

    for (const [parentId, positions] of siblingPositions) {
      const sorted = [...positions].sort((left, right) => left - right);
      if (sorted.some((position, index) => position !== index)) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          `The positions for ${parentId} are invalid.`,
        );
      }
    }

    for (const page of pages) {
      for (const assetId of collectAssetIds(page.content)) {
        if (!assetIds.has(assetId)) {
          throw new BackupError(
            422,
            'RESTORE_RECORD_MISMATCH',
            'A page references a missing asset.',
          );
        }
      }
    }
    for (const revision of revisions) {
      if (!pageIds.has(revision.pageId)) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'A revision references a missing page.',
        );
      }
      for (const assetId of collectAssetIds(revision.content)) {
        if (!assetIds.has(assetId)) {
          throw new BackupError(
            422,
            'RESTORE_RECORD_MISMATCH',
            'A revision references a missing asset.',
          );
        }
      }
    }
    for (const asset of assets) {
      if (asset.uploadedForPageId !== null && !pageIds.has(asset.uploadedForPageId)) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'An asset references a missing page.',
        );
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (pageId: string) => {
      if (visiting.has(pageId)) {
        throw new BackupError(
          422,
          'RESTORE_RECORD_MISMATCH',
          'The page hierarchy contains a cycle.',
        );
      }
      if (visited.has(pageId)) {
        return;
      }
      visiting.add(pageId);
      const parentId = pagesById.get(pageId)?.parentId;
      if (parentId !== null && parentId !== undefined) {
        visit(parentId);
      }
      visiting.delete(pageId);
      visited.add(pageId);
    };
    pages.forEach((page) => visit(page.id));

    return { assets, dailyNotes, pages, publications, revisions, tags, templates };
  }

  private async copyAssets(sessionId: string, assets: BackupAssetRecord[]) {
    const copiedKeys: string[] = [];
    try {
      for (const asset of assets) {
        const temporaryKey = restoreTemporaryObjectKey(sessionId, asset.id);
        const object = await this.bucket.get(temporaryKey);
        if (object === null || !('body' in object)) {
          throw incompleteRestore('A staged asset is no longer available.');
        }
        const permanentKey = assetPermanentObjectKey(asset);
        await this.bucket.put(permanentKey, object.body, {
          httpMetadata: { contentType: asset.mimeType },
        });
        copiedKeys.push(permanentKey);
        if (!(await this.objectMatches(permanentKey, asset.sizeBytes, asset.sha256))) {
          throw new BackupError(
            500,
            'RESTORE_FINALIZE_FAILED',
            'A restored asset failed verification.',
          );
        }
      }
      return copiedKeys;
    } catch (error) {
      await Promise.allSettled(copiedKeys.map((key) => this.bucket.delete(key)));
      throw error;
    }
  }

  async finalize(id: string, identity?: AuthIdentity) {
    const session = await this.getWritableSession(id, identity);
    const ownerIdentity = ownerSubject(identity);
    let copiedKeys: string[] = [];
    try {
      const [recordRows, assetRows] = await Promise.all([
        this.repository.listRecords(session.id),
        this.repository.listSessionAssets(session.id),
      ]);
      const validated = await this.validateStaged(session, recordRows, assetRows);

      const statusUpdate = await this.repository.db
        .prepare(
          `UPDATE restore_sessions
           SET status = 'finalizing', updated_at = ?
           WHERE id = ? AND owner_identity = ? AND status IN ('uploading', 'failed')
             AND NOT EXISTS (SELECT 1 FROM pages)
             AND NOT EXISTS (SELECT 1 FROM assets)
             AND NOT EXISTS (SELECT 1 FROM tags)
             AND NOT EXISTS (SELECT 1 FROM templates)
             AND NOT EXISTS (SELECT 1 FROM daily_notes)`,
        )
        .bind(nowIso(), session.id, ownerIdentity)
        .run();
      if (statusUpdate.meta.changes !== 1) {
        throw workspaceNotEmpty();
      }

      copiedKeys = await this.copyAssets(session.id, validated.assets);

      const commitToken = nowIso();
      const commitGuard = `UPDATE restore_sessions
        SET updated_at = ?
        WHERE id = ? AND owner_identity = ? AND status = 'finalizing'
          AND NOT EXISTS (SELECT 1 FROM pages)
          AND NOT EXISTS (SELECT 1 FROM assets)
          AND NOT EXISTS (SELECT 1 FROM tags)
          AND NOT EXISTS (SELECT 1 FROM templates)
          AND NOT EXISTS (SELECT 1 FROM daily_notes)`;
      const ready = `EXISTS (
        SELECT 1 FROM restore_sessions
        WHERE id = ? AND owner_identity = ? AND status = 'finalizing' AND updated_at = ?
      )`;
      const statements: D1PreparedStatement[] = [
        this.repository.db.prepare(commitGuard).bind(commitToken, session.id, ownerIdentity),
      ];
      const bindReady = (values: unknown[]) => [...values, session.id, ownerIdentity, commitToken];

      const pagesById = new Map(validated.pages.map((page) => [page.id, page]));
      const pageInsertOrder = [...validated.pages].sort((left, right) => {
        const depth = (page: BackupPageRecord) => {
          let value = page;
          let count = 0;
          const seen = new Set<string>();
          while (value.parentId !== null && !seen.has(value.id)) {
            seen.add(value.id);
            const parent = pagesById.get(value.parentId);
            if (!parent) break;
            value = parent;
            count += 1;
          }
          return count;
        };
        return depth(left) - depth(right) || compareText(left.id, right.id);
      });

      for (const tag of validated.tags) {
        statements.push(
          this.repository.db
            .prepare(
              `INSERT INTO tags (id, name, name_normalized, created_at, updated_at)
               SELECT ?, ?, ?, ?, ? WHERE ${ready}`,
            )
            .bind(
              ...bindReady([tag.id, tag.name, tag.nameNormalized, tag.createdAt, tag.updatedAt]),
            ),
        );
      }

      for (const template of validated.templates) {
        statements.push(
          this.repository.db
            .prepare(
              `INSERT INTO templates
                (id, title, content_json, revision, is_daily_note, created_at, updated_at)
               SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${ready}`,
            )
            .bind(
              ...bindReady([
                template.id,
                template.title,
                canonicalJson(template.content),
                template.revision,
                template.isDailyNote ? 1 : 0,
                template.createdAt,
                template.updatedAt,
              ]),
            ),
        );
      }

      for (const page of pageInsertOrder) {
        const contentJson = canonicalJson(page.content);
        const contentText = derivePlainText(page.content);
        statements.push(
          this.repository.db
            .prepare(
              `INSERT INTO pages
                (id, title, slug, content_json, content_text, parent_id, position, revision,
                 created_at, updated_at, deleted_at, is_favorite)
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
               WHERE ${ready}`,
            )
            .bind(
              ...bindReady([
                page.id,
                page.title,
                page.slug,
                contentJson,
                contentText,
                page.parentId,
                page.position,
                page.revision,
                page.createdAt,
                page.updatedAt,
                page.deletedAt,
                page.isFavorite ? 1 : 0,
              ]),
            ),
        );
      }

      for (const dailyNote of validated.dailyNotes) {
        statements.push(
          this.repository.db
            .prepare(
              `INSERT INTO daily_notes
                (id, local_date, time_zone, page_id, template_id, created_at, updated_at)
               SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${ready}`,
            )
            .bind(
              ...bindReady([
                dailyNote.id,
                dailyNote.localDate,
                dailyNote.timeZone,
                dailyNote.pageId,
                dailyNote.templateId,
                dailyNote.createdAt,
                dailyNote.updatedAt,
              ]),
            ),
        );
      }

      for (const asset of validated.assets) {
        statements.push(
          this.repository.db
            .prepare(
              `INSERT INTO assets
                (id, object_key, original_filename, mime_type, size_bytes, width, height, sha256,
                 uploaded_for_page_id, created_at, deleted_at)
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
               WHERE ${ready}`,
            )
            .bind(
              ...bindReady([
                asset.id,
                assetPermanentObjectKey(asset),
                asset.originalFilename,
                asset.mimeType,
                asset.sizeBytes,
                asset.width,
                asset.height,
                asset.sha256,
                asset.uploadedForPageId,
                asset.createdAt,
                asset.deletedAt,
              ]),
            ),
        );
      }

      for (const publication of validated.publications) {
        statements.push(
          this.repository.db
            .prepare(
              `INSERT INTO page_publications
                (id, page_id, public_id, source_revision, published_content_json,
                 published_content_text, published_title, published_tags_json, allow_indexing,
                 published_parent_public_id, published_position, published_at, updated_at)
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${ready}`,
            )
            .bind(
              ...bindReady([
                publication.id,
                publication.pageId,
                publication.publicId,
                publication.sourceRevision,
                canonicalJson(publication.content),
                derivePublicPlainText(publication.content),
                publication.publishedTitle,
                canonicalJson(publication.tags),
                publication.allowIndexing ? 1 : 0,
                publication.publishedParentPublicId ?? null,
                publication.publishedPosition ?? 0,
                publication.publishedAt,
                publication.updatedAt,
              ]),
            ),
        );
      }

      for (const publication of validated.publications) {
        for (const assetId of publication.assetIds) {
          statements.push(
            this.repository.db
              .prepare(
                `INSERT INTO publication_assets (publication_id, asset_id)
                 SELECT ?, ? WHERE ${ready}`,
              )
              .bind(...bindReady([publication.id, assetId])),
          );
        }
      }

      for (const page of validated.pages) {
        for (const tagId of page.tagIds) {
          statements.push(
            this.repository.db
              .prepare(
                `INSERT INTO page_tags (page_id, tag_id)
                 SELECT ?, ? WHERE ${ready}`,
              )
              .bind(...bindReady([page.id, tagId])),
          );
        }

        for (const assetId of collectAssetIds(page.content)) {
          statements.push(
            this.repository.db
              .prepare(
                `INSERT INTO page_assets (page_id, asset_id)
                 SELECT ?, ? WHERE ${ready}`,
              )
              .bind(...bindReady([page.id, assetId])),
          );
        }

        for (const link of collectWikiLinkReferences(page.content)) {
          const target = link.targetPageId !== null ? pagesById.get(link.targetPageId) : undefined;
          statements.push(
            this.repository.db
              .prepare(
                `INSERT INTO page_links
                  (id, source_page_id, target_page_id, target_title, target_title_normalized, created_at)
                 SELECT ?, ?, ?, ?, ?, ? WHERE ${ready}`,
              )
              .bind(
                ...bindReady([
                  crypto.randomUUID(),
                  page.id,
                  target && target.deletedAt === null ? target.id : null,
                  link.targetTitle,
                  link.targetTitleNormalized,
                  page.updatedAt,
                ]),
              ),
          );
        }
      }

      for (const revision of validated.revisions) {
        statements.push(
          this.repository.db
            .prepare(
              `INSERT INTO page_revisions
                (id, page_id, source_revision, title, content_json, trigger, created_at)
               SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${ready}`,
            )
            .bind(
              ...bindReady([
                revision.id,
                revision.pageId,
                revision.sourceRevision,
                revision.title,
                canonicalJson(revision.content),
                revision.trigger,
                revision.createdAt,
              ]),
            ),
        );
      }

      statements.push(
        this.repository.db
          .prepare(
            `DELETE FROM restore_sessions
             WHERE id = ? AND owner_identity = ? AND status = 'finalizing' AND updated_at = ?`,
          )
          .bind(session.id, ownerIdentity, commitToken),
      );

      await this.repository.db.batch(statements);
      if (await this.repository.findSession(session.id, ownerIdentity)) {
        throw workspaceNotEmpty();
      }

      const temporaryAssets = assetRows.map((asset) => asset.object_key);
      await Promise.allSettled(temporaryAssets.map((key) => this.bucket.delete(key)));
      return {
        restored: true as const,
        pageCount: validated.pages.length,
        revisionCount: validated.revisions.length,
        assetCount: validated.assets.length,
        tagCount: validated.tags.length,
        publicationCount: validated.publications.length,
        templateCount: validated.templates.length,
        dailyNoteCount: validated.dailyNotes.length,
      };
    } catch (error) {
      await Promise.allSettled(copiedKeys.map((key) => this.bucket.delete(key)));
      await this.repository.updateStatus(id, ownerIdentity, 'failed');
      if (error instanceof BackupError) {
        throw error.code === 'RESTORE_WORKSPACE_NOT_EMPTY'
          ? error
          : error.code === 'RESTORE_INCOMPLETE' || error.code === 'RESTORE_RECORD_MISMATCH'
            ? error
            : new BackupError(500, 'RESTORE_FINALIZE_FAILED', error.message);
      }
      throw new BackupError(500, 'RESTORE_FINALIZE_FAILED', 'The restore could not be completed.');
    }
  }

  async abort(id: string, identity?: AuthIdentity) {
    const session = await this.getOwnedSession(id, identity);
    if (session.status === 'finalizing') {
      throw sessionConflict();
    }
    const assets = await this.repository.listSessionAssets(id);
    await this.repository.deleteSession(id, ownerSubject(identity));
    await Promise.allSettled(assets.map((asset) => this.bucket.delete(asset.object_key)));
    return { deleted: true as const, sessionId: id };
  }
}
