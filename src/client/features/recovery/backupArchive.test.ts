import { describe, expect, it } from 'vitest';

import { BACKUP_MANIFEST_FILENAME, canonicalJson, sha256Hex } from '../../../shared/backup';
import { createZipStream, textZipEntry } from '../../../worker/export/zip';
import { BackupArchiveError, validateBackupArchive } from './backupArchive';

const pageId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';

async function streamBytes(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function backupFile(assetBytes: Uint8Array) {
  const assetSha256 = await sha256Hex(assetBytes);
  const manifest = {
    assets: [
      {
        createdAt: '2026-09-13T00:00:00.000Z',
        deletedAt: null,
        height: null,
        id: assetId,
        mimeType: 'text/plain',
        originalFilename: 'note.txt',
        path: 'assets/note.txt',
        sha256: assetSha256,
        sizeBytes: assetBytes.byteLength,
        uploadedForPageId: pageId,
        width: null,
      },
    ],
    exportedAt: '2026-09-13T00:00:00.000Z',
    format: 'dovari-backup',
    pages: [
      {
        content: { content: [], type: 'doc' },
        createdAt: '2026-09-13T00:00:00.000Z',
        deletedAt: null,
        id: pageId,
        parentId: null,
        position: 0,
        revision: 1,
        slug: 'page',
        title: 'Page',
        updatedAt: '2026-09-13T00:00:00.000Z',
      },
    ],
    revisions: [],
    version: 1,
  } as const;
  const zip = createZipStream([
    textZipEntry(BACKUP_MANIFEST_FILENAME, `${canonicalJson(manifest)}\n`),
    {
      name: 'assets/note.txt',
      open: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(assetBytes);
            controller.close();
          },
        }),
    },
  ]);
  const bytes = await streamBytes(zip);
  return new File([bytes.buffer as ArrayBuffer], 'dovari-backup-v1.zip', {
    type: 'application/zip',
  });
}

describe('local Dovari backup validation', () => {
  it('validates the versioned manifest, paths, sizes, and checksums', async () => {
    const file = await backupFile(new TextEncoder().encode('lossless asset'));
    const archive = await validateBackupArchive(file);

    expect(archive.manifest.format).toBe('dovari-backup');
    expect(archive.manifest.pages).toHaveLength(1);
    expect(archive.totalAssetBytes).toBe(14);
    expect(archive.entries.has('assets/note.txt')).toBe(true);
  });

  it('rejects an asset whose bytes no longer match the manifest checksum', async () => {
    const file = await backupFile(new TextEncoder().encode('lossless asset'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const textOffset = new TextEncoder().encode('lossless asset').byteLength;
    bytes[bytes.length - 22 - textOffset - 1] ^= 1;
    const tampered = new File([bytes.buffer as ArrayBuffer], 'dovari-backup-v1.zip');

    await expect(validateBackupArchive(tampered)).rejects.toBeInstanceOf(BackupArchiveError);
  });
});
