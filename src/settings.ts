import type { AppSettings, NotionPropertyMap, NotionPropertyType } from './types.js';

export const STORAGE_KEY = 'notionSettings';

const DEFAULT_PROPERTY_MAP: NotionPropertyMap = {
  title: {
    propertyName: 'Name',
    propertyType: 'title'
  },
  screenName: {
    propertyName: 'Screen Name',
    propertyType: 'rich_text'
  },
  userName: {
    propertyName: 'Username',
    propertyType: 'rich_text'
  },
  tweetUrl: {
    propertyName: 'Tweet URL',
    propertyType: 'url'
  },
  postedAt: {
    propertyName: 'Posted At',
    propertyType: 'date'
  }
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
      const propertyMap = normalizePropertyMap(stored.propertyMap);

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

function normalizePropertyType(value: unknown, fallback: NotionPropertyType): NotionPropertyType {
  if (
    value === 'title' ||
    value === 'rich_text' ||
    value === 'select' ||
    value === 'multi_select' ||
    value === 'url' ||
    value === 'date'
  ) {
    return value;
  }
  return fallback;
}

function normalizeEntry(
  value: unknown,
  fallbackName: string,
  fallbackType: NotionPropertyType
) {
  if (typeof value === 'string') {
    return {
      propertyName: value,
      propertyType: fallbackType
    };
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return {
      propertyName: String(obj.propertyName ?? fallbackName),
      propertyType: normalizePropertyType(obj.propertyType, fallbackType)
    };
  }

  return {
    propertyName: fallbackName,
    propertyType: fallbackType
  };
}

function normalizePropertyMap(value: unknown): NotionPropertyMap {
  const raw = (value ?? {}) as Record<string, unknown>;

  return {
    title: normalizeEntry(raw.title, DEFAULT_PROPERTY_MAP.title.propertyName, 'title'),
    screenName: normalizeEntry(
      raw.screenName,
      DEFAULT_PROPERTY_MAP.screenName.propertyName,
      'rich_text'
    ),
    userName: normalizeEntry(
      raw.userName,
      DEFAULT_PROPERTY_MAP.userName.propertyName,
      'rich_text'
    ),
    tweetUrl: normalizeEntry(raw.tweetUrl, DEFAULT_PROPERTY_MAP.tweetUrl.propertyName, 'url'),
    postedAt: normalizeEntry(raw.postedAt, DEFAULT_PROPERTY_MAP.postedAt.propertyName, 'date')
  };
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
