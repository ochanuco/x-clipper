import { describe, it, expect } from 'vitest';
import { buildProperties } from './client.js';
import type { XPostPayload } from '../x/types.js';
import type { AppSettings } from '../../types.js';

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

  it('builds properties with typed mapping', () => {
    const result = buildProperties(mockPayload, defaultMap) as Record<string, any>;

    expect(result.Name.title[0].text.content).toBe('This is a test tweet with some content');
    expect(result['Screen Name'].rich_text[0].text.content).toBe('Test User');
    expect(result.Username.rich_text[0].text.content).toBe('@testuser');
    expect(result['Tweet URL'].url).toBe('https://x.com/testuser/status/123456789');
    expect(result['Posted At'].date.start).toBe('2025-11-24T12:00:00.000Z');
  });

  it('supports select and multi_select mapping', () => {
    const customMap: AppSettings['propertyMap'] = {
      ...defaultMap,
      screenName: { propertyName: 'Screen Select', propertyType: 'select' },
      userName: { propertyName: 'User Tags', propertyType: 'multi_select' }
    };

    const result = buildProperties(mockPayload, customMap) as Record<string, any>;

    expect(result['Screen Select'].select.name).toBe('Test User');
    expect(result['User Tags'].multi_select[0].name).toBe('@testuser');
  });

  it('throws for invalid url mapping value', () => {
    const customMap: AppSettings['propertyMap'] = {
      ...defaultMap,
      screenName: { propertyName: 'Screen URL', propertyType: 'url' }
    };

    expect(() => buildProperties(mockPayload, customMap)).toThrow('URL 型に無効な値');
  });

  it('throws for invalid date mapping value', () => {
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

  it('truncates title fallback to 120 chars plus ellipsis', () => {
    const longText = 'a'.repeat(150);
    const payload = { ...mockPayload, text: longText };
    const result = buildProperties(payload, defaultMap) as Record<string, any>;

    expect(result.Name.title[0].text.content.length).toBeLessThanOrEqual(123);
    expect(result.Name.title[0].text.content).toContain('...');
  });

  it('supports legacy string-based mapping shape', () => {
    const legacyMap = {
      title: 'Name',
      screenName: 'Screen Name',
      userName: 'Username',
      tweetUrl: 'Tweet URL',
      postedAt: 'Posted At'
    } as unknown as AppSettings['propertyMap'];

    const result = buildProperties(mockPayload, legacyMap) as Record<string, any>;

    expect(result.Name.title[0].text.content).toBe('This is a test tweet with some content');
    expect(result['Screen Name'].rich_text[0].text.content).toBe('Test User');
    expect(result.Username.rich_text[0].text.content).toBe('@testuser');
    expect(result['Tweet URL'].url).toBe('https://x.com/testuser/status/123456789');
    expect(result['Posted At'].date.start).toBe('2025-11-24T12:00:00.000Z');
  });

  it('ignores invalid non-string propertyName values', () => {
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
