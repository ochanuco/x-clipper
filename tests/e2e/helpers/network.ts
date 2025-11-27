import type { BrowserContext } from '@playwright/test';

type OfflineTweetAssets = {
  tweetHtml: string;
  avatarBuffer: Buffer;
  mediaBuffer: Buffer;
};

export async function serveOfflineTweet(
  context: BrowserContext,
  { tweetHtml, avatarBuffer, mediaBuffer }: OfflineTweetAssets
) {
  // 実サイトの追加リクエストがCIで遅延しないよう、必要ドメイン以外は即座に捨てる
  await context.route(/^(?!https:\/\/(?:x\.com|pbs\.twimg\.com)\/).*/, (route) =>
    route.fulfill({ status: 204, body: '' })
  );

  await context.route('https://x.com/**', (route) =>
    route.fulfill({
      status: 200,
      body: tweetHtml,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  );

  await context.route('https://pbs.twimg.com/**', (route) => {
    const isAvatar = route.request().url().includes('profile_images');
    const body = isAvatar ? avatarBuffer : mediaBuffer;
    return route.fulfill({
      status: 200,
      body,
      headers: { 'content-type': 'image/png' }
    });
  });
}
