import { getSettings } from './settings.js';
import type { AppSettings, DownloadedAsset } from './types.js';
import type { XPostPayload } from './domain/x/types.js';
import { downloadAsset } from './services/downloader.js';
import { expandTcoUrlsInText } from './services/tco-resolver.js';
import { uploadAssetToNotion, createNotionPage, buildProperties } from './domain/notion/client.js';
import { cleanupExpiredCache, deleteFromCache } from './domain/storage/cache.js';

const NOTIFICATION_ICON_PATH = 'icons/icon-128.png';
const CACHE_TTL_MS = 5 * 60 * 1000;

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

class AlreadyNotifiedError extends Error {
  public readonly alreadyNotified = true;

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

async function clipPostToNotion(
  settings: AppSettings,
  post: XPostPayload
): Promise<void> {
  const normalizedPost = await normalizePostTextUrls(post);
  const databaseId = normalizeDatabaseId(settings.notionDatabaseId);

  let avatarAsset: DownloadedAsset | null = null;
  if (normalizedPost.avatarUrl) {
    try {
      avatarAsset = await downloadAsset(normalizedPost.avatarUrl, 'avatar');
    } catch (error) {
      console.warn('アバター画像の取得に失敗しました', normalizedPost.avatarUrl, error);
    }
  }

  const mediaAssets: DownloadedAsset[] = [];
  for (const [index, url] of normalizedPost.images.entries()) {
    if (isVideoUrl(url)) {
      continue;
    }
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
      payload: normalizedPost,
      properties: buildProperties(normalizedPost, settings.propertyMap),
      avatarAsset,
      mediaAssets
    });
    await clearCachedAssets([avatarAsset, ...mediaAssets]);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Notion への保存中にエラーが発生しました。';
    await showNotification(message, true);
    throw new AlreadyNotifiedError(message, error);
  }
}

async function normalizePostTextUrls(post: XPostPayload): Promise<XPostPayload> {
  const text = await expandTcoUrlsInText(post.text);
  if (text === post.text) return post;
  return { ...post, text };
}

function isVideoUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /\.(mp4|mov|m4v|webm|ogv)$/i.test(pathname);
  } catch {
    return false;
  }
}

async function clearCachedAssets(assets: Array<DownloadedAsset | null | undefined>) {
  const targets = assets.filter((asset): asset is DownloadedAsset => !!asset);
  await Promise.all(
    targets.map((asset) =>
      deleteFromCache(asset.fileName).catch((err) => {
        console.warn('failed to delete cached asset', asset.fileName, err);
      })
    )
  );
}

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
        await showNotification('Notion に投稿を保存しました。');
        sendResponse({ success: true });
      } catch (err) {
        console.warn('clip to notion failed', err);
        sendResponse({ success: false, error: String(err) });
      }
    } catch (err) {
      console.warn('CLIP_X_POST handler error', err);
      sendResponse({ success: false, error: String(err) });
    }
  })();

  return true;
});

try {
  const periodInMinutes = Math.max(1, Math.round(CACHE_TTL_MS / 60000));
  chrome.alarms.create('xclip-cache-cleanup', { periodInMinutes });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'xclip-cache-cleanup') {
      void cleanupExpiredCache(CACHE_TTL_MS)
        .then((deleted) => {
          if (deleted > 0) {
            console.log(`x-clipper: cleaned up ${deleted} cached assets`);
          }
        })
        .catch((err) => {
          console.warn('x-clipper: scheduled cache cleanup failed', err);
        });
    }
  });
} catch (err) {
  void err;
}

void cleanupExpiredCache(CACHE_TTL_MS)
  .then((deleted) => {
    if (deleted > 0) {
      console.log(`x-clipper: cleaned up ${deleted} cached assets on startup`);
    }
  })
  .catch((err) => {
    console.warn('x-clipper: startup cache cleanup failed', err);
  });

function normalizeDatabaseId(input: string) {
  const trimmed = input.trim();
  const match =
    trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i) ??
    trimmed.match(/[a-f0-9]{32}/i);

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
