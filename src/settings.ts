import type { NotionPropertyMap, NotionSettings } from './types.js';

export const STORAGE_KEY = 'notionSettings';

const DEFAULT_PROPERTY_MAP: NotionPropertyMap = {
  title: 'Name',
  screenName: 'Screen Name',
  userName: 'Username',
  tweetUrl: 'Tweet URL',
  postedAt: 'Posted At'
};

const DEFAULT_SETTINGS: NotionSettings = {
  notionApiKey: '',
  notionDatabaseUrl: '',
  notionDatabaseId: '',
  propertyMap: DEFAULT_PROPERTY_MAP
};

export async function getSettings(): Promise<NotionSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const stored = (result[STORAGE_KEY] ?? {}) as Partial<NotionSettings>;
      const propertyMap = {
        ...DEFAULT_PROPERTY_MAP,
        ...(stored.propertyMap ?? {})
      };

      resolve({
        ...DEFAULT_SETTINGS,
        ...stored,
        propertyMap
      });
    });
  });
}

export async function saveSettings(settings: NotionSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: settings }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

export function parseDatabaseIdFromUrl(url: string): string | null {
  if (!url) {
    return null;
  }

  const trimmed = url.trim();

  const hyphenated = trimmed.match(
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i
  );
  const compact = trimmed.match(/[a-f0-9]{32}/i);

  const raw = (hyphenated ?? compact)?.[0];
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/-/g, '').toLowerCase();
  return normalized.length === 32 ? normalized : null;
}
