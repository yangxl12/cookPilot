import { defineConfig, devices } from '@playwright/test';
const baseURL = `http://localhost:4173${process.env.VITE_BASE_PATH || '/'}`;
export default defineConfig({
  testDir: './tests/pwa',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL,
    ...devices['iPhone 13'],
    browserName: 'chromium',
    channel: 'chrome',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
  },
  reporter: 'list',
});
