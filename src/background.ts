import { createNotionPage } from './notion.js';
import { getSettings, parseDatabaseIdFromUrl, saveSettings } from './settings.js';
import type { XPostPayload } from './types.js';

const CONTEXT_MENU_ID = 'clip-notion-x-post';
const NOTIFICATION_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'この投稿を Notion に保存',
      contexts: ['page'],
      documentUrlPatterns: [
        'https://x.com/*/status/*',
        'https://twitter.com/*/status/*'
      ]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    await handleClip(tab);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  await handleClip(tab);
});

async function handleClip(tab?: chrome.tabs.Tab) {
  try {
    if (!tab || typeof tab.id !== 'number' || !tab.url) {
      await showNotification('アクティブなタブが見つかりません。');
      return;
    }

    if (!isSupportedUrl(tab.url)) {
      await showNotification('X (Twitter) の詳細投稿ページで実行してください。');
      return;
    }

    const settings = await ensureSettingsReady();
    if (!settings.notionApiKey || !settings.notionDatabaseId) {
      await showNotification('Notion 設定が不足しています。オプションページで設定してください。');
      return;
    }

    const post = await requestExtraction(tab.id);
    await createNotionPage(settings, post);

    await showNotification('Notion に投稿を保存しました。');
  } catch (error) {
    let message = '処理中にエラーが発生しました。';
    if (error instanceof Error) {
      message = error.message;
      if ('responseStatus' in error && 'responseBody' in error) {
        console.warn('Notion API error', error);
      }
    }
    await showNotification(message);
  }
}

function isSupportedUrl(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    const isX = hostname === 'x.com' || hostname === 'twitter.com';
    const isStatus = /\/status\/\d+/.test(pathname);
    return isX && isStatus;
  } catch {
    return false;
  }
}

async function ensureSettingsReady() {
  const settings = await getSettings();
  if (!settings.notionDatabaseId && settings.notionDatabaseUrl) {
    const extracted = parseDatabaseIdFromUrl(settings.notionDatabaseUrl);
    if (extracted) {
      settings.notionDatabaseId = extracted;
      await saveSettings(settings);
    }
  }
  return settings;
}

async function requestExtraction(tabId: number): Promise<XPostPayload> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'EXTRACT_X_POST' },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(
              'ページから情報を取得できませんでした。権限と対象ページを確認してください。'
            )
          );
          return;
        }

        if (!response) {
          reject(new Error('コンテンツスクリプトから応答がありませんでした。'));
          return;
        }

        if (!response.success) {
          reject(new Error(response.error ?? '投稿の抽出に失敗しました。'));
          return;
        }

        resolve(response.data as XPostPayload);
      }
    );
  });
}

async function showNotification(message: string) {
  return new Promise<void>((resolve) => {
    chrome.notifications.create(
      '',
      {
        type: 'basic',
        iconUrl: NOTIFICATION_ICON,
        title: 'Clip to Notion',
        message
      },
      () => resolve()
    );
  });
}
