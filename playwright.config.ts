import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './backend/tests-e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: '.artifacts/playwright/report', open: 'never' }]],
  outputDir: '.artifacts/playwright/test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npx playwright run-server --host 127.0.0.1 --port 4180',
      url: 'http://127.0.0.1:4180',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'node backend/tests-e2e/server.cjs',
      url: 'http://127.0.0.1:4173/api/status',
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'test',
        COMICCRAWLER_E2E_HOST: '127.0.0.1',
        COMICCRAWLER_E2E_PORT: '4173',
        COMICCRAWLER_E2E_BROWSER_WS_ENDPOINT: 'ws://127.0.0.1:4180/',
      },
      timeout: 30000,
    },
  ],
});
