import { MAX_ASSET_FILENAME_LENGTH, type AssetResponse } from '../../shared/assets';
import { AssetError } from './errors';

export const ASSET_SNIFF_BYTES = 8 * 1024;

interface AssetTypeDefinition {
  mimeType: string;
  extension: string;
  inline: boolean;
}

const ASSET_TYPES: Record<string, AssetTypeDefinition> = {
  'image/png': { mimeType: 'image/png', extension: 'png', inline: true },
  'image/jpeg': { mimeType: 'image/jpeg', extension: 'jpg', inline: true },
  'image/webp': { mimeType: 'image/webp', extension: 'webp', inline: true },
  'image/gif': { mimeType: 'image/gif', extension: 'gif', inline: true },
  'application/pdf': { mimeType: 'application/pdf', extension: 'pdf', inline: false },
  'text/plain': { mimeType: 'text/plain', extension: 'txt', inline: false },
  'text/markdown': { mimeType: 'text/markdown', extension: 'md', inline: false },
  'application/zip': { mimeType: 'application/zip', extension: 'zip', inline: false },
  'application/octet-stream': {
    mimeType: 'application/octet-stream',
    extension: 'bin',
    inline: false,
  },
};

export interface AssetPayloadInspection {
  width: number | null;
  height: number | null;
}

function startsWithBytes(value: Uint8Array, signature: readonly number[], offset = 0) {
  if (value.byteLength < offset + signature.length) {
    return false;
  }

  return signature.every((byte, index) => value[offset + index] === byte);
}

function ascii(value: Uint8Array, start: number, length: number) {
  if (value.byteLength < start + length) {
    return '';
  }

  return String.fromCharCode(...value.subarray(start, start + length));
}

function detectedMagicType(value: Uint8Array) {
  if (startsWithBytes(value, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWithBytes(value, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (ascii(value, 0, 4) === 'RIFF' && ascii(value, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  if (ascii(value, 0, 6) === 'GIF87a' || ascii(value, 0, 6) === 'GIF89a') {
    return 'image/gif';
  }
  if (ascii(value, 0, 5) === '%PDF-') {
    return 'application/pdf';
  }
  if (
    startsWithBytes(value, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWithBytes(value, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWithBytes(value, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return 'application/zip';
  }

  return null;
}

function textPrefix(value: Uint8Array) {
  return new TextDecoder()
    .decode(value)
    .replace(/^\uFEFF/, '')
    .trimStart();
}

function looksLikeSvg(value: Uint8Array) {
  const text = textPrefix(value);
  return /^(?:<\?xml\b[^>]*>\s*)?<svg(?:\s|>)/i.test(text);
}

function looksLikeHtml(value: Uint8Array) {
  const text = textPrefix(value);
  return /^(?:<!--[^>]*>\s*)*(?:<!doctype\s+html\b|<html(?:\s|>)|<(?:head|body|script)(?:\s|>))/i.test(
    text,
  );
}

function littleEndian16(value: Uint8Array, offset: number) {
  if (value.byteLength < offset + 2) {
    return null;
  }
  return value[offset]! | (value[offset + 1]! << 8);
}

function bigEndian16(value: Uint8Array, offset: number) {
  if (value.byteLength < offset + 2) {
    return null;
  }
  return (value[offset]! << 8) | value[offset + 1]!;
}

function bigEndian32(value: Uint8Array, offset: number) {
  if (value.byteLength < offset + 4) {
    return null;
  }
  return (
    value[offset]! * 2 ** 24 +
    value[offset + 1]! * 2 ** 16 +
    value[offset + 2]! * 2 ** 8 +
    value[offset + 3]!
  );
}

function pngDimensions(value: Uint8Array) {
  const width = bigEndian32(value, 16);
  const height = bigEndian32(value, 20);
  return width !== null && height !== null && width > 0 && height > 0 ? { width, height } : null;
}

function gifDimensions(value: Uint8Array) {
  const width = littleEndian16(value, 6);
  const height = littleEndian16(value, 8);
  return width !== null && height !== null && width > 0 && height > 0 ? { width, height } : null;
}

function webpDimensions(value: Uint8Array) {
  const chunkType = ascii(value, 12, 4);
  if (chunkType === 'VP8X' && value.byteLength >= 30) {
    const width = 1 + (value[24]! | (value[25]! << 8) | (value[26]! << 16));
    const height = 1 + (value[27]! | (value[28]! << 8) | (value[29]! << 16));
    return { width, height };
  }

  if (chunkType === 'VP8 ' && startsWithBytes(value, [0x9d, 0x01, 0x2a], 23)) {
    const width = littleEndian16(value, 26);
    const height = littleEndian16(value, 28);
    return width !== null && height !== null && width > 0 && height > 0
      ? { width: width & 0x3fff, height: height & 0x3fff }
      : null;
  }

  if (chunkType === 'VP8L' && value.byteLength >= 25 && value[20] === 0x2f) {
    const width = 1 + ((value[21]! | (value[22]! << 8)) & 0x3fff);
    const height = 1 + (((value[22]! >> 6) | (value[23]! << 2) | (value[24]! << 10)) & 0x3fff);
    return { width, height };
  }

  return null;
}

function jpegDimensions(value: Uint8Array) {
  if (!startsWithBytes(value, [0xff, 0xd8])) {
    return null;
  }

  let offset = 2;
  while (offset + 3 < value.byteLength) {
    if (value[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (value[offset] === 0xff) {
      offset += 1;
    }
    const marker = value[offset]!;
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }
    if (marker === 0xda) {
      break;
    }

    const segmentLength = bigEndian16(value, offset);
    if (segmentLength === null || segmentLength < 2) {
      break;
    }

    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = bigEndian16(value, offset + 3);
      const width = bigEndian16(value, offset + 5);
      return width !== null && height !== null && width > 0 && height > 0
        ? { width, height }
        : null;
    }

    offset += segmentLength;
  }

  return null;
}

function dimensionsFor(mimeType: string, value: Uint8Array) {
  switch (mimeType) {
    case 'image/png':
      return pngDimensions(value);
    case 'image/jpeg':
      return jpegDimensions(value);
    case 'image/webp':
      return webpDimensions(value);
    case 'image/gif':
      return gifDimensions(value);
    default:
      return null;
  }
}

export function assetTypeForMimeType(rawMimeType: string | null) {
  const mimeType = rawMimeType?.split(';', 1)[0]?.trim().toLowerCase();
  if (mimeType === 'image/svg+xml') {
    throw new AssetError(415, 'ASSET_SVG_NOT_ALLOWED', 'SVG files are not supported.');
  }
  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
    throw new AssetError(415, 'ASSET_HTML_NOT_ALLOWED', 'HTML files are not supported.');
  }
  if (!mimeType || !Object.hasOwn(ASSET_TYPES, mimeType)) {
    throw new AssetError(415, 'ASSET_MIME_NOT_ALLOWED', 'This file type is not supported.');
  }

  return ASSET_TYPES[mimeType];
}

export function sanitizeFilename(headerValue: string | null) {
  if (!headerValue || headerValue.length > 2_048) {
    throw new AssetError(400, 'ASSET_FILENAME_INVALID', 'A valid filename is required.');
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(headerValue);
  } catch {
    throw new AssetError(400, 'ASSET_FILENAME_INVALID', 'The filename encoding is invalid.');
  }

  const basename = decoded.replaceAll('\\', '/').split('/').pop() ?? '';
  const filename = [...basename]
    .filter((character) => !/[\p{Cc}\p{Cf}]/u.test(character))
    .join('')
    .trim();
  const truncated = [...filename].slice(0, MAX_ASSET_FILENAME_LENGTH).join('');

  if (!truncated || truncated === '.' || truncated === '..') {
    throw new AssetError(400, 'ASSET_FILENAME_INVALID', 'A valid filename is required.');
  }

  return truncated;
}

export function inspectAssetPayload(mimeType: string, value: Uint8Array): AssetPayloadInspection {
  if (looksLikeSvg(value)) {
    throw new AssetError(415, 'ASSET_SVG_NOT_ALLOWED', 'SVG files are not supported.');
  }
  if (looksLikeHtml(value)) {
    throw new AssetError(415, 'ASSET_HTML_NOT_ALLOWED', 'HTML files are not supported.');
  }

  const detected = detectedMagicType(value);
  if (mimeType !== 'application/octet-stream' && detected !== null) {
    const declaredType = ASSET_TYPES[mimeType];
    if (detected !== mimeType) {
      throw new AssetError(
        422,
        'ASSET_MAGIC_MISMATCH',
        'The file signature does not match its declared MIME type.',
        { declaredMimeType: mimeType, detectedMimeType: detected },
      );
    }
    if (declaredType === undefined) {
      throw new AssetError(415, 'ASSET_MIME_NOT_ALLOWED', 'This file type is not supported.');
    }
  }

  const requiresSignature =
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    mimeType === 'application/zip';
  if (requiresSignature && detected !== mimeType) {
    throw new AssetError(
      422,
      'ASSET_MAGIC_MISMATCH',
      'The file signature does not match its declared MIME type.',
      { declaredMimeType: mimeType },
    );
  }

  const dimensions = dimensionsFor(mimeType, value);
  return {
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}

export function contentDisposition(filename: string, inline: boolean) {
  const fallback =
    filename
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^\.+|\.+$/g, '') || 'download';
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function assetResponse(id: string, filename: string, mimeType: string, sizeBytes: number) {
  const response: AssetResponse = {
    id,
    filename,
    mimeType,
    sizeBytes,
    contentUrl: `/api/private/assets/${encodeURIComponent(id)}/content`,
  };
  return response;
}
