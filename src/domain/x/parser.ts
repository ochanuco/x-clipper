import type { XPostPayload } from './types.js';

const MAX_IMAGES = 4;

function bestImageUrl(img: HTMLImageElement) {
    const srcset = img.getAttribute('srcset');
    if (srcset) {
        const sources = srcset
            .split(',')
            .map((item) => item.trim().split(' '))
            .map(([url, size]) => ({
                url,
                size: size ? parseInt(size.replace(/\D/g, ''), 10) : 0
            }))
            .filter((entry) => Boolean(entry.url));
        sources.sort((a, b) => b.size - a.size);
        if (sources[0]?.url) {
            return sources[0].url;
        }
    }
    return img.currentSrc || img.src;
}

export function normalizeImageUrl(original: string) {
    if (!original) {
        return '';
    }

    let url = original.trim();

    if (url.startsWith('blob:')) {
        return '';
    }

    if (url.startsWith('//')) {
        url = `https:${url}`;
    }
    if (url.startsWith('/')) {
        url = `https://x.com${url}`;
    }

    try {
        const parsed = new URL(url);
        if (parsed.hostname === 'pbs.twimg.com') {
            const nameParam = parsed.searchParams.get('name');
            if (nameParam && nameParam !== 'orig') {
                parsed.searchParams.set('name', 'orig');
            }
            return parsed.toString();
        }
    } catch {
        // ignore parse errors
    }

    return url;
}

function isLikelyAvatarUrl(url: string) {
    const lower = url.toLowerCase();
    return lower.includes('profile_images') || lower.includes('default_profile');
}

function isTwitterPlaceholder(url: string) {
    const lower = url.toLowerCase();
    return (
        lower.startsWith('https://abs.twimg.com') &&
        (lower.includes('/og/') || lower.includes('/card/') || lower.endsWith('/image.png'))
    );
}

function findOwningArticle(node: Element | null) {
    return node?.closest('article[data-testid="tweet"], article[data-testid="tweetDetail"]');
}

function pushUrl(
    urls: Set<string>,
    avatarUrl: string | null,
    raw: string | null | undefined
) {
    if (!raw) {
        return;
    }
    const normalized = normalizeImageUrl(raw);
    if (!normalized) {
        return;
    }
    if (avatarUrl && normalized === avatarUrl) {
        return;
    }
    if (isLikelyAvatarUrl(normalized)) {
        return;
    }
    if (isTwitterPlaceholder(normalized)) {
        return;
    }
    urls.add(normalized);
}

function collectMediaUrls(article: Element, avatarUrl: string | null) {
    const urls = new Set<string>();

    const imageSelectors = [
        '[data-testid="tweetPhoto"] img',
        '[data-testid="previewImage"] img',
        '[data-testid="card.previewImage"] img'
    ];

    for (const selector of imageSelectors) {
        article.querySelectorAll<HTMLImageElement>(selector).forEach((img) => {
            const owner = findOwningArticle(img);
            if (owner && owner !== article) {
                return;
            }
            const candidate = bestImageUrl(img);
            pushUrl(urls, avatarUrl, candidate);
        });
    }

    const videoSelectors = [
        '[data-testid="videoPlayer"] video',
        '[data-testid="videoPlayer"] source',
        'video[data-testid="tweetGifPlayerVideo"]'
    ];

    for (const selector of videoSelectors) {
        article
            .querySelectorAll<HTMLVideoElement | HTMLSourceElement>(selector)
            .forEach((node) => {
                const owner = findOwningArticle(node);
                if (owner && owner !== article) {
                    return;
                }
                if (node instanceof HTMLVideoElement) {
                    pushUrl(urls, avatarUrl, node.poster);
                    node.querySelectorAll('source').forEach((source) =>
                        pushUrl(urls, avatarUrl, source.src)
                    );
                } else if (node instanceof HTMLSourceElement) {
                    pushUrl(urls, avatarUrl, node.src);
                }
            });
    }

    return Array.from(urls).slice(0, MAX_IMAGES);
}

export function collectFromArticle(article: Element): XPostPayload | null {
    const hasTweetContent = Boolean(
        article.querySelector(
            '[data-testid="User-Names"], [data-testid="User-Name"], div[data-testid="tweetText"], time, [data-testid="tweetPhoto"], [data-testid="previewImage"], [data-testid="card.previewImage"], [data-testid="videoPlayer"], video[data-testid="tweetGifPlayerVideo"]'
        )
    );
    if (!hasTweetContent) return null;

    let screenName = '';
    let userName = '';
    const namesRoot = article.querySelector('[data-testid="User-Names"], [data-testid="User-Name"]');
    function getNamesFromRoot(root: Element | null) {
        if (!root) return;
        const candidates = Array.from(root.querySelectorAll<HTMLElement>('span, div[dir="auto"], div[dir="ltr"]'));
        for (const element of candidates) {
            const value = element.textContent?.trim();
            if (!value) continue;
            const anchor = element.closest('a[href]');
            let profilePath = '';
            if (anchor) {
                try {
                    const href = anchor.getAttribute('href') ?? '';
                    const url = href.startsWith('http')
                        ? new URL(href)
                        : new URL(href, 'https://x.com');
                    profilePath = url.pathname;
                } catch {
                    profilePath = '';
                }
            }
            const isProfileLink = /^\/[A-Za-z0-9_]+\/?$/.test(profilePath);
            if (!isProfileLink && !value.startsWith('@')) continue;
            if (value.startsWith('@') && !userName) userName = value;
            else if (!screenName && !value.includes('@')) screenName = value;
            if (screenName && userName) return;
        }
    }
    getNamesFromRoot(namesRoot);

    function getTextFromArticle(a: Element) {
        const root = a.querySelector('div[data-testid="tweetText"]');
        if (!root) {
            return '';
        }
        const parts: string[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let node = walker.nextNode();
        while (node) {
            if (node.nodeType === Node.TEXT_NODE) {
                parts.push(node.textContent ?? '');
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                if (element.tagName === 'IMG') {
                    const alt = element.getAttribute('alt');
                    if (alt) {
                        parts.push(alt);
                    }
                } else if (element.tagName === 'BR') {
                    parts.push('\n');
                }
            }
            node = walker.nextNode();
        }
        return parts.join('').replace(/\s+/g, ' ').trim();
    }
    const text = getTextFromArticle(article);

    const timeElement = article.querySelector('time');
    const timestamp = timeElement?.getAttribute('datetime') ?? '';

    const avatarElement = article.querySelector('[data-testid="Tweet-User-Avatar"] img') as HTMLImageElement | null;
    const avatarUrl = avatarElement ? normalizeImageUrl(bestImageUrl(avatarElement)) : null;

    const images = collectMediaUrls(article, avatarUrl);
    // fill missing names from document metadata if possible
    if (!screenName || !userName) {
        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '';
        const titleMatch = ogTitle.match(/^(.*?)\s+\((@[^\s)]+)\)/);
        if (!screenName && titleMatch?.[1]) {
            const candidate = titleMatch[1].trim();
            if (candidate && candidate !== text) screenName = candidate;
        }
        if (!userName && titleMatch?.[2]) userName = titleMatch[2].trim();

        if (!userName) {
            const creatorMeta = document.querySelector('meta[name="twitter:creator"]')?.getAttribute('content') ?? '';
            if (creatorMeta.startsWith('@')) userName = creatorMeta.trim();
        }

        if (!userName) {
            const canonicalUrl = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? window.location.href;
            try {
                const url = new URL(canonicalUrl);
                const handle = url.pathname.split('/').filter(Boolean).find((segment) => !['i', 'web', 'status'].includes(segment.toLowerCase()));
                if (handle) userName = handle.startsWith('@') ? handle : `@${handle}`;
            } catch {
                // noop
            }
        }

        if (!screenName && userName) screenName = userName.replace(/^@/, '');
    }

    // Resolve a unique post URL from the timestamp anchor, canonical, or window
    let postUrl = '';
    try {
        const timeAnchor = timeElement?.closest('a[href]') as HTMLAnchorElement | null;
        if (timeAnchor) {
            const raw = timeAnchor.getAttribute('href') ?? timeAnchor.href ?? '';
            try {
                postUrl = new URL(raw, window.location.origin).toString();
            } catch {
                postUrl = raw || window.location.href;
            }
        } else {
            postUrl = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? window.location.href;
        }
    } catch {
        postUrl = window.location.href;
    }

    console.debug('x-clipper: extracted postUrl', postUrl);

    return {
        screenName,
        userName,
        text,
        timestamp,
        images,
        avatarUrl,
        url: postUrl
    };
}

export function extractPost(): XPostPayload | null {
    const article =
        document.querySelector('article[data-testid="tweet"]') ??
        document.querySelector('article[data-testid="tweetDetail"]');
    if (!article) {
        return null;
    }
    return collectFromArticle(article);
}
