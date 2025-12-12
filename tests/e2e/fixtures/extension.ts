import { test as base, chromium, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '../../..');
const extensionDist = path.join(repoRoot, 'dist');
const shouldRunHeadless = process.env.E2E_HEADFUL === '1' ? false : true;

type ExtensionFixtures = {
  extensionId: string;
  extensionWorker: Worker;
};

const test = base.extend<ExtensionFixtures>({
  context: async ({ }, use, testInfo) => {
    if (!existsSync(extensionDist)) {
      throw new Error('dist/ が見つかりません。先に pnpm run build を実行してください。');
    }

    const launchArgs = [
      `--disable-extensions-except=${extensionDist}`,
      `--load-extension=${extensionDist}`,
      '--no-sandbox'
    ];
    if (shouldRunHeadless) {
      launchArgs.push('--headless=chrome');
    }

    const userDataDir = testInfo.outputPath('chromium-user-data-dir');
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: shouldRunHeadless,
      chromiumSandbox: false,
      args: launchArgs
    });

    await use(context);
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
  extensionWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) {
      worker = await context.waitForEvent('serviceworker');
    }
    await use(worker);
  },
  extensionId: async ({ extensionWorker }, use) => {
    const workerUrl = new URL(extensionWorker.url());
    await use(workerUrl.host);
  }
});

export { test };
export const expect = test.expect;
