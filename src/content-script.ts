interface ExtractedPost {
  screenName: string;
  userName: string;
  text: string;
  timestamp: string;
  images: string[];
  url: string;
}

function collectFromArticle(article: Element): ExtractedPost | null {
  const namesRoot = article.querySelector('div[data-testid="User-Names"]');
  let screenName = '';
  let userName = '';

  if (namesRoot) {
    const nameSpans = Array.from(namesRoot.querySelectorAll('span'));
    for (const span of nameSpans) {
      const value = span.textContent?.trim();
      if (!value) {
        continue;
      }
      if (value.startsWith('@') && !userName) {
        userName = value;
      } else if (!screenName) {
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

  const imageElements = Array.from(
    article.querySelectorAll<HTMLImageElement>('div[data-testid="tweetPhoto"] img')
  );
  const images = imageElements
    .map((img) => img.currentSrc || img.src)
    .filter((src): src is string => typeof src === 'string' && src.length > 0);

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
      const canonicalUrl =
        document.querySelector('link[rel="canonical"]')?.getAttribute('href') ??
        window.location.href;
      try {
        const url = new URL(canonicalUrl);
        const [handle] = url.pathname.split('/').filter(Boolean);
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
