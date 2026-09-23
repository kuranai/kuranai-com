import {
  canonicalJson,
  restoreAssetResponseSchema,
  restoreDeleteResponseSchema,
  restoreFinalizeResponseSchema,
  restoreRecordResponseSchema,
  restoreSessionCreateRequestSchema,
  restoreSessionResponseSchema,
  type BackupAssetRecord,
  type BackupPageRecord,
  type BackupPublicationRecord,
  type BackupRevisionRecord,
  type BackupTagRecord,
  type BackupTemplateRecord,
  type BackupDailyNoteRecord,
  type RestoreSessionCreateRequest,
  type RestoreSessionStatus,
} from '../../../shared/backup';
import { PageApiError, request } from '../pages/api';

function parseJson(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function apiErrorFromXhr(status: number, bodyText: string) {
  const body = parseJson(bodyText);
  const bodyRecord =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  const errorRecord =
    bodyRecord && typeof bodyRecord.error === 'object' && bodyRecord.error !== null
      ? (bodyRecord.error as Record<string, unknown>)
      : null;
  const code =
    errorRecord && typeof errorRecord.code === 'string' ? errorRecord.code : 'REQUEST_FAILED';
  const message =
    errorRecord && typeof errorRecord.message === 'string'
      ? errorRecord.message
      : 'The request could not be completed.';
  const details =
    errorRecord && typeof errorRecord.details === 'object' && errorRecord.details !== null
      ? errorRecord.details
      : undefined;
  return new PageApiError(status, code, message, details as Record<string, unknown> | undefined);
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function requestHeaders() {
  return { Accept: 'application/json' };
}

export function createRestoreSession(input: RestoreSessionCreateRequest) {
  const parsed = restoreSessionCreateRequestSchema.parse(input);
  return request<{ session: RestoreSessionStatus }>(
    '/api/private/restore/sessions',
    restoreSessionResponseSchema,
    { body: JSON.stringify(parsed), headers: requestHeaders(), method: 'POST' },
  );
}

export function fetchRestoreSession(id: string, signal?: AbortSignal) {
  return request<{ session: RestoreSessionStatus }>(
    `/api/private/restore/sessions/${encodeURIComponent(id)}`,
    restoreSessionResponseSchema,
    { headers: requestHeaders(), signal },
  );
}

export async function uploadRestoreRecordWithChecksum(
  sessionId: string,
  recordType: 'page' | 'revision' | 'publication' | 'tag' | 'template' | 'dailyNote',
  record:
    | BackupPageRecord
    | BackupRevisionRecord
    | BackupPublicationRecord
    | BackupTagRecord
    | BackupTemplateRecord
    | BackupDailyNoteRecord,
  checksum: string,
  signal?: AbortSignal,
) {
  const payload = canonicalJson(record);
  return request<{
    accepted: true;
    recordType: 'page' | 'revision' | 'publication' | 'tag' | 'template' | 'dailyNote';
    recordId: string;
  }>(
    `/api/private/restore/sessions/${encodeURIComponent(sessionId)}/records/${recordType}/${encodeURIComponent(record.id)}`,
    restoreRecordResponseSchema,
    {
      body: payload,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Dovari-SHA-256': checksum,
      },
      method: 'PUT',
      signal,
    },
  );
}

export function uploadRestoreAsset(
  sessionId: string,
  asset: BackupAssetRecord,
  bytes: Uint8Array,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<{ accepted: true; assetId: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      xhr.abort();
      fail(new DOMException('The upload was aborted.', 'AbortError'));
    };

    xhr.open(
      'PUT',
      `/api/private/restore/sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(asset.id)}`,
    );
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Dovari-Asset-Metadata', encodeBase64Url(canonicalJson(asset)));
    xhr.setRequestHeader('X-Dovari-SHA-256', asset.sha256);
    xhr.upload.addEventListener('progress', (event) => {
      onProgress(event.loaded, event.lengthComputable ? event.total : bytes.byteLength);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(apiErrorFromXhr(xhr.status, xhr.responseText));
        return;
      }
      const parsed = restoreAssetResponseSchema.safeParse(parseJson(xhr.responseText));
      if (!parsed.success) {
        fail(new PageApiError(500, 'INVALID_RESPONSE', 'The server returned an invalid response.'));
        return;
      }
      settled = true;
      cleanup();
      onProgress(bytes.byteLength, bytes.byteLength);
      resolve(parsed.data);
    });
    xhr.addEventListener('error', () =>
      fail(new PageApiError(500, 'UPLOAD_FAILED', 'The asset upload could not be completed.')),
    );
    xhr.addEventListener('abort', () =>
      fail(new DOMException('The upload was aborted.', 'AbortError')),
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    xhr.send(bytes.buffer as ArrayBuffer);
  });
}

export function finalizeRestoreSession(id: string, signal?: AbortSignal) {
  return request<{
    restored: true;
    pageCount: number;
    revisionCount: number;
    assetCount: number;
    tagCount: number;
    publicationCount: number;
    templateCount: number;
    dailyNoteCount: number;
  }>(
    `/api/private/restore/sessions/${encodeURIComponent(id)}/finalize`,
    restoreFinalizeResponseSchema,
    { headers: requestHeaders(), method: 'POST', signal },
  );
}

export function abortRestoreSession(id: string) {
  return request<{ deleted: true; sessionId: string }>(
    `/api/private/restore/sessions/${encodeURIComponent(id)}`,
    restoreDeleteResponseSchema,
    { headers: requestHeaders(), method: 'DELETE' },
  );
}

export async function downloadDovariBackup() {
  const response = await fetch('/api/private/backup', { headers: { Accept: 'application/zip' } });
  if (!response.ok) {
    const body = parseJson(await response.text());
    const errorRecord =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'object' &&
      body.error !== null
        ? body.error
        : null;
    throw new PageApiError(
      response.status,
      errorRecord && 'code' in errorRecord && typeof errorRecord.code === 'string'
        ? errorRecord.code
        : 'BACKUP_FAILED',
      errorRecord && 'message' in errorRecord && typeof errorRecord.message === 'string'
        ? errorRecord.message
        : 'The backup could not be downloaded.',
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const contentDisposition = response.headers.get('Content-Disposition');
  const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/u);
  link.download = filenameMatch?.[1] ?? 'dovari-backup-v2.zip';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
