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

  return {
    label,
    sourceUrl: url,
    blob,
    fileName,
    contentType
  };
}

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
  const fallbackTitle = payload.text
    ? payload.text.slice(0, 100)
    : `${payload.screenName} (${payload.userName})`;

  const titleKey = map.title?.trim();
  if (titleKey) {
    properties[titleKey] = {
      title: [
        {
          text: { content: fallbackTitle || 'X Clipper' }
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
