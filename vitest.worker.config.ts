import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { resolve } from 'node:path';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          DOVARI_TEST_D1_MIGRATIONS: JSON.stringify(await readD1Migrations(resolve('migrations'))),
        },
      },
      wrangler: {
        configPath: './wrangler.jsonc',
        secrets: { DOVARI_PASSWORD: 'dovari-test-password-2026' },
      },
    })),
  ],
  test: {
    fileParallelism: false,
    include: ['src/worker/**/*.test.ts'],
    name: 'worker',
  },
});
