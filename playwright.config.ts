import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  retries: process.env.CI ? 2 : 0,
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      process.env.DOVARI_E2E_DEV_SERVER === '1'
        ? 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort'
        : 'npm run preview -- --host 127.0.0.1',
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:4173',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
