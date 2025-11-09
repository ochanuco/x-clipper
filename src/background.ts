import { getSettings } from './settings.js';
import type { AppSettings, XPostPayload } from './types.js';

const CONTEXT_MENU_ID = 'x-clipper-x-post';
const NOTIFICATION_ICON_PATH = 'icons/icon-128.png';

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

  await createNotionPage({
    settings,
    databaseId,
    payload: post,
    properties: buildProperties(post, propertyNames),
    avatarAsset,
    mediaAssets
  });
}

type DownloadedAsset = {
  label: string;
  sourceUrl: string;
  blob: Blob;
  fileName: string;
  contentType: string;
  notionFileUpload?: NotionFileUpload;
};

type NotionFileUpload = {
  id: string;
  status?: string;
  filename?: string | null;
  content_type?: string | null;
};

const NOTION_API_URL = 'https://api.notion.com/v1';
const MAX_DIRECT_UPLOAD_BYTES = 20 * 1024 * 1024;

async function downloadAsset(url: string, label: string): Promise<DownloadedAsset> {
  if (!url) {
    throw new Error('URL が空です');
  }
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`画像の取得に失敗しました（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  if (blob.size > MAX_DIRECT_UPLOAD_BYTES) {
    console.warn(
      `画像サイズが 20MB を超えています (${(blob.size / 1048576).toFixed(2)}MB)。アップロードをスキップします。`
    );
  }
  const contentType =
    response.headers.get('content-type') ?? blob.type ?? 'application/octet-stream';
  const extension = resolveExtension(url, contentType);
  const fileName = buildFileName(label, extension);

  const asset = {
    label,
    sourceUrl: url,
    blob,
    fileName,
    contentType
  };

  // Save to cache for potential retries / delayed uploads
  try {
    // Fire-and-forget; don't block if cache fails
    void saveToCache({ fileName: asset.fileName, blob: asset.blob, meta: { sourceUrl: url, label } });
  } catch (err) {
    console.warn('failed to save asset to cache', err);
  }

  return asset;
}

// IndexedDB cache utilities --------------------------------------------------
const IDB_DB_NAME = 'x-clipper-cache';
const IDB_STORE_NAME = 'assets';

// TTL for cached assets (default 7 days)
const DEFAULT_CACHE_TTL_DAYS = 7;
const DEFAULT_CACHE_TTL_MS = DEFAULT_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: 'fileName' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToCache(asset: { fileName: string; blob: Blob; meta?: Record<string, unknown> }): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const putReq = store.put({ fileName: asset.fileName, blob: asset.blob, meta: asset.meta ?? {}, createdAt: Date.now() });
    putReq.onsuccess = () => resolve();
    putReq.onerror = () => reject(putReq.error);
  });
}

async function getFromCache(fileName: string): Promise<{ fileName: string; blob: Blob; meta?: Record<string, unknown> } | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.get(fileName);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteFromCache(fileName: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.delete(fileName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getCachedAsset(fileName: string): Promise<{ fileName: string; blob: Blob; meta?: Record<string, unknown> } | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.get(fileName);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

// Handle messages from options page for reuploading cached assets
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'REUPLOAD_ASSET') return undefined;
  const fileName: string = message.fileName;
  (async () => {
    try {
      const cached = await getCachedAsset(fileName);
      if (!cached) {
        sendResponse({ success: false, error: 'not_found' });
        return;
      }

      // we need settings to create upload object
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
  return true; // indicate async sendResponse
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

async function cleanupExpiredCache(ttlMs = DEFAULT_CACHE_TTL_MS): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.openCursor();
    let deleted = 0;
    req.onsuccess = (ev) => {
      const cursor = (ev.target as IDBRequest).result as IDBCursorWithValue | null;
      if (!cursor) {
        resolve(deleted);
        return;
      }
      try {
        const record = cursor.value as { fileName: string; createdAt?: number };
        const createdAt = record?.createdAt ?? 0;
        if (Date.now() - createdAt > ttlMs) {
          cursor.delete();
          deleted++;
        }
        cursor.continue();
      } catch (err) {
        console.warn('error while scanning cache for cleanup', err);
        cursor.continue();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// Schedule daily cleanup using chrome.alarms
try {
  chrome.alarms.create('xclip-cache-cleanup', { periodInMinutes: 24 * 60 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'xclip-cache-cleanup') {
      void cleanupExpiredCache().then((deleted) => {
        if (deleted > 0) {
          console.log(`x-clipper: cleaned up ${deleted} cached assets`);
        }
      });
    }
  });
} catch (err) {
  // In environments where alarms aren't available (e.g., tests), ignore
  console.warn('chrome.alarms not available, skipping scheduled cache cleanup', err);
}

// Run a cleanup on startup of the service worker
void cleanupExpiredCache().then((deleted) => {
  if (deleted > 0) {
    console.log(`x-clipper: cleaned up ${deleted} cached assets on startup`);
  }
}).catch((err) => {
  console.warn('x-clipper: startup cache cleanup failed', err);
});


async function uploadAssetToNotion(
  asset: DownloadedAsset,
  settings: AppSettings
): Promise<NotionFileUpload | null> {
  if (asset.blob.size > MAX_DIRECT_UPLOAD_BYTES) {
    return null;
  }
  try {
    const uploadMeta = await createFileUploadObject(settings);
    const uploaded = await sendFileUploadContents({
      settings,
      fileUploadId: uploadMeta.id,
      blob: asset.blob,
      fileName: asset.fileName,
      contentType: asset.contentType
    });
    if (uploaded.status !== 'uploaded') {
      throw new Error(
        `Notion へのアップロードが完了しませんでした（status: ${uploaded.status}）`
      );
    }
    // On success, remove cached copy if present
    try {
      await deleteFromCache(asset.fileName);
    } catch (err) {
      console.warn('failed to delete cached asset after upload', asset.fileName, err);
    }
    return uploaded;
  } catch (error) {
    console.warn('Notion へのファイルアップロードに失敗しました', asset.fileName, error);
    return null;
  }
}

async function createFileUploadObject(
  settings: AppSettings
): Promise<{ id: string }> {
  const response = await notionRequest(
    '/file_uploads',
    {
      method: 'POST',
      body: JSON.stringify({ mode: 'single_part' })
    },
    settings
  );
  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      `ファイルアップロード ID の作成に失敗しました（HTTP ${response.status}）: ${JSON.stringify(
        json
      )}`
    );
  }
  if (!json?.id) {
    throw new Error('ファイルアップロード ID がレスポンスに含まれていません。');
  }
  return json as { id: string };
}

async function sendFileUploadContents({
  settings,
  fileUploadId,
  blob,
  fileName,
  contentType
}: {
  settings: AppSettings;
  fileUploadId: string;
  blob: Blob;
  fileName: string;
  contentType: string;
}): Promise<NotionFileUpload> {
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([blob], { type: contentType }),
    fileName
  );

  const response = await notionRequest(
    `/file_uploads/${fileUploadId}/send`,
    {
      method: 'POST',
      body: formData
    },
    settings
  );
  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      `ファイルアップロード送信に失敗しました（HTTP ${response.status}）: ${JSON.stringify(
        json
      )}`
    );
  }
  return json as NotionFileUpload;
}

async function createNotionPage({
  settings,
  databaseId,
  payload,
  properties,
  avatarAsset,
  mediaAssets
}: {
  settings: AppSettings;
  databaseId: string;
  payload: XPostPayload;
  properties: ReturnType<typeof buildProperties>;
  avatarAsset: DownloadedAsset | null;
  mediaAssets: DownloadedAsset[];
}) {
  const requestBody = {
    parent: { database_id: databaseId },
    icon: buildIconFromAsset(avatarAsset),
    cover: buildCoverFromAsset(mediaAssets[0]),
    properties,
    children: buildChildren(payload, mediaAssets)
  };

  const response = await notionRequest(
    '/pages',
    {
      method: 'POST',
      body: JSON.stringify(requestBody)
    },
    settings
  );
  if (!response.ok) {
    let detail = '';
    try {
      const data = await response.json();
      detail = JSON.stringify(data);
    } catch {
      detail = await response.text();
    }
    console.error('Notion /pages response error', { status: response.status, body: detail });
    // If database not found or permissions issue, notify the user with guidance
    try {
      const parsed = JSON.parse(detail || '{}');
      if (response.status === 404 || parsed?.code === 'object_not_found') {
        void showNotification('Notion のデータベースが見つかりません。データベースを integration に共有しているか確認してください。', true);
      } else if (response.status === 401 || response.status === 403) {
        void showNotification('Notion API キーが無効か権限が不足しています。Options で API キーと DB 共有を確認してください。', true);
      } else {
        void showNotification('Notion へのページ作成に失敗しました。コンソールログを確認してください。', true);
      }
    } catch (err) {
      void showNotification('Notion へのページ作成に失敗しました。コンソールログを確認してください。', true);
    }
    throw new Error(`Notion ページの作成に失敗しました（HTTP ${response.status}）: ${detail}`);
  }
}

function notionRequest(
  path: string,
  init: RequestInit,
  settings: AppSettings
): Promise<Response> {
  const notionVersion = settings.notionVersion?.trim() || '2025-09-03';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.notionApiKey.trim()}`,
    'Notion-Version': notionVersion
  };

  const body = init?.body ?? null;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  if (init.headers) {
    Object.assign(headers, init.headers as Record<string, string>);
  }

  return fetch(`${NOTION_API_URL}${path}`, {
    ...init,
    headers
  });
}

function buildProperties(payload: XPostPayload, map: AppSettings['propertyMap']) {
  const properties: Record<string, unknown> = {};
  function buildCompactTitle(text?: string) {
    const trimmed = text?.trim();
    if (!trimmed) return 'Image';
    const newlineIndex = trimmed.indexOf('\n');
    if (newlineIndex === -1) {
      const endIndex = Math.min(newlineIndex, 120);
      return trimmed.slice(0, endIndex) + (endIndex < trimmed.length ? '...' : '');
    }
    return trimmed.slice(0, 120) + (trimmed.length > 120 ? '...' : '');
  }
  const fallbackTitle = buildCompactTitle(payload.text);

  const titleKey = map.title?.trim();
  if (titleKey) {
    properties[titleKey] = {
      title: [
        {
          text: { content: fallbackTitle || 'Image' }
        }
      ]
    };
  }

  const screenNameKey = map.screenName?.trim();
  if (screenNameKey && payload.screenName) {
    properties[screenNameKey] = {
      rich_text: [
        {
          text: { content: payload.screenName }
        }
      ]
    };
  }

  const userNameKey = map.userName?.trim();
  if (userNameKey && payload.userName) {
    properties[userNameKey] = {
      rich_text: [
        {
          text: { content: payload.userName }
        }
      ]
    };
  }

  const tweetUrlKey = map.tweetUrl?.trim();
  if (tweetUrlKey) {
    properties[tweetUrlKey] = {
      url: payload.url
    };
  }

  const postedAtKey = map.postedAt?.trim();
  if (postedAtKey && payload.timestamp) {
    properties[postedAtKey] = {
      date: {
        start: payload.timestamp
      }
    };
  }

  return properties;
}

function buildChildren(payload: XPostPayload, mediaAssets: DownloadedAsset[]) {
  const children: unknown[] = [];

  if (payload.text) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: payload.text
            }
          }
        ]
      }
    });
  }

  for (const asset of mediaAssets) {
    const imageSource = buildNotionFileSource(asset);
    children.push({
      object: 'block',
      type: 'image',
      image: imageSource
    });
  }

  return children;
}

function buildNotionFileSource(asset: DownloadedAsset) {
  if (asset.notionFileUpload?.id) {
    return {
      type: 'file_upload',
      file_upload: {
        id: asset.notionFileUpload.id
      }
    };
  }
  return {
    type: 'external',
    external: {
      url: asset.sourceUrl
    }
  };
}

function buildIconFromAsset(asset: DownloadedAsset | null | undefined) {
  if (!asset) {
    return undefined;
  }
  const source = buildNotionFileSource(asset);
  return source ?? undefined;
}

function buildCoverFromAsset(asset: DownloadedAsset | null | undefined) {
  if (!asset) {
    return undefined;
  }
  const source = buildNotionFileSource(asset);
  return source ?? undefined;
}

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
  // return compact (no hyphens) which Notion API accepts as database_id
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
