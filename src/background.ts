import { getSettings } from './settings.js';
import type { AppSettings, XPostPayload, DownloadedAsset } from './types.js';
import { downloadAsset } from './services/downloader.js';
import { uploadAssetToNotion, createNotionPage, buildProperties } from './domain/notion/client.js';
import { getFromCache, cleanupExpiredCache } from './domain/storage/cache.js';

const CONTEXT_MENU_ID = 'x-clipper-x-post';
const NOTIFICATION_ICON_PATH = 'icons/icon-128.png';
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'X Clipper で Notion に保存',
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
    await clipPostToNotion(settings, post);

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
  const apiKey = settings.notionApiKey?.trim();
  if (!apiKey) {
    throw new Error('Notion API キーが未設定です。オプションページで設定してください。');
  }

  const databaseId = settings.notionDatabaseId?.trim();
  if (!databaseId) {
    throw new Error('Notion データベース ID が未設定です。オプションページで設定してください。');
  }
  if (!/^[a-f0-9-]{32,36}$/i.test(databaseId)) {
    throw new Error('Notion データベース ID の形式が正しくありません。');
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

async function clipPostToNotion(
  settings: AppSettings,
  post: XPostPayload
): Promise<void> {
  const databaseId = normalizeDatabaseId(settings.notionDatabaseId);
  const propertyNames = {
    ...settings.propertyMap,
    ...(post.propertyMap ?? {})
  };

  let avatarAsset: DownloadedAsset | null = null;
  if (post.avatarUrl) {
    try {
      avatarAsset = await downloadAsset(post.avatarUrl, 'avatar');
    } catch (error) {
      console.warn('アバター画像の取得に失敗しました', post.avatarUrl, error);
    }
  }

  const mediaAssets: DownloadedAsset[] = [];
  for (const [index, url] of post.images.entries()) {
    try {
      const asset = await downloadAsset(url, `media-${index + 1}`);
      mediaAssets.push(asset);
    } catch (error) {
      console.warn('画像の取得に失敗しました', url, error);
    }
  }

  if (avatarAsset) {
    const upload = await uploadAssetToNotion(avatarAsset, settings);
    if (upload) {
      avatarAsset.notionFileUpload = upload;
    }
  }

  await Promise.all(
    mediaAssets.map(async (asset) => {
      const upload = await uploadAssetToNotion(asset, settings);
      if (upload) {
        asset.notionFileUpload = upload;
      }
    })
  );

  try {
    await createNotionPage({
      settings,
      databaseId,
      payload: post,
      properties: buildProperties(post, propertyNames),
      avatarAsset,
      mediaAssets
    });
  } catch (error) {
    // Show user-friendly notification for specific errors
    if (error instanceof Error) {
      await showNotification(error.message, true);
    }
    throw error;
  }
}

// Handle messages from options page for reuploading cached assets
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'REUPLOAD_ASSET') return undefined;
  const fileName: string = message.fileName;
  (async () => {
    try {
      const cached = await getFromCache(fileName);
      if (!cached) {
        sendResponse({ success: false, error: 'not_found' });
        return;
      }

      const settings = await getSettings();
      const asset: DownloadedAsset = {
        label: fileName,
        sourceUrl: String(cached.meta?.sourceUrl ?? ''),
        blob: cached.blob,
        fileName: cached.fileName,
        contentType: cached.blob.type || 'application/octet-stream'
      };

      const upload = await uploadAssetToNotion(asset, settings);
      if (upload) {
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'upload_failed' });
      }
    } catch (err) {
      console.warn('reupload failed', err);
      sendResponse({ success: false, error: String(err) });
    }
  })();
  return true;
});

// Handle clip requests from content script save buttons
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'CLIP_X_POST') return undefined;
  (async () => {
    try {
      const settings = await getSettings();
      validateSettings(settings);
      const payload = message.data as XPostPayload;
      if (!payload || typeof payload !== 'object' || !payload.url || !Array.isArray(payload.images)) {
        sendResponse({ success: false, error: 'invalid_payload structure' });
        return;
      }
      try {
        await clipPostToNotion(settings, payload);
        sendResponse({ success: true });
        return;
      } catch (err) {
        console.warn('clip to notion failed, falling back to downloads', err);
        // fallback: download media files (avatar + images)
        const urls: string[] = [];
        if (payload.avatarUrl) urls.push(payload.avatarUrl);
        if (Array.isArray(payload.images)) urls.push(...payload.images);

        // Attempt to use chrome.downloads if available
        if (chrome.downloads && chrome.downloads.download) {
          void showNotification('Notion へのアップロードに失敗したため、ファイルをダウンロードします。', true);
          for (const url of urls) {
            try {
              const ext = resolveExtension(url, 'application/octet-stream');
              const name = buildFileName('x-clip', ext);
              chrome.downloads.download({ url, filename: name, conflictAction: 'uniquify' }, (id) => {
                if (chrome.runtime.lastError) {
                  console.warn('download failed', chrome.runtime.lastError.message);
                } else {
                  console.log('started download', id, url);
                }
              });
            } catch (err2) {
              console.warn('fallback download error for', url, err2);
            }
          }
          sendResponse({ success: false, fallback: 'downloads' });
          return;
        }

        sendResponse({ success: false, error: String(err) });
        return;
      }
    } catch (err) {
      console.warn('CLIP_X_POST handler error', err);
      sendResponse({ success: false, error: String(err) });
    }
  })();
  return true;
});

// Schedule daily cleanup using chrome.alarms
try {
  chrome.alarms.create('xclip-cache-cleanup', { periodInMinutes: 24 * 60 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'xclip-cache-cleanup') {
      void cleanupExpiredCache(DEFAULT_CACHE_TTL_MS).then((deleted) => {
        if (deleted > 0) {
          console.log(`x-clipper: cleaned up ${deleted} cached assets`);
        }
      });
    }
  });
} catch (err) {
  console.warn('chrome.alarms not available, skipping scheduled cache cleanup', err);
}

// Run a cleanup on startup of the service worker
void cleanupExpiredCache(DEFAULT_CACHE_TTL_MS).then((deleted) => {
  if (deleted > 0) {
    console.log(`x-clipper: cleaned up ${deleted} cached assets on startup`);
  }
}).catch((err) => {
  console.warn('x-clipper: startup cache cleanup failed', err);
});

function resolveExtension(url: string, contentType: string) {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop();
    if (ext && /^[a-z0-9]+$/i.test(ext)) {
      return ext.toLowerCase();
    }
  } catch {
    // ignore parse errors
  }

  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov'
  };
  return map[contentType.toLowerCase()] ?? 'bin';
}

function buildFileName(label: string, extension: string) {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '-');
  const unique = crypto.randomUUID().split('-')[0];
  return `${safeLabel}-${unique}.${extension}`;
}

function normalizeDatabaseId(input: string) {
  const trimmed = input.trim();
  const match =
    trimmed.match(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i
    ) ?? trimmed.match(/[a-f0-9]{32}/i);

  if (!match) {
    throw new Error('Notion データベース ID の形式が認識できませんでした。');
  }
  return match[0].replace(/-/g, '');
}

async function showNotification(message: string, isError = false) {
  return new Promise<void>((resolve) => {
    const iconUrl = chrome.runtime.getURL(NOTIFICATION_ICON_PATH);
    chrome.notifications.create(
      '',
      {
        type: 'basic',
        iconUrl,
        title: 'X Clipper',
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
