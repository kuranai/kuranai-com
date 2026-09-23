import { describe, expect, it, vi } from 'vitest';

import { AssetService } from './service';

describe('AssetService', () => {
  it('removes the R2 object when metadata persistence fails', async () => {
    const put = vi.fn(async () => ({}) as R2Object);
    const deleteObject = vi.fn<(...args: [string]) => Promise<void>>(() => Promise.resolve());
    const bucket = { delete: deleteObject, put } as unknown as R2Bucket;
    const db = {
      prepare: vi.fn(() => ({
        bind: () => ({
          run: vi.fn(async () => {
            throw new Error('D1 unavailable');
          }),
        }),
      })),
    } as unknown as D1Database;
    const service = new AssetService(db, bucket);

    await expect(
      service.upload(
        new Request('https://dovari.test/upload', {
          body: 'rollback me',
          headers: {
            'Content-Type': 'text/plain',
            'X-Dovari-Filename': 'rollback.txt',
          },
          method: 'POST',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ASSET_UPLOAD_FAILED', status: 500 });

    expect(put).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject.mock.calls[0]?.[0]).toMatch(/^assets\/\d{4}\/\d{2}\/[0-9a-f-]+\.txt$/);
  });
});
