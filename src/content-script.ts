interface ExtractedPost {
  screenName: string;
  userName: string;
  text: string;
  timestamp: string;
  images: string[];
  avatarUrl: string | null;
  url: string;
}

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

function normalizeImageUrl(original: string) {
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

function collectFromArticle(article: Element): ExtractedPost | null {
  const namesRoot = article.querySelector(
    '[data-testid="User-Names"], [data-testid="User-Name"]'
  );
  let screenName = '';
  let userName = '';

  if (namesRoot) {
    const nameCandidates = Array.from(
      namesRoot.querySelectorAll<HTMLElement>('span, div[dir="auto"], div[dir="ltr"]')
    );
    for (const element of nameCandidates) {
      const value = element.textContent?.trim();
      if (!value) {
        continue;
      }

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
      if (!isProfileLink && !value.startsWith('@')) {
        continue;
      }

      if (value.startsWith('@') && !userName) {
        userName = value;
      } else if (!screenName && !value.includes('@')) {
        screenName = value;
      }
      if (screenName && userName) {
        break;
      }
    }
  }

  const textNodes = Array.from(
    article.querySelectorAll('div[data-testid="tweetText"] span')
  );
  const text = textNodes.map((node) => node.textContent ?? '').join('').trim();

  const timeElement = article.querySelector('time');
  const timestamp = timeElement?.getAttribute('datetime') ?? '';

  const avatarElement =
    (article.querySelector('[data-testid="Tweet-User-Avatar"] img') as HTMLImageElement | null) ??
    (document.querySelector('[data-testid="Tweet-User-Avatar"] img') as HTMLImageElement | null);
  const avatarUrl = avatarElement ? normalizeImageUrl(bestImageUrl(avatarElement)) : null;

  const images = collectMediaUrls(article, avatarUrl);

  if (!screenName || !userName) {
    const titleContent =
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content') ?? '';
    const titleMatch = titleContent.match(/^(.*?)\s+\((@[^\s)]+)\)/);

    if (!screenName && titleMatch?.[1]) {
      const candidate = titleMatch[1].trim();
      if (candidate && candidate !== text) {
        screenName = candidate;
      }
    }
    if (!userName && titleMatch?.[2]) {
      userName = titleMatch[2].trim();
    }

    if (!userName) {
      const creatorMeta =
        document
          .querySelector('meta[name="twitter:creator"]')
          ?.getAttribute('content') ?? '';
      if (creatorMeta.startsWith('@')) {
        userName = creatorMeta.trim();
      }
    }

    if (!userName) {
      const canonicalUrl =
        document.querySelector('link[rel="canonical"]')?.getAttribute('href') ??
        window.location.href;
      try {
        const url = new URL(canonicalUrl);
        const handle = url.pathname
          .split('/')
          .filter(Boolean)
          .find((segment) => !['i', 'web', 'status'].includes(segment.toLowerCase()));
        if (handle) {
          userName = handle.startsWith('@') ? handle : `@${handle}`;
        }
      } catch {
        // noop
      }
    }

    if (!screenName && userName) {
      screenName = userName.replace(/^@/, '');
    }
  }

  if (!screenName && !userName && !text) {
    return null;
  }

  return {
    screenName,
    userName,
    text,
    timestamp,
    images,
    avatarUrl,
    url: window.location.href
  };
}

function extractPost(): ExtractedPost | null {
  const article =
    document.querySelector('article[data-testid="tweet"]') ??
    document.querySelector('article[data-testid="tweetDetail"]');
  if (!article) {
    return null;
  }
  return collectFromArticle(article);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_X_POST') {
    return undefined;
  }

  try {
    const data = extractPost();
    if (!data) {
      sendResponse({
        success: false,
        error: '投稿を検出できませんでした。詳細ページを開いているか確認してください。'
      });
      return true;
    }
    sendResponse({ success: true, data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '不明なエラーが発生しました。';
    sendResponse({ success: false, error: message });
  }

  return true;
});
