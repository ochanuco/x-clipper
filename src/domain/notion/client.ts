import type { AppSettings, XPostPayload, DownloadedAsset, NotionFileUpload } from '../../types.js';
import { deleteFromCache } from '../storage/cache.js';

const NOTION_API_URL = 'https://api.notion.com/v1';
const MAX_DIRECT_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function notionRequest(
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

export async function createFileUploadObject(
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

export async function sendFileUploadContents({
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

export async function uploadAssetToNotion(
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

function buildCompactTitle(text?: string) {
    const trimmed = text?.trim();
    if (!trimmed) return 'Image';
    const newlineIndex = trimmed.indexOf('\n');
    // 改行がある場合はその手前まで
    if (newlineIndex !== -1) {
        const endIndex = Math.min(newlineIndex, 120);
        return trimmed.slice(0, endIndex) + (endIndex < trimmed.length ? '...' : '');
    }
    // 改行がない場合は120文字まで
    return trimmed.slice(0, 120) + (trimmed.length > 120 ? '...' : '');
}

export function buildProperties(payload: XPostPayload, map: AppSettings['propertyMap']) {
    const properties: Record<string, unknown> = {};
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

function buildIconFromAsset(
    asset: DownloadedAsset | null | undefined,
    fallbackUrl?: string | null
) {
    if (asset) {
        const source = buildNotionFileSource(asset);
        if (source) {
            return source;
        }
    }
    if (fallbackUrl) {
        return {
            type: 'external',
            external: {
                url: fallbackUrl
            }
        };
    }
    return undefined;
}

function buildCoverFromAsset(
    asset: DownloadedAsset | null | undefined,
    fallbackUrl?: string | null
) {
    if (asset) {
        const source = buildNotionFileSource(asset);
        if (source) {
            return source;
        }
    }
    if (fallbackUrl) {
        return {
            type: 'external',
            external: {
                url: fallbackUrl
            }
        };
    }
    return undefined;
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

    const assetMap = new Map(
        mediaAssets.map((asset) => [asset.sourceUrl, asset])
    );
    const usedSources = new Set<string>();

    if (Array.isArray(payload.images) && payload.images.length > 0) {
        // keep Notion children aligned with the extracted order, falling back to external URLs if downloads failed
        for (const originalUrl of payload.images) {
            if (!originalUrl) continue;
            const asset = assetMap.get(originalUrl);
            if (asset) {
                usedSources.add(asset.sourceUrl);
                children.push({
                    object: 'block',
                    type: 'image',
                    image: buildNotionFileSource(asset)
                });
            } else {
                children.push({
                    object: 'block',
                    type: 'image',
                    image: {
                        type: 'external',
                        external: { url: originalUrl }
                    }
                });
            }
        }
    } else {
        for (const asset of mediaAssets) {
            children.push({
                object: 'block',
                type: 'image',
                image: buildNotionFileSource(asset)
            });
            usedSources.add(asset.sourceUrl);
        }
    }

    // include any downloaded assets that were not part of payload.images (edge cases)
    for (const asset of mediaAssets) {
        if (usedSources.has(asset.sourceUrl)) continue;
        children.push({
            object: 'block',
            type: 'image',
            image: buildNotionFileSource(asset)
        });
    }

    return children;
}

export async function createNotionPage({
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
        icon: buildIconFromAsset(avatarAsset, payload.avatarUrl),
        cover: buildCoverFromAsset(mediaAssets[0], payload.images?.[0]),
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

        // Throw specific errors for the caller to handle (e.g. show notification)
        const parsed = JSON.parse(detail || '{}');
        if (response.status === 404 || parsed?.code === 'object_not_found') {
            throw new Error('Notion のデータベースが見つかりません。データベースを integration に共有しているか確認してください。');
        } else if (response.status === 401 || response.status === 403) {
            throw new Error('Notion API キーが無効か権限が不足しています。Options で API キーと DB 共有を確認してください。');
        } else {
            throw new Error(`Notion ページの作成に失敗しました（HTTP ${response.status}）: ${detail}`);
        }
    }
}
