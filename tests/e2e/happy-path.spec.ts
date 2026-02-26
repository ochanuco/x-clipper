import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect, chromium } from '@playwright/test';
import { serveOfflineTweet } from './helpers/network.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const fixturesRoot = path.join(repoRoot, 'tests/fixtures/x');
const extensionPath = path.join(repoRoot, 'dist');
const fixtureId = '2025074037639234017';

// 実際に存在する画像を使用（fixture内の画像）
const avatarBuffer = readFileSync(path.join(fixturesRoot, `${fixtureId}/images/avatar.jpg`));
const mediaBuffer = readFileSync(path.join(fixturesRoot, `${fixtureId}/images/media.jpg`));

// 拡張機能をロードするカスタムフィクスチャ
const test = base.extend({
  context: async ({ }, use) => {
    // 拡張機能は非headlessモードが必要、CIではxvfbで対応
    const launchOptions = {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--disable-dev-shm-usage'
      ]
    } as const;

    let context;
    try {
      context = await chromium.launchPersistentContext('', launchOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // ローカルで Playwright 管理ブラウザが未導入でも、インストール済み Chrome で実行できるようにする
      if (!message.includes('Executable doesn\'t exist')) {
        throw error;
      }
      context = await chromium.launchPersistentContext('', {
        ...launchOptions,
        channel: 'chrome'
      });
    }
    await use(context);
    await context.close();
  }
});

test.describe('オフラインMV3クリッピング', () => {
  test('ツイート画面にボタンを埋め込む', async ({ context }) => {
    const page = await context.newPage();
    const fixtureDir = path.join(fixturesRoot, fixtureId);
    const tweetHtml = readFileSync(path.join(fixtureDir, 'index.html'), 'utf-8');

    await serveOfflineTweet(context, { tweetHtml, avatarBuffer, mediaBuffer, fixtureDir });

    await page.goto(`https://x.com/ochanuco/status/${fixtureId}`);

    // クリップボタンが表示されることを確認
    const clipButton = page.locator('article .x-clipper-save-button').first();
    await expect(clipButton).toBeVisible({ timeout: 10000 });

    await page.close();
  });
});
