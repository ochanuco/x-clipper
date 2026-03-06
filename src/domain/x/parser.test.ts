import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeImageUrl, collectFromArticle } from './parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('normalizeImageUrl', () => {
  it('blob URL は空文字を返す', () => {
    expect(normalizeImageUrl('blob:https://x.com/abc123')).toBe('');
  });

  it('プロトコル相対URLに https: を補完する', () => {
    expect(normalizeImageUrl('//pbs.twimg.com/media/test.jpg')).toBe('https://pbs.twimg.com/media/test.jpg');
  });

  it('絶対パスに https://x.com を補完する', () => {
    expect(normalizeImageUrl('/media/test.jpg')).toBe('https://x.com/media/test.jpg');
  });

  it('pbs.twimg.com の name パラメータを orig に正規化する', () => {
    const result = normalizeImageUrl('https://pbs.twimg.com/media/test.jpg?name=small');
    expect(result).toContain('name=orig');
  });

  it('既に正規化済みのURLはそのまま返す', () => {
    const url = 'https://example.com/image.png';
    expect(normalizeImageUrl(url)).toBe(url);
  });
});

describe('collectFromArticle', () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="Test User (@testuser)" />
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="User-Names">
              <a href="/testuser">
                <span>Test User</span>
              </a>
              <a href="/testuser">
                <span>@testuser</span>
              </a>
            </div>
            <div data-testid="tweetText">
              <span>This is a test tweet</span>
            </div>
            <time datetime="2025-11-24T12:00:00.000Z"></time>
            <img data-testid="Tweet-User-Avatar" src="https://pbs.twimg.com/profile_images/avatar.jpg" />
            <div data-testid="tweetPhoto">
              <img src="https://pbs.twimg.com/media/image1.jpg?name=small" />
            </div>
          </article>
        </body>
      </html>
    `);
    document = dom.window.document;
    globalThis.document = document;
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
  });

  it('記事要素から投稿データを抽出できる', () => {
    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.screenName).toBe('Test User');
    expect(result.userName).toBe('@testuser');
    expect(result.text).toBe('This is a test tweet');
    expect(result.timestamp).toBe('2025-11-24T12:00:00.000Z');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toContain('name=orig');
  });

  it('投稿コンテンツ要素がない場合は null を返す', () => {
    const fakeArticle = document.createElement('div');
    const result = collectFromArticle(fakeArticle);

    expect(result).toBeNull();
  });

  it('本文のリンク表示文字列を展開して取り込む', () => {
    const linkDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <span>Check this</span>
              <a href="https://t.co/abc123">
                <span aria-hidden="true">https://</span>example.com
              </a>
            </div>
          </article>
        </body>
      </html>
    `);
    document = linkDom.window.document;
    globalThis.document = document;
    globalThis.window = linkDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('Check this https://example.com');
  });

  it('アンカー文字列が protocol のみでも完全URLを復元する', () => {
    const linkDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <span>Get it here:</span>
              <a href="https://t.co/abc123" title="https://store.example.com/products/neon-suit">
                <span aria-hidden="true">http://</span>
              </a>
            </div>
          </article>
        </body>
      </html>
    `);
    document = linkDom.window.document;
    globalThis.document = document;
    globalThis.window = linkDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('Get it here: https://store.example.com/products/neon-suit');
  });

  it('省略表示より title の展開URLを優先する', () => {
    const linkDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/abc123" title="https://gallery.example.net/posts/12345678">
                gallery.example.net/posts/12345...
              </a>
              <span>テストテキスト</span>
            </div>
          </article>
        </body>
      </html>
    `);
    document = linkDom.window.document;
    globalThis.document = document;
    globalThis.window = linkDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('https://gallery.example.net/posts/12345678 テストテキスト');
  });

  it('子要素の title 属性から展開URLを取得する', () => {
    const linkDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/abc123">
                <span title="https://gallery.example.net/posts/12345678">gallery.example.net/posts/12345...</span>
              </a>
            </div>
          </article>
        </body>
      </html>
    `);
    document = linkDom.window.document;
    globalThis.document = document;
    globalThis.window = linkDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('https://gallery.example.net/posts/12345678');
  });

  it('展開URLが無い場合は t.co の href を保持する', () => {
    const linkDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/abc123">gallery.example.net/posts/12345...</a>
            </div>
          </article>
        </body>
      </html>
    `);
    document = linkDom.window.document;
    globalThis.document = document;
    globalThis.window = linkDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('https://t.co/abc123');
  });

  it('末尾省略の可視URLを long-id として正規化する', () => {
    const linkDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/ghi789">https://gallery.example.net/posts/12345678…</a>
            </div>
          </article>
        </body>
      </html>
    `);
    document = linkDom.window.document;
    globalThis.document = document;
    globalThis.window = linkDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('https://gallery.example.net/posts/12345678');
  });

  it('末尾省略でもクエリ付き可視URLを採用する', () => {
    const linkDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/jkl012">https://video.example.org/watch?v=abcd1234&si=8X0v7_RAcrrJIzU1…</a>
            </div>
          </article>
        </body>
      </html>
    `);
    document = linkDom.window.document;
    globalThis.document = document;
    globalThis.window = linkDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('https://video.example.org/watch?v=abcd1234&si=8X0v7_RAcrrJIzU1');
  });

  it('末尾省略でも安定したslug付き可視URLを採用する', () => {
    const linkDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/abc123">https://example.com/articles/slugvalue01…</a>
            </div>
          </article>
        </body>
      </html>
    `);
    document = linkDom.window.document;
    globalThis.document = document;
    globalThis.window = linkDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('https://example.com/articles/slugvalue01');
  });

  it('@mention を URL に誤変換しない', () => {
    const linkDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="/test_user">@test_user</a>
              <span>より</span>
            </div>
          </article>
        </body>
      </html>
    `);
    document = linkDom.window.document;
    globalThis.document = document;
    globalThis.window = linkDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('@test_user より');
  });

  it('mention 前に付いた隠し https:// を除去する', () => {
    const linkDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="/test_user"><span aria-hidden="true">https://</span>@test_user</a>
              <span>より</span>
            </div>
          </article>
        </body>
      </html>
    `);
    document = linkDom.window.document;
    globalThis.document = document;
    globalThis.window = linkDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('@test_user より');
  });

  it('本文の改行を保持する', () => {
    const lineBreakDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="canonical" href="https://x.com/testuser/status/123456789" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <span>line 1
line 2</span>
            </div>
          </article>
        </body>
      </html>
    `);
    document = lineBreakDom.window.document;
    globalThis.document = document;
    globalThis.window = lineBreakDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result?.text).toBe('line 1\nline 2');
  });

  it('fixture から cashtag と引用投稿と画像を抽出できる', () => {
    const fixtureHtml = readFileSync(
      path.resolve(__dirname, '../../../tests/fixtures/x/2025074037639234017/index.html'),
      'utf-8'
    );
    const fixtureDom = new JSDOM(fixtureHtml, { url: 'https://x.com/sample_user/status/2025074037639234017' });
    document = fixtureDom.window.document;
    globalThis.document = document;
    globalThis.window = fixtureDom.window as unknown as Window & typeof globalThis;

    const article = document.querySelector('article[data-testid="tweet"]')!;
    const result = collectFromArticle(article);

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.userName).toBe('@sample_user');
    expect(result.text).toContain('$fric');
    expect(result.url).toContain('/status/2025074037639234017');
    expect(result.images.length).toBeGreaterThanOrEqual(1);
    expect(result.images.some((url) => url.includes('https://x.com/images/media.jpg'))).toBe(true);
    expect(result.images.some((url) => url.includes('pbs.twimg.com/media/'))).toBe(true);
  });
});
