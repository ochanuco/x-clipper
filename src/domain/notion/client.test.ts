import { describe, it, expect } from 'vitest';
import { buildParagraphRichText, buildProperties } from './client.js';
import type { XPostPayload } from '../x/types.js';
import type { AppSettings } from '../../types.js';
import type { NotionRichTextItem } from './client.js';

type NotionTitleProperty = {
  title: Array<{ text: { content: string } }>;
};

type NotionRichTextProperty = {
  rich_text: Array<{ text: { content: string } }>;
};

type NotionSelectProperty = {
  select: { name: string };
};

type NotionMultiSelectProperty = {
  multi_select: Array<{ name: string }>;
};

type NotionUrlProperty = {
  url: string;
};

type NotionDateProperty = {
  date: { start: string };
};

type NotionPropertiesResult = Record<
  string,
  | NotionTitleProperty
  | NotionRichTextProperty
  | NotionSelectProperty
  | NotionMultiSelectProperty
  | NotionUrlProperty
  | NotionDateProperty
>;

function getRichTextItem(items: NotionRichTextItem[], index: number): NotionRichTextItem {
  const item = items[index];
  if (!item) {
    throw new Error(`rich text item not found at index ${index}`);
  }
  return item;
}

function asPropertiesResult(value: ReturnType<typeof buildProperties>): NotionPropertiesResult {
  return value as NotionPropertiesResult;
}

function getTitleProperty(result: NotionPropertiesResult, key: string): NotionTitleProperty {
  const property = result[key];
  if (!property || !('title' in property)) {
    throw new Error(`title property not found: ${key}`);
  }
  return property;
}

function getRichTextProperty(result: NotionPropertiesResult, key: string): NotionRichTextProperty {
  const property = result[key];
  if (!property || !('rich_text' in property)) {
    throw new Error(`rich_text property not found: ${key}`);
  }
  return property;
}

function getSelectProperty(result: NotionPropertiesResult, key: string): NotionSelectProperty {
  const property = result[key];
  if (!property || !('select' in property)) {
    throw new Error(`select property not found: ${key}`);
  }
  return property;
}

function getMultiSelectProperty(result: NotionPropertiesResult, key: string): NotionMultiSelectProperty {
  const property = result[key];
  if (!property || !('multi_select' in property)) {
    throw new Error(`multi_select property not found: ${key}`);
  }
  return property;
}

function getUrlProperty(result: NotionPropertiesResult, key: string): NotionUrlProperty {
  const property = result[key];
  if (!property || !('url' in property)) {
    throw new Error(`url property not found: ${key}`);
  }
  return property;
}

function getDateProperty(result: NotionPropertiesResult, key: string): NotionDateProperty {
  const property = result[key];
  if (!property || !('date' in property)) {
    throw new Error(`date property not found: ${key}`);
  }
  return property;
}

describe('buildParagraphRichText', () => {
  it('http リンクに表示文字列を保ったままハイパーリンクを付与する', () => {
    const text = 'https://gallery.example.net/posts/12345678… https://portal.example.jp/item.php?item_id=2301… テストテキスト';
    const richText = buildParagraphRichText(text);

    expect(getRichTextItem(richText, 0).text.content).toBe('https://gallery.example.net/posts/12345678…');
    expect(getRichTextItem(richText, 0).text.link?.url).toBe('https://gallery.example.net/posts/12345678');
    expect(getRichTextItem(richText, 1).text.content).toBe(' ');
    expect(getRichTextItem(richText, 2).text.content).toBe('https://portal.example.jp/item.php?item_id=2301…');
    expect(getRichTextItem(richText, 2).text.link?.url).toBe('https://portal.example.jp/item.php?item_id=2301');
    expect(getRichTextItem(richText, 3).text.content).toBe(' テストテキスト');
  });

  it('スキームなしドメインにもハイパーリンクを付与する', () => {
    const text = 'Get it here: store.example.com/products/neon-suit';
    const richText = buildParagraphRichText(text);

    expect(getRichTextItem(richText, 1).text.content).toBe('store.example.com/products/neon-suit');
    expect(getRichTextItem(richText, 1).text.link?.url).toBe('https://store.example.com/products/neon-suit');
  });

  it('完全な http URL のリンクを維持する', () => {
    const text = 'Get it here: http://store.example.com/products/neon-suit';
    const richText = buildParagraphRichText(text);

    expect(getRichTextItem(richText, 1).text.content).toBe('http://store.example.com/products/neon-suit');
    expect(getRichTextItem(richText, 1).text.link?.url).toBe('http://store.example.com/products/neon-suit');
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
    const result = asPropertiesResult(buildProperties(mockPayload, defaultMap));

    expect(getTitleProperty(result, 'Name').title[0]?.text.content).toBe('This is a test tweet with some');
    expect(getRichTextProperty(result, 'Screen Name').rich_text[0]?.text.content).toBe('Test User');
    expect(getRichTextProperty(result, 'Username').rich_text[0]?.text.content).toBe('@testuser');
    expect(getUrlProperty(result, 'Tweet URL').url).toBe('https://x.com/testuser/status/123456789');
    expect(getDateProperty(result, 'Posted At').date.start).toBe('2025-11-24T12:00:00.000Z');
  });

  it('select と multi_select のマッピングに対応する', () => {
    const customMap: AppSettings['propertyMap'] = {
      ...defaultMap,
      screenName: { propertyName: 'Screen Select', propertyType: 'select' },
      userName: { propertyName: 'User Tags', propertyType: 'multi_select' }
    };

    const result = asPropertiesResult(buildProperties(mockPayload, customMap));

    expect(getSelectProperty(result, 'Screen Select').select.name).toBe('Test User');
    expect(getMultiSelectProperty(result, 'User Tags').multi_select[0]?.name).toBe('@testuser');
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

    const result = asPropertiesResult(buildProperties(payload, defaultMap));
    expect(getDateProperty(result, 'Posted At').date.start).toBe('2025-11-24T03:00:00.000Z');
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
    const result = asPropertiesResult(buildProperties(payload, defaultMap));

    expect(getTitleProperty(result, 'Name').title[0]?.text.content).toHaveLength(30);
    expect(getTitleProperty(result, 'Name').title[0]?.text.content).toBe('a'.repeat(30));
  });

  it('30文字未満で改行があればそこでタイトルfallbackを切る', () => {
    const payload = { ...mockPayload, text: 'first line\nsecond line' };
    const result = asPropertiesResult(buildProperties(payload, defaultMap));

    expect(getTitleProperty(result, 'Name').title[0]?.text.content).toBe('first line');
  });

  it('タイトルfallbackからURLとハッシュタグを除去する', () => {
    const payload = {
      ...mockPayload,
      text: 'Check this https://example.com #news $BTC update'
    };
    const result = asPropertiesResult(buildProperties(payload, defaultMap));

    expect(getTitleProperty(result, 'Name').title[0]?.text.content).toBe('Check this update');
  });

  it('旧式の文字列マッピング形式にも対応する', () => {
    const legacyMap = {
      title: 'Name',
      screenName: 'Screen Name',
      userName: 'Username',
      tweetUrl: 'Tweet URL',
      postedAt: 'Posted At'
    } as unknown as AppSettings['propertyMap'];

    const result = asPropertiesResult(buildProperties(mockPayload, legacyMap));

    expect(getTitleProperty(result, 'Name').title[0]?.text.content).toBe('This is a test tweet with some');
    expect(getRichTextProperty(result, 'Screen Name').rich_text[0]?.text.content).toBe('Test User');
    expect(getRichTextProperty(result, 'Username').rich_text[0]?.text.content).toBe('@testuser');
    expect(getUrlProperty(result, 'Tweet URL').url).toBe('https://x.com/testuser/status/123456789');
    expect(getDateProperty(result, 'Posted At').date.start).toBe('2025-11-24T12:00:00.000Z');
  });

  it('propertyName が不正な非文字列なら無視する', () => {
    const mixedMap = {
      title: { propertyName: { bad: 'value' }, propertyType: 'title' },
      screenName: { propertyName: 'Screen Name', propertyType: 'rich_text' },
      userName: { propertyName: 'Username', propertyType: 'rich_text' },
      tweetUrl: { propertyName: 'Tweet URL', propertyType: 'url' },
      postedAt: { propertyName: 'Posted At', propertyType: 'date' }
    } as unknown as AppSettings['propertyMap'];

    const result = asPropertiesResult(buildProperties(mockPayload, mixedMap));

    expect(result.Name).toBeUndefined();
    expect(getRichTextProperty(result, 'Screen Name').rich_text[0]?.text.content).toBe('Test User');
  });
});
