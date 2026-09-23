import type { AssetRecord } from '../assets/repository';
import { AssetError } from '../assets/errors';
import { assetTypeForMimeType, contentDisposition } from '../assets/formats';

interface ByteRange {
  start: number;
  end: number;
}

function safeHttpEtag(object: Pick<R2Object, 'httpEtag' | 'etag'>) {
  const value = object.httpEtag || object.etag;
  if (value === '*') return value;
  return value.startsWith('"') ? value : `"${value}"`;
}

function stripWeakEtag(value: string) {
  return value.trim().replace(/^W\//i, '');
}

function matchesIfNoneMatch(value: string | null, etag: string) {
  if (value === null) return false;
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
    'Cache-Control': 'public, max-age=0, must-revalidate',
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

export async function servePublicAsset(record: AssetRecord, bucket: R2Bucket, request: Request) {
  const requestedRange = request.headers.get('Range');
  const head =
    request.method === 'HEAD' || requestedRange !== null
      ? await bucket.head(record.objectKey)
      : null;
  if (requestedRange !== null && head === null) {
    throw new AssetError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
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
      const object = await bucket.head(record.objectKey);
      if (!object) throw new AssetError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
      return new Response(null, {
        headers: contentHeaders(record, safeHttpEtag(object), object.size),
        status: 200,
      });
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
    object = await bucket.get(record.objectKey, {
      range: { offset: byteRange.start, length: byteRange.end - byteRange.start + 1 },
    });
  } else {
    object = await bucket.get(record.objectKey, { onlyIf: request.headers });
  }
  if (object === null) throw new AssetError(404, 'ASSET_NOT_FOUND', 'Asset not found.');

  const objectEtag = safeHttpEtag(object);
  if (matchesIfNoneMatch(request.headers.get('If-None-Match'), objectEtag)) {
    return notModifiedResponse(record, objectEtag);
  }
  if (!objectHasBody(object)) return notModifiedResponse(record, objectEtag);

  const responseSize = byteRange === null ? object.size : byteRange.end - byteRange.start + 1;
  const headers = contentHeaders(record, objectEtag, responseSize);
  if (byteRange !== null) {
    headers.set('Content-Range', `bytes ${byteRange.start}-${byteRange.end}/${metadata!.size}`);
  }
  return new Response(object.body, { headers, status: byteRange === null ? 200 : 206 });
}
