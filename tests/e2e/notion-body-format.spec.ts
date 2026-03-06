import { test, expect } from './fixtures/extension.js';

const tweetHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta property="og:title" content="Sample Creator (@sample_creator)" />
    <link rel="canonical" href="https://x.com/sample_creator/status/1900000000000000000" />
  </head>
  <body>
    <article data-testid="tweet">
      <div data-testid="User-Names">
        <a href="/sample_creator"><span>Sample Creator</span></a>
        <a href="/sample_creator"><span>@sample_creator</span></a>
      </div>
      <div data-testid="tweetText">
        <span>The alley feels untouched, even after everything ended.</span><br />
        <br />
        <span>Sample Suit Ver.1 “Wanderer in Space” by Example Author.</span><br />
        <br />
        <span>Handcrafted from satin spandex with neon detailing for a futuristic look.</span><br />
        <br />
        <span>Get it here: </span>
        <a href="https://t.co/abc123" title="https://example.com/neoskin">
          <span aria-hidden="true">http://</span>example.com/neoskin
        </a><br />
        <br />
        <a href="/hashtag/cosplay"><span>#cosplay</span></a>
        <span> </span>
        <a href="/hashtag/techwear"><span>#techwear</span></a>
      </div>
      <time datetime="2026-02-27T10:00:00.000Z"></time>
      <div role="group">
        <div><button data-testid="reply" type="button">reply</button></div>
        <div><button data-testid="retweet" type="button">retweet</button></div>
        <div><button data-testid="like" type="button">like</button></div>
      </div>
    </article>
  </body>
</html>`;

test.describe('本文抽出フォーマット', () => {
  test('改行を保持し、http://短縮表示リンクを完全URLとして復元する', async ({ context, page, extensionWorker }) => {
    await context.route('https://x.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        body: tweetHtml,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    });

    await page.goto('https://x.com/sample_creator/status/1900000000000000000');

    const extracted = await extensionWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://x.com/*/status/*' });
      if (!tab?.id) return null;
      return await new Promise<any>((resolve) => {
        chrome.tabs.sendMessage(tab.id!, { type: 'EXTRACT_X_POST' }, (response) => {
          resolve(response);
        });
      });
    });

    expect(extracted?.success).toBe(true);
    expect(extracted?.data?.text).toContain('The alley feels untouched, even after everything ended.');
    expect(extracted?.data?.text).toContain('\n\nSample Suit Ver.1');
    expect(extracted?.data?.text).toContain('\n\nGet it here: http://example.com/neoskin');
    expect(extracted?.data?.text).toContain('\n\n#cosplay #techwear');
  });
});
