import type { AppSettings, NotionPropertyMap } from './types.js';

export const STORAGE_KEY = 'notionSettings';

const DEFAULT_PROPERTY_MAP: NotionPropertyMap = {
  title: 'Name',
  screenName: 'Screen Name',
  userName: 'Username',
  tweetUrl: 'Tweet URL',
  postedAt: 'Posted At'
};

const DEFAULT_SETTINGS: AppSettings = {
  notionApiKey: '',
  notionDatabaseId: '',
  notionVersion: '2025-09-03',
  propertyMap: DEFAULT_PROPERTY_MAP
};

export async function getSettings(): Promise<AppSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const stored = (result[STORAGE_KEY] ?? {}) as Partial<AppSettings>;
      const propertyMap = {
        ...DEFAULT_PROPERTY_MAP,
        ...(stored.propertyMap ?? {})
      };

      const coerced: AppSettings = {
        ...DEFAULT_SETTINGS,
        notionApiKey: String((stored as Record<string, unknown>).notionApiKey ?? ''),
        notionDatabaseId: String(
          (stored as Record<string, unknown>).notionDatabaseId ?? ''
        ),
        notionVersion: String(
          (stored as Record<string, unknown>).notionVersion ??
            DEFAULT_SETTINGS.notionVersion
        ),
        propertyMap
      };

      resolve(coerced);
    });
  });
}

export async function saveSettings(settings: AppSettings): Promise<void> {
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
