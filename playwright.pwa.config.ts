import { defineConfig, devices } from '@playwright/test';
const publishedURL = process.env.PWA_BASE_URL;
const baseURL = publishedURL || `http://localhost:4173${process.env.VITE_BASE_PATH || '/'}`;
export default defineConfig({
  testDir: './tests/pwa',
  workers: 1,
  timeout: 45000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL,
    ...devices['iPhone 13'],
    browserName: 'chromium',
    channel: process.env.CI ? undefined : 'chrome',
    serviceWorkers: 'allow',
  },
  webServer: publishedURL
    ? undefined
    : {
        command: 'npm run preview -- --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: false,
      },
  reporter: 'list',
});
