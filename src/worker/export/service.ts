import {
  collectAssetIds,
  deriveMarkdown,
  tiptapDocumentSchema,
  type TiptapDocument,
} from '../../shared/pages';
import { AssetRepository, type AssetRecord } from '../assets/repository';
import { PageRepository, type PageRecord } from '../pages/repository';
import { ExportError } from './errors';
import { createZipStream, textZipEntry, type ZipEntrySource } from './zip';

export const EXPORT_FILENAME = 'dovari-export.zip';
const MANIFEST_FILENAME = 'manifest.json';

interface ExportPage {
  document: TiptapDocument;
  path: string;
  record: PageRecord;
}

interface ExportAsset {
  available: boolean;
  id: string;
  path: string;
  record: AssetRecord | null;
}

interface ExportManifest {
  assets: Array<{
    available: boolean;
    filename: string | null;
    id: string;
    mimeType: string | null;
    path: string;
    sha256: string | null;
    sizeBytes: number | null;
  }>;
  format: 'dovari-export';
  missingAssets: string[];
  pages: Array<{
    id: string;
    parentId: string | null;
    path: string;
    revision: number;
    slug: string;
    title: string;
    updatedAt: string;
  }>;
  version: 1;
}

function compareText(left: string, right: string) {
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

function comparePages(left: PageRecord, right: PageRecord) {
  return (
    left.position - right.position ||
    compareText(left.title, right.title) ||
    compareText(left.slug, right.slug) ||
    compareText(left.id, right.id)
  );
}

function pathKey(path: string) {
  return path.toLocaleLowerCase('en-US');
}

function joinPath(parts: string[]) {
  return parts.join('/');
}

function allocatePageSegment(directory: string[], slug: string, usedPaths: Set<string>) {
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const suffixText = suffix === 1 ? '' : `~${suffix}`;
    const segment = `${slug}${suffixText}`;
    const path = joinPath(['pages', ...directory, `${segment}.md`]);
    const key = pathKey(path);
    if (!usedPaths.has(key)) {
      usedPaths.add(key);
      return { path, segment };
    }
  }

  throw new ExportError('The export contains too many colliding page names.');
}

function assignPagePaths(records: PageRecord[]) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const children = new Map<string | null, PageRecord[]>();

  for (const record of records) {
    const parentId =
      record.parentId !== null && record.parentId !== record.id && byId.has(record.parentId)
        ? record.parentId
        : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(record);
    children.set(parentId, siblings);
  }

  for (const siblings of children.values()) {
    siblings.sort(comparePages);
  }

  const usedPaths = new Set<string>();
  const visited = new Set<string>();
  const assignments = new Map<string, string>();

  function visit(parentId: string | null, directory: string[]) {
    for (const record of children.get(parentId) ?? []) {
      if (visited.has(record.id)) {
        continue;
      }

      const allocated = allocatePageSegment(directory, record.slug, usedPaths);
      visited.add(record.id);
      assignments.set(record.id, allocated.path);
      visit(record.id, [...directory, allocated.segment]);
    }
  }

  visit(null, []);

  for (const record of [...records].sort(compareTextById)) {
    if (visited.has(record.id)) {
      continue;
    }

    const allocated = allocatePageSegment([], record.slug, usedPaths);
    visited.add(record.id);
    assignments.set(record.id, allocated.path);
    visit(record.id, [allocated.segment]);
  }

  return assignments;
}

function compareTextById(left: PageRecord, right: PageRecord) {
  return compareText(left.id, right.id);
}

function encodePath(path: string) {
  return path
    .split('/')
    .map((segment) => (segment === '..' || segment === '.' ? segment : encodeURIComponent(segment)))
    .join('/');
}

function relativePath(fromFile: string, toFile: string) {
  const fromDirectory = fromFile.split('/').slice(0, -1);
  const target = toFile.split('/');
  let common = 0;
  while (common < fromDirectory.length && common < target.length) {
    if (fromDirectory[common] !== target[common]) {
      break;
    }
    common += 1;
  }

  const parts = [
    ...Array.from({ length: fromDirectory.length - common }, () => '..'),
    ...target.slice(common),
  ];
  return encodePath(parts.join('/')) || '.';
}

function sanitizeAssetFilename(filename: string, assetId: string) {
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
  const safeFilename = sanitizeAssetFilename(filename, assetId);
  const { extension, stem } = splitFilename(safeFilename);

  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const suffixText = suffix === 1 ? '' : `-${suffix}`;
    const maxStemLength = Math.max(1, 255 - extension.length - suffixText.length);
    const candidate = `${stem.slice(0, maxStemLength)}${suffixText}${extension}`;
    const path = `assets/${candidate}`;
    const key = pathKey(path);
    if (!usedPaths.has(key)) {
      usedPaths.add(key);
      return path;
    }
  }

  throw new ExportError('The export contains too many colliding asset names.');
}

function parseDocument(page: PageRecord) {
  let value: unknown;
  try {
    value = JSON.parse(page.contentJson) as unknown;
  } catch {
    throw new ExportError('A page contains invalid content and could not be exported.');
  }

  const parsed = tiptapDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new ExportError('A page contains invalid content and could not be exported.');
  }
  return parsed.data;
}

function textStream(value: string) {
  return textZipEntry('__text__.txt', value).open();
}

function pageMarkdown(
  page: ExportPage,
  pagePaths: Map<string, string>,
  assetPaths: Map<string, string>,
) {
  const titleDocument: TiptapDocument = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: page.record.title.replace(/\s+/gu, ' ').trim() }],
      },
    ],
  };
  const title = deriveMarkdown(titleDocument);
  const content = deriveMarkdown(page.document, {
    assetPath: (assetId) => {
      const assetPath = assetPaths.get(assetId) ?? `assets/missing-${assetId}.txt`;
      return relativePath(page.path, assetPath);
    },
    wikiLinkPath: (targetPageId) => {
      const targetPath = targetPageId === null ? undefined : pagePaths.get(targetPageId);
      return targetPath === undefined ? null : relativePath(page.path, targetPath);
    },
  });

  return `${title}${content.length > 0 ? `\n\n${content}` : ''}\n`;
}

function missingAssetText(assetId: string) {
  return `This asset (${assetId}) was referenced by an exported page but was not available in storage.\n`;
}

function manifestJson(manifest: ExportManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export interface PreparedExport {
  body: ReadableStream<Uint8Array>;
  filename: string;
}

export class ExportService {
  private readonly assetRepository: AssetRepository;
  private readonly pageRepository: PageRepository;

  constructor(
    db: D1Database,
    private readonly bucket: R2Bucket,
  ) {
    this.assetRepository = new AssetRepository(db);
    this.pageRepository = new PageRepository(db);
  }

  async prepare(): Promise<PreparedExport> {
    const records = await this.pageRepository.listActiveForExport();
    const pagePaths = assignPagePaths(records);
    const pages = records
      .map((record) => ({
        document: parseDocument(record),
        path: pagePaths.get(record.id)!,
        record,
      }))
      .sort((left, right) => compareText(left.path, right.path));

    const referencedAssetIds = [
      ...new Set(pages.flatMap((page) => collectAssetIds(page.document))),
    ].sort(compareText);
    const recordsById = new Map(
      (await this.assetRepository.findActiveByIds(referencedAssetIds)).map((record) => [
        record.id,
        record,
      ]),
    );
    const assetPaths = new Map<string, string>();
    const usedAssetPaths = new Set<string>();
    const assets: ExportAsset[] = [];

    for (const assetId of referencedAssetIds) {
      const record = recordsById.get(assetId) ?? null;
      const filename = record?.originalFilename ?? `missing-${assetId}.txt`;
      const path = allocateAssetPath(filename, assetId, usedAssetPaths);
      let available = record !== null;
      if (record !== null) {
        try {
          available = (await this.bucket.head(record.objectKey)) !== null;
        } catch {
          available = false;
        }
      }
      assetPaths.set(assetId, path);
      assets.push({ available, id: assetId, path, record });
    }

    const entries: ZipEntrySource[] = [];
    const manifest: ExportManifest = {
      assets: assets
        .filter((asset) => asset.record !== null)
        .map((asset) => ({
          available: asset.available,
          filename: asset.record!.originalFilename,
          id: asset.id,
          mimeType: asset.record!.mimeType,
          path: asset.path,
          sha256: asset.record!.sha256,
          sizeBytes: asset.record!.sizeBytes,
        }))
        .sort((left, right) => compareText(left.path, right.path)),
      format: 'dovari-export',
      missingAssets: assets
        .filter((asset) => asset.record === null || !asset.available)
        .map((asset) => asset.id)
        .sort(compareText),
      pages: pages
        .map((page) => ({
          id: page.record.id,
          parentId: page.record.parentId,
          path: page.path,
          revision: page.record.revision,
          slug: page.record.slug,
          title: page.record.title,
          updatedAt: page.record.updatedAt,
        }))
        .sort((left, right) => compareText(left.path, right.path)),
      version: 1,
    };

    entries.push(textZipEntry(MANIFEST_FILENAME, manifestJson(manifest)));
    for (const page of pages) {
      entries.push({
        name: page.path,
        open: () => textStream(pageMarkdown(page, pagePaths, assetPaths)),
      });
    }
    for (const asset of assets.sort((left, right) => compareText(left.path, right.path))) {
      entries.push({
        name: asset.path,
        open: async () => {
          if (asset.record === null || !asset.available) {
            return textStream(missingAssetText(asset.id));
          }

          const object = await this.bucket.get(asset.record.objectKey);
          if (object === null || !('body' in object)) {
            return textStream(missingAssetText(asset.id));
          }
          return object.body;
        },
      });
    }

    return {
      body: createZipStream(entries),
      filename: EXPORT_FILENAME,
    };
  }
}
