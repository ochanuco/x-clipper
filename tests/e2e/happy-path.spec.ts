import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect, chromium } from '@playwright/test';
import { serveOfflineTweet } from './helpers/network.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const fixturesRoot = path.join(repoRoot, 'tests/e2e/fixtures');
const extensionPath = path.join(repoRoot, 'dist');

// 実際に存在する画像を使用（1995882697257021838/images/内の画像）
const avatarBuffer = readFileSync(path.join(fixturesRoot, '1995882697257021838/images/18.jpg'));
const mediaBuffer = readFileSync(path.join(fixturesRoot, '1995882697257021838/images/19.jpg'));

// 拡張機能をロードするカスタムフィクスチャ
const test = base.extend({
  context: async ({ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--disable-dev-shm-usage'
      ]
    });
    await use(context);
    await context.close();
  }
});

test.describe('オフラインMV3クリッピング', () => {
  test('ツイート画面にボタンを埋め込む', async ({ context }) => {
    const page = await context.newPage();
    const fixtureDir = path.join(fixturesRoot, '1995882697257021838');
    const tweetHtml = readFileSync(path.join(fixtureDir, 'index.html'), 'utf-8');

    await serveOfflineTweet(context, { tweetHtml, avatarBuffer, mediaBuffer, fixtureDir });

    await page.goto('https://x.com/ochanuco/status/1995882697257021838');

    // クリップボタンが表示されることを確認
    const clipButton = page.locator('article').filter({ hasText: '私の超精密MBTI診断結果は' }).locator('.x-clipper-save-button');
    await expect(clipButton).toBeVisible();

    await page.close();
  });
});
