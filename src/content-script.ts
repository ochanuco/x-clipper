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

function normalizeImageUrl(url: string) {
  if (!url) {
    return '';
  }
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  if (url.startsWith('/')) {
    return `https://x.com${url}`;
  }
  return url;
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

  const primaryMedia = Array.from(
    article.querySelectorAll<HTMLImageElement>('div[data-testid="tweetPhoto"] img')
  );

  const fallbackMedia = Array.from(
    article.querySelectorAll<HTMLImageElement>('img')
  ).filter((img) => {
    const testId = img.closest('[data-testid]')?.getAttribute('data-testid')?.toLowerCase() ?? '';
    if (testId.includes('tweetphoto') || testId.includes('mediaimage') || testId.includes('previewimage')) {
      return true;
    }
    return false;
  });

  const imageSet = new Set<HTMLImageElement>([...primaryMedia, ...fallbackMedia]);
  if (avatarElement) {
    imageSet.delete(avatarElement);
  }

  const images = Array.from(imageSet)
    .map((img) => normalizeImageUrl(bestImageUrl(img)))
    .filter((src): src is string => typeof src === 'string' && src.length > 0);

  if (images.length > MAX_IMAGES) {
    images.length = MAX_IMAGES;
  }

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
