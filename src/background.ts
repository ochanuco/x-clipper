import { createNotionPage } from './notion.js';
import type { NotionError } from './notion.js';
import { getSettings, parseDatabaseIdFromUrl, saveSettings } from './settings.js';
import type { XPostPayload } from './types.js';

const CONTEXT_MENU_ID = 'clip-notion-x-post';
const NOTIFICATION_ICON_PATH = 'icons/icon-128.png';

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
      await showNotification('アクティブなタブが見つかりません。', true);
      return;
    }

    if (!isSupportedUrl(tab.url)) {
      await showNotification('X (Twitter) の詳細投稿ページで実行してください。', true);
      return;
    }

    const settings = await ensureSettingsReady();
    if (!settings.notionApiKey || !settings.notionDatabaseId) {
      await showNotification(
        'Notion 設定が不足しています。オプションページで設定してください。',
        true
      );
      return;
    }

    const post = await requestExtraction(tab.id);
    await createNotionPage(settings, post);

    await showNotification('Notion に投稿を保存しました。');
  } catch (error) {
    let message = '処理中にエラーが発生しました。';
    if (isNotionError(error)) {
      const formatted = formatNotionError(error);
      message = formatted.userMessage;
      console.warn('Notion API error', formatted.debug);
    } else if (error instanceof Error) {
      message = error.message;
    }
    await showNotification(message, true);
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
  try {
    return await sendExtractionRequest(tabId);
  } catch (error) {
    if (error instanceof ExtractionError && error.reason === 'NO_RECEIVER') {
      await ensureContentScript(tabId);
      return await sendExtractionRequest(tabId);
    }
    throw error;
  }
}

async function ensureContentScript(tabId: number) {
  return chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-script.js']
  });
}

class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly reason: 'NO_RECEIVER' | 'UNKNOWN'
  ) {
    super(message);
  }
}

async function sendExtractionRequest(tabId: number): Promise<XPostPayload> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'EXTRACT_X_POST' },
      (response) => {
        if (chrome.runtime.lastError) {
          const runtimeMessage = chrome.runtime.lastError.message ?? '';
          if (runtimeMessage.includes('Receiving end does not exist')) {
            reject(
              new ExtractionError(
                '投稿を取得できませんでした。ページを再読み込みしてもう一度お試しください。',
                'NO_RECEIVER'
              )
            );
            return;
          }

          reject(
            new ExtractionError(
              'ページから情報を取得できませんでした。権限と対象ページを確認してください。',
              'UNKNOWN'
            )
          );
          return;
        }

        if (!response) {
          reject(
            new ExtractionError(
              'コンテンツスクリプトから応答がありませんでした。',
              'UNKNOWN'
            )
          );
          return;
        }

        if (!response.success) {
          reject(
            new ExtractionError(
              response.error ?? '投稿の抽出に失敗しました。',
              'UNKNOWN'
            )
          );
          return;
        }

        resolve(response.data as XPostPayload);
      }
    );
  });
}

function isNotionError(error: unknown): error is NotionError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ('responseStatus' in error || 'responseBody' in error)
  );
}

function formatNotionError(error: NotionError) {
  const status = error.responseStatus ?? '不明';
  let code = '';
  let message = '';

  if (error.responseBody) {
    try {
      const parsed = JSON.parse(error.responseBody) as {
        code?: string;
        message?: string;
      };
      code = parsed.code ?? '';
      message = parsed.message ?? '';
    } catch {
      message = error.responseBody.slice(0, 200);
    }
  }

  const parts = [`HTTP ${status}`];
  if (code) {
    parts.push(code);
  }
  const summary = parts.join(' / ');

  const userMessage =
    message.trim().length > 0
      ? `Notion への書き込みに失敗しました（${summary}）。${message}`
      : `Notion への書き込みに失敗しました（${summary}）。`;

  return {
    userMessage,
    debug: {
      status: error.responseStatus,
      code,
      message,
      raw: error.responseBody
    }
  };
}

async function showNotification(message: string, isError = false) {
  return new Promise<void>((resolve) => {
    const iconUrl = chrome.runtime.getURL(NOTIFICATION_ICON_PATH);
    chrome.notifications.create(
      '',
      {
        type: 'basic',
        iconUrl,
        title: 'Clip to Notion',
        message
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('notification error', chrome.runtime.lastError.message);
        }

        const badgeColor = isError ? '#ef4444' : '#10b981';
        const badgeText = isError ? '!' : 'OK';

        chrome.action.setBadgeBackgroundColor({ color: badgeColor }, () => {
          chrome.action.setBadgeText({ text: badgeText }, () => {
            setTimeout(() => {
              chrome.action.setBadgeText({ text: '' }, () => resolve());
            }, 2500);
          });
        });
      }
    );
  });
}
