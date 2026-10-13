import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pwa',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['iPhone 13'],
    browserName: 'chromium',
    channel: 'chrome',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
  reporter: 'list',
});
