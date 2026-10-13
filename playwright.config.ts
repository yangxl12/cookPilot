import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['iPhone 13'],
    browserName: 'chromium',
    channel: 'chrome',
    serviceWorkers: 'block',
  },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
  reporter: 'list',
});
