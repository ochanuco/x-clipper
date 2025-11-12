import path from 'node:path';
import { readFileSync } from 'node:fs';

import { expect, repoRoot, test } from './fixtures/extension.js';
import { serveOfflineTweet } from './helpers/network.js';
import { getNotionPages, mockNotionApi } from './helpers/notion.js';
import { seedSettings } from './helpers/storage.js';
import { keepServiceWorkerAlive } from './helpers/worker.js';

const fixturesRoot = path.join(repoRoot, 'tests/e2e/fixtures');
const tweetHtml = readFileSync(path.join(fixturesRoot, 'html/offline-tweet.html'), 'utf-8');
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
  test('保存済みツイートをNotionに連携できる', async ({ page, context, extensionWorker, extensionId }) => {
    await seedSettings(extensionWorker, notionSettings);

    const keepAlivePage = await keepServiceWorkerAlive(context, extensionId);
    await mockNotionApi(extensionWorker);
    await serveOfflineTweet(context, { tweetHtml, avatarBuffer, mediaBuffer });

    await page.goto('https://x.com/alice_dev/status/1234567890');

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
    expect(notionPayload.properties['Name'].title[0].text.content).toContain('Playwright E2E');
    expect(notionPayload.properties['Screen Name'].rich_text[0].text.content).toBe('Alice Example');
    expect(notionPayload.properties['Username'].rich_text[0].text.content).toBe('@alice_dev');
    expect(notionPayload.properties['Tweet URL'].url).toBe('https://x.com/alice_dev/status/1234567890');
    expect(notionPayload.properties['Posted At'].date.start).toBe('2024-05-04T12:34:56.000Z');

    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('.x-clipper-save-button');
      if (!button) return false;
      return button.innerHTML.includes('fill="#10b981"');
    }, { timeout: 4000 });

    const imageBlock = (notionPayload.children as Array<Record<string, any>>).find((block) => block.type === 'image');
    expect(imageBlock).toBeDefined();
    const imageSource = imageBlock?.image?.file_upload ?? imageBlock?.image?.external;
    expect(imageSource).toBeDefined();
    if (imageBlock?.image?.external) {
      expect(imageBlock.image.external.url).toContain('offline-media.png?name=orig');
    } else if (imageBlock?.image?.file_upload) {
      expect(imageBlock.image.file_upload.id).toContain('upload_');
    }

    const iconSource = notionPayload.icon?.file_upload ?? notionPayload.icon?.external;
    expect(iconSource).toBeDefined();

    await keepAlivePage.close();
  });
});
