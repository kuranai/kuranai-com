import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';

const TABLE_NAME = 'p03_binding_probe';
let assetKey: string | undefined;

afterEach(async () => {
  await env.DB.exec(`DROP TABLE IF EXISTS ${TABLE_NAME}`);

  if (assetKey) {
    await env.ASSETS.delete(assetKey);
    assetKey = undefined;
  }
});

describe('local Worker bindings', () => {
  it('reads and writes isolated D1 and R2 test bindings', async () => {
    await env.DB.exec(
      `CREATE TABLE ${TABLE_NAME} (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
    );

    const recordId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO ${TABLE_NAME} (id, value) VALUES (?, ?)`)
      .bind(recordId, 'local-test-value')
      .run();

    const record = await env.DB.prepare(`SELECT value FROM ${TABLE_NAME} WHERE id = ?`)
      .bind(recordId)
      .first<{ value: string }>();

    expect(record).toEqual({ value: 'local-test-value' });

    assetKey = `p03-test/${crypto.randomUUID()}.txt`;
    await env.ASSETS.put(assetKey, 'local-r2-value', {
      httpMetadata: { contentType: 'text/plain' },
    });

    const asset = await env.ASSETS.get(assetKey);
    expect(asset).not.toBeNull();
    await expect(asset?.text()).resolves.toBe('local-r2-value');
  });

  it('runs the main Worker against the same local bindings', async () => {
    const response = await workerExports.default.fetch(
      new Request('https://dovari.test/api/health'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });
});
