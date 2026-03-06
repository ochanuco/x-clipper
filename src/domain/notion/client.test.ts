import { describe, it, expect } from 'vitest';
import { buildParagraphRichText, buildProperties } from './client.js';
import type { XPostPayload } from '../x/types.js';
import type { AppSettings } from '../../types.js';

describe('buildParagraphRichText', () => {
  it('http リンクに表示文字列を保ったままハイパーリンクを付与する', () => {
    const text = 'https://gallery.example.net/posts/12345678… https://portal.example.jp/item.php?item_id=2301… テストテキスト';
    const richText = buildParagraphRichText(text) as Array<Record<string, any>>;

    expect(richText[0].text.content).toBe('https://gallery.example.net/posts/12345678…');
    expect(richText[0].text.link.url).toBe('https://gallery.example.net/posts/12345678');
    expect(richText[1].text.content).toBe(' ');
    expect(richText[2].text.content).toBe('https://portal.example.jp/item.php?item_id=2301…');
    expect(richText[2].text.link.url).toBe('https://portal.example.jp/item.php?item_id=2301');
    expect(richText[3].text.content).toBe(' テストテキスト');
  });

  it('スキームなしドメインにもハイパーリンクを付与する', () => {
    const text = 'Get it here: store.example.com/products/neon-suit';
    const richText = buildParagraphRichText(text) as Array<Record<string, any>>;

    expect(richText[1].text.content).toBe('store.example.com/products/neon-suit');
    expect(richText[1].text.link.url).toBe('https://store.example.com/products/neon-suit');
  });

  it('完全な http URL のリンクを維持する', () => {
    const text = 'Get it here: http://store.example.com/products/neon-suit';
    const richText = buildParagraphRichText(text) as Array<Record<string, any>>;

    expect(richText[1].text.content).toBe('http://store.example.com/products/neon-suit');
    expect(richText[1].text.link.url).toBe('http://store.example.com/products/neon-suit');
  });
});

describe('buildProperties', () => {
  const mockPayload: XPostPayload = {
    screenName: 'Test User',
    userName: '@testuser',
    text: 'This is a test tweet with some content',
    timestamp: '2025-11-24T12:00:00.000Z',
    images: ['https://example.com/image1.jpg'],
    avatarUrl: 'https://example.com/avatar.jpg',
    url: 'https://x.com/testuser/status/123456789'
  };

  const defaultMap: AppSettings['propertyMap'] = {
    title: { propertyName: 'Name', propertyType: 'title' },
    screenName: { propertyName: 'Screen Name', propertyType: 'rich_text' },
    userName: { propertyName: 'Username', propertyType: 'rich_text' },
    tweetUrl: { propertyName: 'Tweet URL', propertyType: 'url' },
    postedAt: { propertyName: 'Posted At', propertyType: 'date' }
  };

  it('型付きマッピングで properties を構築できる', () => {
    const result = buildProperties(mockPayload, defaultMap) as Record<string, any>;

    expect(result.Name.title[0].text.content).toBe('This is a test tweet with some');
    expect(result['Screen Name'].rich_text[0].text.content).toBe('Test User');
    expect(result.Username.rich_text[0].text.content).toBe('@testuser');
    expect(result['Tweet URL'].url).toBe('https://x.com/testuser/status/123456789');
    expect(result['Posted At'].date.start).toBe('2025-11-24T12:00:00.000Z');
  });

  it('select と multi_select のマッピングに対応する', () => {
    const customMap: AppSettings['propertyMap'] = {
      ...defaultMap,
      screenName: { propertyName: 'Screen Select', propertyType: 'select' },
      userName: { propertyName: 'User Tags', propertyType: 'multi_select' }
    };

    const result = buildProperties(mockPayload, customMap) as Record<string, any>;

    expect(result['Screen Select'].select.name).toBe('Test User');
    expect(result['User Tags'].multi_select[0].name).toBe('@testuser');
  });

  it('URL型に不正値が入ると例外を投げる', () => {
    const customMap: AppSettings['propertyMap'] = {
      ...defaultMap,
      screenName: { propertyName: 'Screen URL', propertyType: 'url' }
    };

    expect(() => buildProperties(mockPayload, customMap)).toThrow('URL 型に無効な値');
  });

  it('投稿日時を ISO 形式に正規化する', () => {
    const payload = {
      ...mockPayload,
      timestamp: '2025-11-24 12:00:00+09:00'
    };

    const result = buildProperties(payload, defaultMap) as Record<string, any>;
    expect(result['Posted At'].date.start).toBe('2025-11-24T03:00:00.000Z');
  });

  it('date型に不正値が入ると例外を投げる', () => {
    const payload = {
      ...mockPayload,
      screenName: 'not-a-date-value'
    };

    const customMap: AppSettings['propertyMap'] = {
      ...defaultMap,
      screenName: { propertyName: 'Screen Date', propertyType: 'date' }
    };

    expect(() => buildProperties(payload, customMap)).toThrow('date 型に変換できない値');
  });

  it('タイトルfallbackは30文字に切り詰める', () => {
    const longText = 'a'.repeat(150);
    const payload = { ...mockPayload, text: longText };
    const result = buildProperties(payload, defaultMap) as Record<string, any>;

    expect(result.Name.title[0].text.content).toHaveLength(30);
    expect(result.Name.title[0].text.content).toBe('a'.repeat(30));
  });

  it('30文字未満で改行があればそこでタイトルfallbackを切る', () => {
    const payload = { ...mockPayload, text: 'first line\nsecond line' };
    const result = buildProperties(payload, defaultMap) as Record<string, any>;

    expect(result.Name.title[0].text.content).toBe('first line');
  });

  it('タイトルfallbackからURLとハッシュタグを除去する', () => {
    const payload = {
      ...mockPayload,
      text: 'Check this https://example.com #news $BTC update'
    };
    const result = buildProperties(payload, defaultMap) as Record<string, any>;

    expect(result.Name.title[0].text.content).toBe('Check this update');
  });

  it('旧式の文字列マッピング形式にも対応する', () => {
    const legacyMap = {
      title: 'Name',
      screenName: 'Screen Name',
      userName: 'Username',
      tweetUrl: 'Tweet URL',
      postedAt: 'Posted At'
    } as unknown as AppSettings['propertyMap'];

    const result = buildProperties(mockPayload, legacyMap) as Record<string, any>;

    expect(result.Name.title[0].text.content).toBe('This is a test tweet with some');
    expect(result['Screen Name'].rich_text[0].text.content).toBe('Test User');
    expect(result.Username.rich_text[0].text.content).toBe('@testuser');
    expect(result['Tweet URL'].url).toBe('https://x.com/testuser/status/123456789');
    expect(result['Posted At'].date.start).toBe('2025-11-24T12:00:00.000Z');
  });

  it('propertyName が不正な非文字列なら無視する', () => {
    const mixedMap = {
      title: { propertyName: { bad: 'value' }, propertyType: 'title' },
      screenName: { propertyName: 'Screen Name', propertyType: 'rich_text' },
      userName: { propertyName: 'Username', propertyType: 'rich_text' },
      tweetUrl: { propertyName: 'Tweet URL', propertyType: 'url' },
      postedAt: { propertyName: 'Posted At', propertyType: 'date' }
    } as unknown as AppSettings['propertyMap'];

    const result = buildProperties(mockPayload, mixedMap) as Record<string, any>;

    expect(result.Name).toBeUndefined();
    expect(result['Screen Name'].rich_text[0].text.content).toBe('Test User');
  });
});
