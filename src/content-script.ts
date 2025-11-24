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

function collectFromArticle(article: Element): ExtractedPost | null {
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
    const nodes = Array.from(a.querySelectorAll('div[data-testid="tweetText"] span'));
    return nodes.map((n) => n.textContent ?? '').join('').trim();
  }
  const text = getTextFromArticle(article);

  const timeElement = article.querySelector('time');
  const timestamp = timeElement?.getAttribute('datetime') ?? '';

  const avatarElement = (article.querySelector('[data-testid="Tweet-User-Avatar"] img') as HTMLImageElement | null) ?? (document.querySelector('[data-testid="Tweet-User-Avatar"] img') as HTMLImageElement | null);
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

// --- Timeline save button injection --------------------------------------
function createSaveButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'x-clipper-save-button';
  btn.setAttribute('aria-label', '保存');
  // Icon-style circular button (compact)
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" stroke="#111827" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="#fff" />
    </svg>
  `;
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.width = '30px';
  btn.style.height = '30px';
  btn.style.padding = '0';
  // place flush to the left of the overflow icon: add right margin instead
  btn.style.marginLeft = '0';
  btn.style.marginRight = '6px';
  btn.style.borderRadius = '999px';
  btn.style.border = '1px solid rgba(0,0,0,0.08)';
  btn.style.background = 'white';
  btn.style.cursor = 'pointer';
  btn.style.boxShadow = '0 1px 0 rgba(0,0,0,0.03)';
  return btn;
}

// Small inline SVGs for success / failure states
const SUCCESS_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#10b981" />
    <path d="M7 12.5l2.5 2.5L17 8" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

const FAILURE_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#ef4444" />
    <path d="M15 9L9 15M9 9l6 6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

function insertSaveButton(article: Element) {
  console.debug('x-clipper: insertSaveButton called for article', article);
  // avoid duplicating
  if (article.querySelector('.x-clipper-save-button')) return;

  const actionArea =
    article.querySelector('[role="group"]') ??
    article.querySelector('[data-testid="tweetAction"]') ??
    article.querySelector('div[aria-label]');

  // Inject styles for rotation if not already present
  if (!document.getElementById('x-clipper-styles')) {
    const style = document.createElement('style');
    style.id = 'x-clipper-styles';
    style.textContent = `
      @keyframes x-clipper-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .x-clipper-spin {
        animation: x-clipper-spin 1s linear infinite;
      }
    `;
    document.head.appendChild(style);
  }

  const btn = createSaveButton();
  console.debug('x-clipper: created button element');

  const LOADING_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="x-clipper-spin">
      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke-opacity="0.2" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 2C6.47715 2 2 6.47715 2 12" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  const originalInnerHTML = btn.innerHTML;
  btn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    btn.disabled = true;
    const originalOpacity = btn.style.opacity;
    btn.style.opacity = '0.8'; // Slightly dim but keep visible
    btn.innerHTML = LOADING_SVG;

    try {
      const payload = collectFromArticle(article);
      if (!payload) {
        // show failure icon
        btn.innerHTML = FAILURE_SVG;
        btn.disabled = false; // Allow retry
        btn.style.opacity = originalOpacity;
        return;
      }

      chrome.runtime.sendMessage({ type: 'CLIP_X_POST', data: payload }, (resp) => {
        if (chrome.runtime.lastError) console.warn('sendMessage error', chrome.runtime.lastError.message);
        if (resp && resp.success) {
          btn.innerHTML = SUCCESS_SVG;
          btn.disabled = true; // Prevent duplicate saves
          btn.style.opacity = '1'; // Full opacity for success
        } else {
          btn.innerHTML = FAILURE_SVG;
          console.warn('clip failed', resp);
          btn.disabled = false; // Allow retry
          btn.style.opacity = originalOpacity;
        }
      });
    } catch (err) {
      console.warn('clip button error', err);
      btn.innerHTML = FAILURE_SVG;
      btn.disabled = false; // Allow retry
      btn.style.opacity = originalOpacity;
    }
  });

  console.debug('x-clipper: attempting placement');
  // Strategy: find the rightmost interactive element (likely the ellipsis), then
  // insert before its previous interactive sibling if present.
  let placed = false;
  try {
    const candidates = Array.from(article.querySelectorAll('button, [role="button"], a')) as Element[];
    if (candidates.length > 0) {
      // Measure rightmost position
      let rightmost: Element | null = null;
      let maxRight = -Infinity;
      for (const el of candidates) {
        try {
          const rect = el.getBoundingClientRect();
          if (rect && rect.right > maxRight) {
            maxRight = rect.right;
            rightmost = el;
          }
        } catch {
          // ignore
        }
      }

      if (rightmost && rightmost.parentElement) {
        // find previous interactive sibling (skip text nodes)
        let sibling: Element | null = rightmost.previousElementSibling;
        while (sibling && !/^(BUTTON|A)$/.test(sibling.tagName) && sibling.getAttribute('role') !== 'button') {
          sibling = sibling.previousElementSibling as Element | null;
        }

        const insertBeforeEl = sibling ?? rightmost;
        if (insertBeforeEl.parentElement) {
          insertBeforeEl.parentElement.insertBefore(btn, insertBeforeEl);
          placed = true;
        }
      }
    }
  } catch (err) {
    console.warn('placement by bounding box failed', err);
  }

  if (!placed) {
    console.debug('x-clipper: fallback placement used');
    if (actionArea) {
      actionArea.appendChild(btn);
    } else {
      const header = article.querySelector('[data-testid="User-Names"], [data-testid="User-Name"]');
      if (header) header.appendChild(btn);
      else article.appendChild(btn);
    }
  } else {
    console.debug('x-clipper: placed button successfully');
  }
}

function scanAndInsertButtons(root: ParentNode = document) {
  const selector = 'article[data-testid="tweet"] , article[data-testid="tweetDetail"]';
  const articles = Array.from(root.querySelectorAll(selector));
  console.debug('x-clipper: scanAndInsertButtons found', articles.length, 'articles');
  articles.forEach((article) => insertSaveButton(article));
}

// Initial pass
scanAndInsertButtons();

// Observe for new tweets loaded dynamically
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (!m.addedNodes) continue;
    m.addedNodes.forEach((node) => {
      console.debug('x-clipper: mutation added node', node);
      if (!(node instanceof Element)) return;
      if (node.matches && (node.matches('article[data-testid="tweet"]') || node.matches('article[data-testid="tweetDetail"]'))) {
        console.debug('x-clipper: mutation node is article, inserting');
        insertSaveButton(node as Element);
      } else {
        // in case articles are nested inside added nodes
        scanAndInsertButtons(node);
      }
    });
  }
});

observer.observe(document.body, { childList: true, subtree: true });

