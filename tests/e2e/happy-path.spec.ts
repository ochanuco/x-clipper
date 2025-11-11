import path from 'node:path';
import { readFileSync } from 'node:fs';

import { expect, repoRoot, test } from './fixtures/extension.js';
import { seedSettings } from './helpers/storage.js';

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

    const avatarBase64 = avatarBuffer.toString('base64');
    const mediaBase64 = mediaBuffer.toString('base64');

    const keepAlivePage = await context.newPage();
    await keepAlivePage.goto(`chrome-extension://${extensionId}/options.html#e2e-keep-alive`);
    await keepAlivePage.evaluate(() => {
      if (!(globalThis as Record<string, unknown>).__xClipperKeepAlivePort) {
        (globalThis as Record<string, unknown>).__xClipperKeepAlivePort = chrome.runtime.connect({ name: 'x-clipper-e2e-keep-alive' });
      }
    });

    await extensionWorker.evaluate(
      ({ avatarBase64, mediaBase64 }) => {
        const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
        const avatarBlob = new Blob([decode(avatarBase64)], { type: 'image/png' });
        const mediaBlob = new Blob([decode(mediaBase64)], { type: 'image/png' });

        const notionPages: Array<Record<string, unknown>> = [];
        (globalThis as Record<string, unknown>).__xClipperNotionPages = notionPages;

        const jsonResponse = (body: Record<string, unknown>) =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });

        const originalFetch = fetch.bind(globalThis);
        globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
          try {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const method = (init.method ?? 'GET').toUpperCase();

            if (!url) {
              return originalFetch(input, init);
            }

            if (url.startsWith('https://pbs.twimg.com/profile_images')) {
              return new Response(avatarBlob.slice(), {
                status: 200,
                headers: { 'content-type': 'image/png' }
              });
            }

            if (url.startsWith('https://pbs.twimg.com/media')) {
              return new Response(mediaBlob.slice(), {
                status: 200,
                headers: { 'content-type': 'image/png' }
              });
            }

            if (url === 'https://api.notion.com/v1/file_uploads' && method === 'POST') {
              return jsonResponse({ id: `upload_${Date.now()}` });
            }

            const sendMatch = url.match(/^https:\/\/api\.notion\.com\/v1\/file_uploads\/([^/]+)\/send$/);
            if (sendMatch && method === 'POST') {
              const uploadId = sendMatch[1];
              return jsonResponse({
                id: uploadId,
                status: 'uploaded',
                filename: `${uploadId}.png`,
                content_type: 'image/png'
              });
            }

            if (url === 'https://api.notion.com/v1/pages' && method === 'POST') {
              let parsed: Record<string, unknown> = {};
              if (typeof init.body === 'string') {
                try {
                  parsed = JSON.parse(init.body);
                } catch {
                  parsed = {};
                }
              }
              notionPages.push(parsed);
              return jsonResponse({ id: 'mock-page-id' });
            }
          } catch (error) {
            console.warn('mock fetch error', error);
          }
          return originalFetch(input, init);
        };
      },
      { avatarBase64, mediaBase64 }
    );

    await context.route('https://x.com/**', (route) =>
      route.fulfill({
        status: 200,
        body: tweetHtml,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    );

    await context.route('https://pbs.twimg.com/**', (route) => {
      const body = route.request().url().includes('profile_images') ? avatarBuffer : mediaBuffer;
      return route.fulfill({
        status: 200,
        body,
        headers: { 'content-type': 'image/png' }
      });
    });

    await page.goto('https://x.com/alice_dev/status/1234567890');

    const clipButton = page.locator('.x-clipper-save-button');
    await expect(clipButton).toBeVisible();

    await clipButton.click();

    await expect.poll(
      async () =>
        extensionWorker.evaluate(() => {
          const pages = (globalThis as Record<string, unknown>).__xClipperNotionPages as Array<Record<string, unknown>> | undefined;
          return pages?.length ?? 0;
        }),
      { timeout: 10000 }
    ).toBe(1);

    const payload = (await extensionWorker.evaluate(() => {
      const pages = (globalThis as Record<string, unknown>).__xClipperNotionPages as Array<Record<string, unknown>> | undefined;
      return pages?.[0] ?? null;
    })) as Record<string, any> | null;

    expect(payload).not.toBeNull();
    const notionPayload = payload as Record<string, any>;

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
