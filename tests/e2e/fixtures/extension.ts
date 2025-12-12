import { test as base, chromium, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '../../..');
const extensionDist = path.join(repoRoot, 'dist');
const isHeadful = process.env.E2E_HEADFUL === '1';

type ExtensionFixtures = {
  extensionId: string;
  extensionWorker: Worker;
};

const test = base.extend<ExtensionFixtures>({
  context: async (_, use, testInfo) => {
    if (!existsSync(extensionDist)) {
      throw new Error('dist/ が見つかりません。先に pnpm run build を実行してください。');
    }

    const launchArgs = [
      `--disable-extensions-except=${extensionDist}`,
      `--load-extension=${extensionDist}`,
      '--no-sandbox'
    ];
    if (!isHeadful) {
      launchArgs.push('--headless=chrome');
    }

    const userDataDir = testInfo.outputPath('chromium-user-data-dir');
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: !isHeadful,
      chromiumSandbox: false,
      args: launchArgs
    });

    try {
      await use(context);
    } finally {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await page.close();
    }
  },
  extensionWorker: async ({ context }, use) => {
    let worker = context
      .serviceWorkers()
      .find(worker => worker.url().startsWith('chrome-extension://'));
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', {
        predicate: candidate => candidate.url().startsWith('chrome-extension://')
      });
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
