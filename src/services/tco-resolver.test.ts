import { describe, expect, it, vi } from 'vitest';
import { expandTcoUrlsInText, resolveRedirectLocation } from './tco-resolver.js';

describe('tco-resolver', () => {
  it('follow で最終URLが取れる場合はそれを優先する', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        url: 'https://example.com/articles/123',
        status: 200
      });

    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveRedirectLocation('https://t.co/abc123');

    expect(resolved).toBe('https://example.com/articles/123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://t.co/abc123',
      expect.objectContaining({ redirect: 'follow' })
    );
  });

  it('follow で解決できない場合は manual redirect にフォールバックする', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        url: 'https://t.co/abc123',
        status: 200
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: {
          get: vi.fn().mockReturnValue('https://example.com/final')
        },
        type: 'basic',
        url: 'https://t.co/abc123'
      });

    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveRedirectLocation('https://t.co/abc123');

    expect(resolved).toBe('https://example.com/final');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('本文中の複数の t.co URL をまとめて置換する', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        url: 'https://example.com/one',
        status: 200
      })
      .mockResolvedValueOnce({
        url: 'https://example.com/two',
        status: 200
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await expandTcoUrlsInText(
      'テスト https://t.co/abc123 https://t.co/def456'
    );

    expect(result).toBe('テスト https://example.com/one https://example.com/two');
  });
});
