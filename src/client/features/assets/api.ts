import { assetResponseEnvelopeSchema, type AssetResponse } from '../../../shared/assets';

interface ApiErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    requestId?: unknown;
  };
}

export interface AssetUploadOptions {
  pageId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export class AssetUploadError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message);
    this.name = 'AssetUploadError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  if (value.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function errorFromResponse(status: number, responseText: string, requestId?: string) {
  const body = parseJson(responseText);
  const error = isRecord(body) && isRecord(body.error) ? (body as ApiErrorBody).error : undefined;
  const code = typeof error?.code === 'string' ? error.code : 'ASSET_UPLOAD_FAILED';
  const message =
    typeof error?.message === 'string' ? error.message : 'The file upload could not be completed.';
  const details = isRecord(error?.details) ? error.details : undefined;
  const responseRequestId = typeof error?.requestId === 'string' ? error.requestId : requestId;

  return new AssetUploadError(status, code, message, details, responseRequestId);
}

function normalizedMimeType(file: File) {
  const mimeType = file.type.split(';', 1)[0]?.trim().toLowerCase();
  return mimeType || 'application/octet-stream';
}

function filenameForUpload(file: File, mimeType: string) {
  if (file.name.trim()) {
    return file.name;
  }

  const extension =
    mimeType === 'image/jpeg'
      ? 'jpg'
      : mimeType === 'image/png'
        ? 'png'
        : mimeType === 'image/webp'
          ? 'webp'
          : mimeType === 'image/gif'
            ? 'gif'
            : 'bin';
  return `attachment.${extension}`;
}

function abortError() {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The file upload was aborted.', 'AbortError');
  }

  const error = new Error('The file upload was aborted.');
  error.name = 'AbortError';
  return error;
}

export type UploadAsset = (file: File, options?: AssetUploadOptions) => Promise<AssetResponse>;

export function uploadAsset(file: File, options: AssetUploadOptions = {}): Promise<AssetResponse> {
  return new Promise<AssetResponse>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    const mimeType = normalizedMimeType(file);
    let settled = false;

    const cleanup = () => {
      options.signal?.removeEventListener('abort', abortRequest);
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const abortRequest = () => {
      if (!settled) {
        xhr.abort();
      }
    };

    xhr.open('POST', '/api/private/assets');
    xhr.responseType = 'text';
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.setRequestHeader(
      'X-Dovari-Filename',
      encodeURIComponent(filenameForUpload(file, mimeType)),
    );
    if (options.pageId) {
      xhr.setRequestHeader('X-Dovari-Page-Id', options.pageId);
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) {
        return;
      }
      options.onProgress?.(
        Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100))),
      );
    });

    xhr.onload = () => {
      finish(() => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(
            errorFromResponse(
              xhr.status,
              xhr.responseText,
              xhr.getResponseHeader('X-Request-ID') ?? undefined,
            ),
          );
          return;
        }

        const parsed = assetResponseEnvelopeSchema.safeParse(parseJson(xhr.responseText));
        if (!parsed.success) {
          reject(
            new AssetUploadError(
              500,
              'INVALID_RESPONSE',
              'The server returned an invalid asset response.',
            ),
          );
          return;
        }

        options.onProgress?.(100);
        resolve(parsed.data.asset);
      });
    };

    xhr.onerror = () => {
      finish(() =>
        reject(new AssetUploadError(0, 'ASSET_UPLOAD_FAILED', 'The file upload failed.')),
      );
    };
    xhr.ontimeout = () => {
      finish(() =>
        reject(new AssetUploadError(0, 'ASSET_UPLOAD_FAILED', 'The file upload timed out.')),
      );
    };
    xhr.onabort = () => {
      finish(() => reject(abortError()));
    };

    options.signal?.addEventListener('abort', abortRequest, { once: true });
    xhr.send(file);
  });
}

export function assetUploadErrorMessage(error: unknown) {
  if (error instanceof AssetUploadError) {
    switch (error.code) {
      case 'ASSET_TOO_LARGE':
        return 'This file is too large. The maximum size is 25 MiB.';
      case 'ASSET_MIME_NOT_ALLOWED':
      case 'ASSET_SVG_NOT_ALLOWED':
      case 'ASSET_HTML_NOT_ALLOWED':
        return 'This file type is not supported.';
      case 'ASSET_MAGIC_MISMATCH':
        return 'The file could not be verified. Try the original file again.';
      case 'PAGE_NOT_FOUND':
        return 'This page no longer exists. Refresh the page and try again.';
      default:
        return error.message;
    }
  }

  if (error instanceof TypeError) {
    return 'Dovari could not reach the server. Check your connection and try again.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'The file upload failed. Try again.';
}

export function isAbortError(error: unknown) {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (isRecord(error) && error.name === 'AbortError')
  );
}
