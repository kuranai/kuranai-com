import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadAsset } from './api';

type ProgressListener = (event: {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}) => void;

class FakeUploadXhr {
  static latest: FakeUploadXhr | undefined;

  readonly headers = new Map<string, string>();
  readonly upload = {
    addEventListener: (_event: string, listener: ProgressListener) => {
      this.progressListener = listener;
    },
  };
  status = 201;
  responseText = '';
  progressListener: ProgressListener | undefined;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());

  constructor() {
    FakeUploadXhr.latest = this;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  getResponseHeader(name: string) {
    return this.headers.get(name) ?? null;
  }

  progress(loaded: number, total: number) {
    this.progressListener?.({ lengthComputable: true, loaded, total });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeUploadXhr.latest = undefined;
});

describe('uploadAsset', () => {
  it('sends the page and filename headers and reports upload progress', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadXhr);
    const progress: number[] = [];
    const file = new File(['screenshot'], 'screen shots/ä.png', { type: 'image/png' });
    const promise = uploadAsset(file, {
      onProgress: (value) => progress.push(value),
      pageId: '11111111-1111-4111-8111-111111111111',
    });
    const xhr = FakeUploadXhr.latest!;
    xhr.progress(25, 100);
    xhr.responseText = JSON.stringify({
      asset: {
        contentUrl: '/api/private/assets/asset/content',
        filename: 'ä.png',
        id: '22222222-2222-4222-8222-222222222222',
        mimeType: 'image/png',
        sizeBytes: 10,
      },
    });
    xhr.onload?.();

    await expect(promise).resolves.toMatchObject({ id: '22222222-2222-4222-8222-222222222222' });
    expect(xhr.open).toHaveBeenCalledWith('POST', '/api/private/assets');
    expect(xhr.headers.get('Accept')).toBe('application/json');
    expect(xhr.headers.get('Content-Type')).toBe('image/png');
    expect(xhr.headers.get('X-Dovari-Filename')).toBe('screen%20shots%2F%C3%A4.png');
    expect(xhr.headers.get('X-Dovari-Page-Id')).toBe('11111111-1111-4111-8111-111111111111');
    expect(xhr.send).toHaveBeenCalledWith(file);
    expect(progress).toEqual([25, 100]);
  });

  it('turns the standard API error response into a retryable upload error', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadXhr);
    const promise = uploadAsset(
      new File(['large'], 'large.bin', { type: 'application/octet-stream' }),
    );
    const xhr = FakeUploadXhr.latest!;
    xhr.status = 413;
    xhr.responseText = JSON.stringify({
      error: {
        code: 'ASSET_TOO_LARGE',
        details: { maxBytes: 25 * 1024 * 1024 },
        message: 'This file is too large.',
      },
    });
    xhr.onload?.();

    await expect(promise).rejects.toMatchObject({
      code: 'ASSET_TOO_LARGE',
      status: 413,
    });
  });
});
