import { MAX_ASSET_SIZE_BYTES, assetIdSchema, type AssetResponse } from '../../shared/assets';
import { pageIdSchema } from '../../shared/pages';
import { AssetError } from './errors';
import {
  ASSET_SNIFF_BYTES,
  assetResponse,
  assetTypeForMimeType,
  contentDisposition,
  inspectAssetPayload,
  sanitizeFilename,
} from './formats';
import { AssetRepository, type AssetRecord } from './repository';

interface ByteRange {
  start: number;
  end: number;
}

interface InspectedBody {
  stream: ReadableStream<Uint8Array>;
  get byteLength(): number;
  get prefix(): Uint8Array;
  get error(): AssetError | null;
}

function createInspectedBody(body: ReadableStream<Uint8Array>): InspectedBody {
  const reader = body.getReader();
  const prefixBuffer = new Uint8Array(ASSET_SNIFF_BYTES);
  let prefixLength = 0;
  let byteLength = 0;
  let error: AssetError | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          return;
        }

        const value = new Uint8Array(chunk.value);
        byteLength += value.byteLength;
        if (byteLength > MAX_ASSET_SIZE_BYTES) {
          error = new AssetError(
            413,
            'ASSET_TOO_LARGE',
            'This file is too large. The maximum size is 25 MiB.',
            { maxBytes: MAX_ASSET_SIZE_BYTES },
          );
          await reader.cancel(error);
          controller.error(error);
          return;
        }

        if (prefixLength < ASSET_SNIFF_BYTES) {
          const copyLength = Math.min(value.byteLength, ASSET_SNIFF_BYTES - prefixLength);
          prefixBuffer.set(value.subarray(0, copyLength), prefixLength);
          prefixLength += copyLength;
        }

        controller.enqueue(value);
      } catch (cause) {
        error =
          cause instanceof AssetError
            ? cause
            : new AssetError(500, 'ASSET_UPLOAD_FAILED', 'The file upload failed.');
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });

  return {
    stream,
    get byteLength() {
      return byteLength;
    },
    get prefix() {
      return prefixBuffer.slice(0, prefixLength);
    },
    get error() {
      return error;
    },
  };
}

function assetNotFound() {
  return new AssetError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
}

function invalidAssetId() {
  return new AssetError(400, 'INVALID_REQUEST', 'The asset id is invalid.');
}

function parseAssetId(id: string) {
  const parsed = assetIdSchema.safeParse(id);
  if (!parsed.success) {
    throw invalidAssetId();
  }
  return parsed.data;
}

function parsePageId(raw: string | null) {
  if (raw === null || raw.trim() === '') {
    return null;
  }

  const parsed = pageIdSchema.safeParse(raw.trim());
  if (!parsed.success) {
    throw new AssetError(400, 'INVALID_REQUEST', 'The page id is invalid.');
  }
  return parsed.data;
}

function parseContentLength(raw: string | null) {
  if (raw === null) {
    return undefined;
  }

  if (!/^\d+$/.test(raw)) {
    throw new AssetError(400, 'INVALID_REQUEST', 'The Content-Length header is invalid.');
  }

  const bytes = Number(raw);
  if (!Number.isSafeInteger(bytes)) {
    throw new AssetError(413, 'ASSET_TOO_LARGE', 'This file is too large.');
  }
  if (bytes > MAX_ASSET_SIZE_BYTES) {
    throw new AssetError(
      413,
      'ASSET_TOO_LARGE',
      'This file is too large. The maximum size is 25 MiB.',
      { maxBytes: MAX_ASSET_SIZE_BYTES },
    );
  }

  return bytes;
}

function extensionKey(now: Date, id: string, extension: string) {
  const year = now.getUTCFullYear().toString().padStart(4, '0');
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  return `assets/${year}/${month}/${id}.${extension}`;
}

function safeHttpEtag(object: Pick<R2Object, 'httpEtag' | 'etag'>) {
  const value = object.httpEtag || object.etag;
  if (value === '*') {
    return value;
  }
  return value.startsWith('"') ? value : `"${value}"`;
}

function stripWeakEtag(value: string) {
  return value.trim().replace(/^W\//i, '');
}

function matchesIfNoneMatch(value: string | null, etag: string) {
  if (value === null) {
    return false;
  }
  const normalized = stripWeakEtag(etag);
  return value
    .split(',')
    .map(stripWeakEtag)
    .some((candidate) => candidate === '*' || candidate === normalized);
}

function parseRangeHeader(value: string, size: number): ByteRange {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    throw new AssetError(416, 'ASSET_RANGE_INVALID', 'The requested byte range is invalid.', {
      contentRange: `bytes */${size}`,
    });
  }
  if (size === 0) {
    throw new AssetError(416, 'ASSET_RANGE_INVALID', 'The requested byte range is invalid.', {
      contentRange: 'bytes */0',
    });
  }

  const startText = match[1]!;
  const endText = match[2]!;
  let start: number;
  let end: number;

  if (startText === '') {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new AssetError(416, 'ASSET_RANGE_INVALID', 'The requested byte range is invalid.', {
        contentRange: `bytes */${size}`,
      });
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Number(endText);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      throw new AssetError(416, 'ASSET_RANGE_INVALID', 'The requested byte range is invalid.', {
        contentRange: `bytes */${size}`,
      });
    }
    end = Math.min(end, size - 1);
  }

  return { start, end };
}

function ifRangeAllowsRange(request: Request, etag: string) {
  const ifRange = request.headers.get('If-Range');
  return ifRange === null || stripWeakEtag(ifRange) === stripWeakEtag(etag);
}

function contentHeaders(record: AssetRecord, etag: string, length: number) {
  const type = assetTypeForMimeType(record.mimeType);
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600, must-revalidate',
    'Content-Disposition': contentDisposition(record.originalFilename, type.inline),
    'Content-Length': String(length),
    'Content-Type': record.mimeType,
    ETag: etag,
  });
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

function notModifiedResponse(record: AssetRecord, etag: string) {
  const headers = contentHeaders(record, etag, 0);
  headers.delete('Content-Length');
  return new Response(null, { headers, status: 304 });
}

function objectHasBody(object: R2Object | R2ObjectBody): object is R2ObjectBody {
  return 'body' in object;
}

function checksumSha256(object: R2Object) {
  try {
    return object.checksums.toJSON().sha256 ?? null;
  } catch {
    return null;
  }
}

export class AssetService {
  private readonly repository: AssetRepository;

  constructor(
    db: D1Database,
    private readonly bucket: R2Bucket,
  ) {
    this.repository = new AssetRepository(db);
  }

  private async deleteObjectBestEffort(objectKey: string, assetId: string) {
    try {
      await this.bucket.delete(objectKey);
    } catch {
      console.error('Asset R2 rollback failed.', { assetId, objectKey });
    }
  }

  async upload(request: Request): Promise<AssetResponse> {
    const contentLength = parseContentLength(request.headers.get('Content-Length'));
    const filename = sanitizeFilename(request.headers.get('X-Dovari-Filename'));
    const type = assetTypeForMimeType(request.headers.get('Content-Type'));
    const uploadedForPageId = parsePageId(request.headers.get('X-Dovari-Page-Id'));

    if (uploadedForPageId !== null && !(await this.repository.hasActivePage(uploadedForPageId))) {
      throw new AssetError(404, 'PAGE_NOT_FOUND', 'The selected page does not exist.');
    }

    if (request.body === null) {
      throw new AssetError(400, 'ASSET_BODY_REQUIRED', 'The upload body is required.');
    }

    const inspectedBody = createInspectedBody(request.body);
    const assetId = crypto.randomUUID();
    const now = new Date();
    const objectKey = extensionKey(now, assetId, type.extension);
    let object: R2Object | null;
    let uploadPipe: Promise<void> | undefined;
    let uploadValue: ReadableStream<Uint8Array> | ArrayBuffer;

    try {
      if (contentLength === undefined) {
        uploadValue = await new Response(inspectedBody.stream).arrayBuffer();
      } else {
        const fixedLength = new FixedLengthStream(contentLength);
        uploadPipe = inspectedBody.stream.pipeTo(fixedLength.writable);
        uploadValue = fixedLength.readable;
      }

      object = await this.bucket.put(objectKey, uploadValue, {
        httpMetadata: { contentType: type.mimeType },
      });
      await uploadPipe;
    } catch (cause) {
      await this.deleteObjectBestEffort(objectKey, assetId);
      if (inspectedBody.error !== null) {
        throw inspectedBody.error;
      }
      console.error('Asset R2 upload failed.', {
        assetId,
        objectKey,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      throw new AssetError(500, 'ASSET_UPLOAD_FAILED', 'The file upload failed.');
    }

    if (object === null) {
      await this.deleteObjectBestEffort(objectKey, assetId);
      throw new AssetError(500, 'ASSET_UPLOAD_FAILED', 'The file upload failed.');
    }

    try {
      const inspection = inspectAssetPayload(type.mimeType, inspectedBody.prefix);
      const asset = {
        id: assetId,
        objectKey,
        originalFilename: filename,
        mimeType: type.mimeType,
        sizeBytes: inspectedBody.byteLength,
        width: inspection.width,
        height: inspection.height,
        sha256: checksumSha256(object),
        uploadedForPageId,
        createdAt: now.toISOString(),
      };

      const result = await this.repository.insert(asset);
      if (result.meta.changes < 1) {
        throw new AssetError(500, 'ASSET_UPLOAD_FAILED', 'The file upload failed.');
      }

      return assetResponse(asset.id, asset.originalFilename, asset.mimeType, asset.sizeBytes);
    } catch (cause) {
      await this.deleteObjectBestEffort(objectKey, assetId);
      if (cause instanceof AssetError) {
        throw cause;
      }
      console.error('Asset metadata insert failed.', { assetId, objectKey });
      throw new AssetError(500, 'ASSET_UPLOAD_FAILED', 'The file upload failed.');
    }
  }

  async getMetadata(rawId: string): Promise<AssetResponse> {
    const id = parseAssetId(rawId);
    const record = await this.repository.findActiveById(id);
    if (!record) {
      throw assetNotFound();
    }
    return assetResponse(record.id, record.originalFilename, record.mimeType, record.sizeBytes);
  }

  async delete(rawId: string) {
    const id = parseAssetId(rawId);
    const record = await this.repository.findActiveById(id);
    if (!record) {
      throw assetNotFound();
    }

    const deletedAt = new Date().toISOString();
    const result = await this.repository.softDelete(id, deletedAt);
    if (result.meta.changes < 1) {
      throw assetNotFound();
    }

    return { id: record.id, deletedAt };
  }

  async content(rawId: string, request: Request) {
    const id = parseAssetId(rawId);
    const record = await this.repository.findActiveById(id);
    if (!record) {
      throw assetNotFound();
    }

    const requestedRange = request.headers.get('Range');
    const head =
      request.method === 'HEAD' || requestedRange !== null
        ? await this.bucket.head(record.objectKey)
        : null;
    if (requestedRange !== null && head === null) {
      throw assetNotFound();
    }

    const metadata = head;
    const etag = metadata !== null ? safeHttpEtag(metadata) : null;
    if (etag !== null && matchesIfNoneMatch(request.headers.get('If-None-Match'), etag)) {
      return notModifiedResponse(record, etag);
    }

    const useRange =
      requestedRange !== null && metadata !== null && ifRangeAllowsRange(request, etag!);
    const byteRange = useRange ? parseRangeHeader(requestedRange!, metadata!.size) : null;

    if (request.method === 'HEAD') {
      if (metadata === null) {
        const object = await this.bucket.head(record.objectKey);
        if (!object) {
          throw assetNotFound();
        }
        const fullHeaders = contentHeaders(record, safeHttpEtag(object), object.size);
        return new Response(null, { headers: fullHeaders, status: 200 });
      }

      const headers = contentHeaders(
        record,
        etag!,
        byteRange === null ? metadata.size : byteRange.end - byteRange.start + 1,
      );
      if (byteRange !== null) {
        headers.set('Content-Range', `bytes ${byteRange.start}-${byteRange.end}/${metadata.size}`);
      }
      return new Response(null, { headers, status: byteRange === null ? 200 : 206 });
    }

    let object: R2Object | R2ObjectBody | null;
    if (byteRange !== null) {
      object = await this.bucket.get(record.objectKey, {
        range: { offset: byteRange.start, length: byteRange.end - byteRange.start + 1 },
      });
    } else {
      object = await this.bucket.get(record.objectKey, { onlyIf: request.headers });
    }

    if (object === null) {
      throw assetNotFound();
    }

    const objectEtag = safeHttpEtag(object);
    if (matchesIfNoneMatch(request.headers.get('If-None-Match'), objectEtag)) {
      return notModifiedResponse(record, objectEtag);
    }

    if (!objectHasBody(object)) {
      return notModifiedResponse(record, objectEtag);
    }

    const responseSize = byteRange === null ? object.size : byteRange.end - byteRange.start + 1;
    const headers = contentHeaders(record, objectEtag, responseSize);
    if (byteRange !== null) {
      headers.set('Content-Range', `bytes ${byteRange.start}-${byteRange.end}/${metadata!.size}`);
    }

    return new Response(object.body, {
      headers,
      status: byteRange === null ? 200 : 206,
    });
  }
}
