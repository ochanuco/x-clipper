export async function expandTcoUrlsInText(text: string): Promise<string> {
  if (!text) return text;
  const matches = Array.from(new Set(text.match(/https?:\/\/t\.co\/[A-Za-z0-9]+/g) ?? []));
  if (matches.length === 0) return text;

  const resolvedMap = new Map<string, string>();
  await Promise.all(
    matches.map(async (shortUrl) => {
      try {
        const resolved = await resolveRedirectLocation(shortUrl);
        resolvedMap.set(shortUrl, resolved);
      } catch {
        resolvedMap.set(shortUrl, shortUrl);
      }
    })
  );

  let normalized = text;
  for (const [shortUrl, finalUrl] of resolvedMap.entries()) {
    normalized = normalized.split(shortUrl).join(finalUrl);
  }
  return normalized;
}

export async function resolveRedirectLocation(shortUrl: string): Promise<string> {
  const followedUrl = await resolveByFollow(shortUrl);
  if (followedUrl !== shortUrl && !isTcoUrl(followedUrl)) {
    return followedUrl;
  }

  let currentUrl = shortUrl;
  const maxHops = 5;

  for (let i = 0; i < maxHops; i += 1) {
    const response = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit'
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return currentUrl;
      const nextUrl = new URL(location, currentUrl).toString();
      if (!isTcoUrl(nextUrl)) {
        return nextUrl;
      }
      currentUrl = nextUrl;
      continue;
    }

    if (response.type === 'opaqueredirect') {
      return followedUrl;
    }

    return response.url || currentUrl;
  }

  return currentUrl;
}

async function resolveByFollow(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit'
    });
    return response.url || url;
  } catch {
    return url;
  }
}

function isTcoUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 't.co';
  } catch {
    return false;
  }
}
