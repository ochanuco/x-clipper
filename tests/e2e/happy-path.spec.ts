import path from 'node:path';
import { readFileSync } from 'node:fs';

import { expect, repoRoot, test } from './fixtures/extension.js';
import { serveOfflineTweet } from './helpers/network.js';
import { getNotionPages, mockNotionApi } from './helpers/notion.js';
import { seedSettings } from './helpers/storage.js';
import { keepServiceWorkerAlive } from './helpers/worker.js';

const fixturesRoot = path.join(repoRoot, 'tests/e2e/fixtures');
const avatarBuffer = readFileSync(path.join(fixturesRoot, 'assets/avatar.png'));
const mediaBuffer = readFileSync(path.join(fixturesRoot, 'assets/media.png'));

const notionSettings = {
  notionApiKey: 'secret_test_123',
  notionDatabaseId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  notionVersion: '2025-09-03',
  propertyMap: {
    title: 'Name',
    screenName: 'Screen Name',
    userName: 'Username',
    tweetUrl: 'Tweet URL',
    postedAt: 'Posted At'
  }
};

test.describe('オフラインMV3クリッピング', () => {
  test('画像付きツイートをNotionに連携できる', async ({ page, context, extensionWorker, extensionId }) => {
    const tweetHtml = readFileSync(path.join(fixturesRoot, 'html/offline-tweet-image-1.html'), 'utf-8');

    await seedSettings(extensionWorker, notionSettings);

    const keepAlivePage = await keepServiceWorkerAlive(context, extensionId);
    await mockNotionApi(extensionWorker);
    await serveOfflineTweet(context, { tweetHtml, avatarBuffer, mediaBuffer });

    await page.goto('https://x.com/ochanuco/status/1931245502743589365');

    const clipButton = page.locator('.x-clipper-save-button');
    await expect(clipButton).toBeVisible();

    await clipButton.click();

    await expect
      .poll(async () => (await getNotionPages(extensionWorker)).length, { timeout: 10000 })
      .toBe(1);

    const notionPages = await getNotionPages(extensionWorker);
    const notionPayload = notionPages[0] as Record<string, any> | undefined;
    expect(notionPayload).toBeDefined();
    if (!notionPayload) {
      throw new Error('Notion payload was not captured');
    }

    expect(notionPayload.parent.database_id).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(notionPayload.properties['Name'].title[0].text.content).toContain('（');
    expect(notionPayload.properties['Screen Name'].rich_text[0].text.content).toBe('ちゃぬ');
    expect(notionPayload.properties['Username'].rich_text[0].text.content).toBe('@ochanuco');
    expect(notionPayload.properties['Tweet URL'].url).toBe('https://x.com/ochanuco/status/1931245502743589365');
    expect(notionPayload.properties['Posted At'].date.start).toBe('2025-06-07T07:03:03.000Z');

    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('.x-clipper-save-button');
      if (!button) return false;
      return button.innerHTML.includes('fill="#10b981"');
    }, { timeout: 4000 });

    const imageBlock = (notionPayload.children as Array<Record<string, any>>).find((block) => block.type === 'image');
    expect(imageBlock).toBeDefined();
    const imageSource = imageBlock?.image?.file_upload ?? imageBlock?.image?.external;
    expect(imageSource).toBeDefined();

    const iconSource = notionPayload.icon?.file_upload ?? notionPayload.icon?.external;
    expect(iconSource).toBeDefined();

    await keepAlivePage.close();
  });

  test('テキストのみツイートをNotionに連携できる', async ({ page, context, extensionWorker, extensionId }) => {
    const tweetHtml = readFileSync(path.join(fixturesRoot, 'html/offline-tweet-text-only.html'), 'utf-8');

    await seedSettings(extensionWorker, notionSettings);

    const keepAlivePage = await keepServiceWorkerAlive(context, extensionId);
    await mockNotionApi(extensionWorker);
    await serveOfflineTweet(context, { tweetHtml, avatarBuffer, mediaBuffer });

    await page.goto('https://x.com/ochanuco/status/1937047623086866442');

    const clipButton = page.locator('.x-clipper-save-button');
    await expect(clipButton).toBeVisible();

    await clipButton.click();

    await expect
      .poll(async () => (await getNotionPages(extensionWorker)).length, { timeout: 10000 })
      .toBe(1);

    const notionPages = await getNotionPages(extensionWorker);
    const notionPayload = notionPages[0] as Record<string, any> | undefined;
    expect(notionPayload).toBeDefined();
    if (!notionPayload) {
      throw new Error('Notion payload was not captured');
    }

    expect(notionPayload.parent.database_id).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(notionPayload.properties['Name'].title[0].text.content).toContain('父ちゃんな、脱サラして味噌汁屋を開こうと思うんや。');
    expect(notionPayload.properties['Screen Name'].rich_text[0].text.content).toBe('ちゃぬ');
    expect(notionPayload.properties['Username'].rich_text[0].text.content).toBe('@ochanuco');
    expect(notionPayload.properties['Tweet URL'].url).toBe('https://x.com/ochanuco/status/1937047623086866442');
    expect(notionPayload.properties['Posted At'].date.start).toBe('2025-06-23T07:18:36.000Z');

    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('.x-clipper-save-button');
      if (!button) return false;
      return button.innerHTML.includes('fill="#10b981"');
    }, { timeout: 4000 });

    // テキストのみなので画像ブロックは存在しない
    const imageBlock = (notionPayload.children as Array<Record<string, any>>).find((block) => block.type === 'image');
    expect(imageBlock).toBeUndefined();

    const iconSource = notionPayload.icon?.file_upload ?? notionPayload.icon?.external;
    expect(iconSource).toBeDefined();

    await keepAlivePage.close();
  });
});
