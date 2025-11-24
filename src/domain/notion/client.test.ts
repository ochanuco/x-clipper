import { describe, it, expect, vi, beforeEach } from 'vitest';
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

    const mockPropertyMap: AppSettings['propertyMap'] = {
        title: 'Title',
        screenName: 'Screen Name',
        userName: 'User Name',
        tweetUrl: 'Tweet URL',
        postedAt: 'Posted At'
    };

    it('should build properties with all fields', () => {
        const result = buildProperties(mockPayload, mockPropertyMap);

        expect(result).toHaveProperty('Title');
        expect(result).toHaveProperty('Screen Name');
        expect(result).toHaveProperty('User Name');
        expect(result).toHaveProperty('Tweet URL');
        expect(result).toHaveProperty('Posted At');
    });

    it('should create title from text content', () => {
        const result = buildProperties(mockPayload, mockPropertyMap);
        const title = result['Title'] as any;

        expect(title.title[0].text.content).toBe('This is a test tweet with some content');
    });

    it('should truncate long titles', () => {
        const longText = 'a'.repeat(150);
        const payload = { ...mockPayload, text: longText };
        const result = buildProperties(payload, mockPropertyMap);
        const title = result['Title'] as any;

        expect(title.title[0].text.content.length).toBeLessThanOrEqual(123); // 120 + '...'
        expect(title.title[0].text.content).toContain('...');
    });

    it('should handle empty text with fallback', () => {
        const payload = { ...mockPayload, text: '' };
        const result = buildProperties(payload, mockPropertyMap);
        const title = result['Title'] as any;

        expect(title.title[0].text.content).toBe('Image');
    });

    it('should set date property correctly', () => {
        const result = buildProperties(mockPayload, mockPropertyMap);
        const date = result['Posted At'] as any;

        expect(date.date.start).toBe('2025-11-24T12:00:00.000Z');
    });

    it('should set URL property correctly', () => {
        const result = buildProperties(mockPayload, mockPropertyMap);
        const url = result['Tweet URL'] as any;

        expect(url.url).toBe('https://x.com/testuser/status/123456789');
    });
});
