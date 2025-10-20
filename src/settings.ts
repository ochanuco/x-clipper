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
  backendEndpoint: '',
  backendAuthToken: '',
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

      resolve({
        ...DEFAULT_SETTINGS,
        ...stored,
        propertyMap
      });
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
