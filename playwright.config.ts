import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './backend/tests-e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
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
  webServer: {
    command: 'node backend/tests-e2e/server.cjs',
    url: 'http://127.0.0.1:4173/api/status',
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '4173',
    },
    timeout: 30000,
  },
});
