import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeImageUrl, collectFromArticle } from './parser.js';

describe('normalizeImageUrl', () => {
    it('should return empty string for blob URLs', () => {
        expect(normalizeImageUrl('blob:https://x.com/abc123')).toBe('');
    });

    it('should add https: prefix for protocol-relative URLs', () => {
        expect(normalizeImageUrl('//pbs.twimg.com/media/test.jpg')).toBe('https://pbs.twimg.com/media/test.jpg');
    });

    it('should add https://x.com prefix for absolute paths', () => {
        expect(normalizeImageUrl('/media/test.jpg')).toBe('https://x.com/media/test.jpg');
    });

    it('should set name=orig for pbs.twimg.com URLs', () => {
        const result = normalizeImageUrl('https://pbs.twimg.com/media/test.jpg?name=small');
        expect(result).toContain('name=orig');
    });

    it('should return the URL as-is if already normalized', () => {
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
        global.document = document as any;
        global.window = dom.window as any;
    });

    it('should extract post data from article', () => {
        const article = document.querySelector('article[data-testid="tweet"]')!;
        const result = collectFromArticle(article);

        expect(result.screenName).toBe('Test User');
        expect(result.userName).toBe('@testuser');
        expect(result.text).toBe('This is a test tweet');
        expect(result.timestamp).toBe('2025-11-24T12:00:00.000Z');
        expect(result.images).toHaveLength(1);
        expect(result.images[0]).toContain('name=orig');
    });

    it('should return null when tweet content markers are missing', () => {
        const fakeArticle = document.createElement('div');
        const result = collectFromArticle(fakeArticle);

        expect(result).toBeNull();
    });
});
