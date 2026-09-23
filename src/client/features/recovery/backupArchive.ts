import {
  BACKUP_MANIFEST_FILENAME,
  backupManifestSchema,
  canonicalJson,
  sha256Hex,
  type BackupManifest,
} from '../../../shared/backup';
import { collectAssetIds } from '../../../shared/pages';
import { collectPublicAssetIds } from '../../../shared/publications';
import { normalizeTagName, normalizeTagNameForComparison } from '../../../shared/tags';

const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_MAX_COMMENT_LENGTH = 65_535;

export class BackupArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupArchiveError';
  }
}

export interface ValidatedBackupArchive {
  file: File;
  manifest: BackupManifest;
  entries: ReadonlyMap<string, Uint8Array>;
  manifestSha256: string;
  totalAssetBytes: number;
}

function uint16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function uint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function invalidArchive() {
  return new BackupArchiveError('This file is not a valid Dovari backup.');
}

function decodeName(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalidArchive();
  }
}

function safeZipPath(name: string) {
  return (
    name.length > 0 &&
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') &&
    ![...name].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function readStoredZipEntries(bytes: Uint8Array) {
  const searchStart = Math.max(0, bytes.byteLength - 22 - ZIP_MAX_COMMENT_LENGTH);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (offset >= 0 && uint32(bytes, offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) {
    throw invalidArchive();
  }

  const commentLength = uint16(bytes, endOffset + 20);
  if (endOffset + 22 + commentLength !== bytes.byteLength) {
    throw invalidArchive();
  }

  const entryCount = uint16(bytes, endOffset + 10);
  const centralDirectorySize = uint32(bytes, endOffset + 12);
  const centralDirectoryOffset = uint32(bytes, endOffset + 16);
  if (centralDirectoryOffset + centralDirectorySize > bytes.byteLength || entryCount === 0) {
    throw invalidArchive();
  }

  const entries = new Map<string, Uint8Array>();
  const pathKeys = new Set<string>();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > bytes.byteLength ||
      uint32(bytes, offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw invalidArchive();
    }
    const flags = uint16(bytes, offset + 8);
    const compression = uint16(bytes, offset + 10);
    const compressedSize = uint32(bytes, offset + 20);
    const uncompressedSize = uint32(bytes, offset + 24);
    const nameLength = uint16(bytes, offset + 28);
    const extraLength = uint16(bytes, offset + 30);
    const fileCommentLength = uint16(bytes, offset + 32);
    const localOffset = uint32(bytes, offset + 42);
    const recordLength = 46 + nameLength + extraLength + fileCommentLength;
    if (offset + recordLength > bytes.byteLength || compression !== 0 || (flags & 0x1) !== 0) {
      throw invalidArchive();
    }

    const name = decodeName(bytes.slice(offset + 46, offset + 46 + nameLength));
    const pathKey = name.toLocaleLowerCase('en-US');
    if (!safeZipPath(name) || pathKeys.has(pathKey)) {
      throw new BackupArchiveError('The backup contains an unsafe or duplicate ZIP path.');
    }
    pathKeys.add(pathKey);

    if (
      localOffset + 30 > bytes.byteLength ||
      uint32(bytes, localOffset) !== ZIP_LOCAL_FILE_SIGNATURE
    ) {
      throw invalidArchive();
    }
    const localNameLength = uint16(bytes, localOffset + 26);
    const localExtraLength = uint16(bytes, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (
      dataOffset + compressedSize > bytes.byteLength ||
      compressedSize !== uncompressedSize ||
      decodeName(bytes.slice(localOffset + 30, localOffset + 30 + localNameLength)) !== name
    ) {
      throw invalidArchive();
    }
    entries.set(name, bytes.slice(dataOffset, dataOffset + compressedSize));
    offset += recordLength;
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw invalidArchive();
  }
  return entries;
}

function validateManifestSemantics(manifest: BackupManifest) {
  const pageIds = new Set<string>();
  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();
  const tagIds = new Set<string>();
  const tagNames = new Set<string>();
  for (const tag of manifest.tags) {
    if (
      tagIds.has(tag.id) ||
      tagNames.has(tag.nameNormalized) ||
      tag.name !== normalizeTagName(tag.name) ||
      tag.nameNormalized !== normalizeTagNameForComparison(tag.name)
    ) {
      throw new BackupArchiveError('The backup contains duplicate or invalid tag metadata.');
    }
    tagIds.add(tag.id);
    tagNames.add(tag.nameNormalized);
  }
  for (const page of manifest.pages) {
    if (pageIds.has(page.id)) {
      throw new BackupArchiveError('The backup contains duplicate pages.');
    }
    pageIds.add(page.id);
    if (page.tagIds.some((tagId) => !tagIds.has(tagId))) {
      throw new BackupArchiveError('A page references a tag missing from the backup.');
    }
  }
  for (const page of manifest.pages) {
    if (page.parentId !== null && !pageIds.has(page.parentId)) {
      throw new BackupArchiveError('The backup hierarchy references a missing page.');
    }
    for (const assetId of collectAssetIds(page.content)) {
      if (!assetIds.has(assetId) && !manifest.assets.some((asset) => asset.id === assetId)) {
        throw new BackupArchiveError('A page references an asset missing from the backup.');
      }
    }
  }
  for (const revision of manifest.revisions) {
    if (!pageIds.has(revision.pageId)) {
      throw new BackupArchiveError('A revision references a page missing from the backup.');
    }
  }
  for (const asset of manifest.assets) {
    if (assetIds.has(asset.id) || assetPaths.has(asset.path)) {
      throw new BackupArchiveError('The backup contains duplicate asset metadata.');
    }
    assetIds.add(asset.id);
    assetPaths.add(asset.path);
  }

  if (manifest.version === 2) {
    const templateIds = new Set<string>();
    const templateTitles = new Set<string>();
    let dailyTemplateId: string | null = null;
    for (const template of manifest.templates) {
      const normalizedTitle = template.title.toLocaleLowerCase();
      if (templateIds.has(template.id) || templateTitles.has(normalizedTitle)) {
        throw new BackupArchiveError('The backup contains duplicate template metadata.');
      }
      if (template.isDailyNote && dailyTemplateId !== null) {
        throw new BackupArchiveError('The backup contains multiple daily-note templates.');
      }
      for (const assetId of collectAssetIds(template.content)) {
        if (!manifest.assets.some((asset) => asset.id === assetId)) {
          throw new BackupArchiveError('A template references an asset missing from the backup.');
        }
      }
      templateIds.add(template.id);
      templateTitles.add(normalizedTitle);
      if (template.isDailyNote) dailyTemplateId = template.id;
    }

    const dailyNoteIds = new Set<string>();
    const dailyNoteDates = new Set<string>();
    const dailyNotePageIds = new Set<string>();
    for (const dailyNote of manifest.dailyNotes) {
      if (
        dailyNoteIds.has(dailyNote.id) ||
        dailyNoteDates.has(dailyNote.localDate) ||
        dailyNotePageIds.has(dailyNote.pageId) ||
        !pageIds.has(dailyNote.pageId) ||
        (dailyNote.templateId !== null && !templateIds.has(dailyNote.templateId))
      ) {
        throw new BackupArchiveError('The backup contains invalid daily-note metadata.');
      }
      if (
        dailyNote.templateId !== null &&
        !manifest.templates.some(
          (template) => template.id === dailyNote.templateId && template.isDailyNote,
        )
      ) {
        throw new BackupArchiveError('A daily note references a non-daily template.');
      }
      dailyNoteIds.add(dailyNote.id);
      dailyNoteDates.add(dailyNote.localDate);
      dailyNotePageIds.add(dailyNote.pageId);
    }

    const publicationIds = new Set<string>();
    const publicIds = new Set<string>();
    const pagesById = new Map(manifest.pages.map((page) => [page.id, page]));
    for (const publication of manifest.publications) {
      if (publicationIds.has(publication.id) || publicIds.has(publication.publicId)) {
        throw new BackupArchiveError('The backup contains duplicate publication metadata.');
      }
      const page = pagesById.get(publication.pageId);
      if (!page || page.deletedAt !== null || publication.sourceRevision > page.revision) {
        throw new BackupArchiveError('A publication references an invalid page.');
      }
      const documentAssetIds = [...collectPublicAssetIds(publication.content)].sort();
      const declaredAssetIds = [...publication.assetIds].sort();
      if (
        documentAssetIds.length !== declaredAssetIds.length ||
        documentAssetIds.some((assetId, index) => assetId !== declaredAssetIds[index]) ||
        documentAssetIds.some((assetId) => !assetIds.has(assetId))
      ) {
        throw new BackupArchiveError('A publication references an invalid asset.');
      }
      const referencedPublicIds = new Set<string>();
      const visit = (node: {
        type: string;
        attrs?: Record<string, unknown>;
        content?: unknown[];
      }) => {
        if (node.type === 'publicWikiLink' && typeof node.attrs?.targetPublicId === 'string') {
          referencedPublicIds.add(node.attrs.targetPublicId);
        }
        for (const child of node.content ?? []) {
          if (typeof child === 'object' && child !== null) {
            visit(child as { type: string; attrs?: Record<string, unknown>; content?: unknown[] });
          }
        }
      };
      publication.content.content.forEach((node) => visit(node));
      publicationIds.add(publication.id);
      publicIds.add(publication.publicId);
      if (
        [...referencedPublicIds].some(
          (targetId) => !manifest.publications.some((candidate) => candidate.publicId === targetId),
        )
      ) {
        throw new BackupArchiveError('A publication references a missing public page.');
      }
    }
  }
}

export async function validateBackupArchive(file: File): Promise<ValidatedBackupArchive> {
  if (!file.name.toLowerCase().endsWith('.zip') || file.size < 22) {
    throw invalidArchive();
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new BackupArchiveError('The backup file could not be read.');
  }

  const entries = readStoredZipEntries(bytes);
  const manifestBytes = entries.get(BACKUP_MANIFEST_FILENAME);
  if (!manifestBytes || entries.size < 1) {
    throw new BackupArchiveError('The backup is missing backup.json.');
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
    ) as unknown;
  } catch {
    throw new BackupArchiveError('backup.json is not valid JSON.');
  }
  const parsed = backupManifestSchema.safeParse(manifestValue);
  if (!parsed.success) {
    throw new BackupArchiveError('backup.json does not describe a supported Dovari backup.');
  }
  const manifest = parsed.data;
  validateManifestSemantics(manifest);

  const expectedPaths = new Set([
    BACKUP_MANIFEST_FILENAME,
    ...manifest.assets.map((asset) => asset.path),
  ]);
  for (const name of entries.keys()) {
    if (!expectedPaths.has(name)) {
      throw new BackupArchiveError('The backup contains an unexpected ZIP entry.');
    }
  }
  for (const asset of manifest.assets) {
    const assetBytes = entries.get(asset.path);
    if (!assetBytes || assetBytes.byteLength !== asset.sizeBytes) {
      throw new BackupArchiveError(`Asset ${asset.id} is missing or has the wrong size.`);
    }
    if ((await sha256Hex(assetBytes)) !== asset.sha256) {
      throw new BackupArchiveError(`Asset ${asset.id} failed its checksum validation.`);
    }
  }

  const totalAssetBytes = manifest.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
  if (!Number.isSafeInteger(totalAssetBytes)) {
    throw new BackupArchiveError('The backup asset total is invalid.');
  }

  return {
    entries,
    file,
    manifest,
    manifestSha256: await sha256Hex(canonicalJson(manifest)),
    totalAssetBytes,
  };
}
