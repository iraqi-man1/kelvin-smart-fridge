import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.mjs', workers: 1, timeout: 30000,
  use: {
    baseURL: 'http://localhost:5180', headless: true,
    viewport: { width: 1440, height: 1050 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server.mjs', url: 'http://localhost:5180', reuseExistingServer: false,
    env: { PORT: '5180', DATA_FILE: path.join(tmpdir(), `rasd-e2e-${Date.now()}.json`) },
  },
});
