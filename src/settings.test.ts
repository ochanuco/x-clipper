import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings, saveSettings, STORAGE_KEY } from './settings.js';

type StorageState = Record<string, unknown>;

const storageState: StorageState = {};

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(storageState)) {
    delete storageState[key];
  }

  vi.stubGlobal('chrome', {
    runtime: {
      lastError: null
    },
    storage: {
      local: {
        get: vi.fn((keys: string[], callback: (result: Record<string, unknown>) => void) => {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            result[key] = storageState[key];
          }
          callback(result);
        }),
        set: vi.fn((payload: Record<string, unknown>, callback: () => void) => {
          Object.assign(storageState, payload);
          callback();
        })
      }
    }
  });
});

describe('settings', () => {
  it('propertyMap が未保存でも既定値で補完する', async () => {
    storageState[STORAGE_KEY] = {
      notionApiKey: 'ntn_test',
      notionDatabaseId: 'dbid'
    };

    const settings = await getSettings();

    expect(settings.propertyMap.title).toEqual({
      propertyName: 'Name',
      propertyType: 'title'
    });
    expect(settings.propertyMap.tweetUrl).toEqual({
      propertyName: 'Tweet URL',
      propertyType: 'url'
    });
  });

  it('旧式の文字列マッピングも正規化できる', async () => {
    storageState[STORAGE_KEY] = {
      notionApiKey: 'ntn_test',
      notionDatabaseId: 'dbid',
      propertyMap: {
        title: 'Name',
        screenName: 'Screen Name',
        userName: 'Username',
        tweetUrl: 'Tweet URL',
        postedAt: 'Posted At'
      }
    };

    const settings = await getSettings();

    expect(settings.propertyMap.postedAt).toEqual({
      propertyName: 'Posted At',
      propertyType: 'date'
    });
  });

  it('propertyMap を含めて保存できる', async () => {
    const settings = await getSettings();
    await saveSettings(settings);

    expect(storageState[STORAGE_KEY]).toEqual(settings);
  });
});
