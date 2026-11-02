import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 60000, workers: 1,
  use: { browserName: 'chromium', headless: true,
    launchOptions: { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] } },
  webServer: { command: 'npm start', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 15000 },
  reporter: 'list',
});
