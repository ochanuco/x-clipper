import { getSettings } from './settings.js';
import type { AppSettings, XPostPayload } from './types.js';

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

    const settings = await getSettings();
    validateSettings(settings);

    const post = await requestExtraction(tab.id);
    await sendToBackend(settings, post);

    await showNotification('Notion に投稿を保存しました。');
  } catch (error) {
    let message = '処理中にエラーが発生しました。';
    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
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

function validateSettings(settings: AppSettings) {
  const endpoint = settings.backendEndpoint?.trim();
  if (!endpoint) {
    throw new Error('バックエンドのエンドポイントが未設定です。オプションページで設定してください。');
  }
  try {
    // eslint-disable-next-line no-new
    new URL(endpoint);
  } catch {
    throw new Error('バックエンドのエンドポイント URL が不正です。');
  }
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

async function sendToBackend(settings: AppSettings, post: XPostPayload) {
  const endpoint = settings.backendEndpoint.trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (settings.backendAuthToken?.trim()) {
    headers.Authorization = `Bearer ${settings.backendAuthToken.trim()}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...post,
      propertyMap: settings.propertyMap
    })
  });

  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload?.error ?? '';
    } catch {
      detail = await response.text();
    }

    const summary = `バックエンドがエラーを返しました（HTTP ${response.status}）`;
    throw new Error(detail ? `${summary}: ${detail}` : summary);
  }
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
