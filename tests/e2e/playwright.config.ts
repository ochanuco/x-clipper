import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  testDir: __dirname,
  timeout: 360 * 1000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: path.join(__dirname, '../../.playwright-output'),
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--disable-dev-shm-usage'] // avoid shared memory exhaustion on CI
    }
  }
});
