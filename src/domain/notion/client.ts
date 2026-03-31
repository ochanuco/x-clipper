import type {
    AppSettings,
    DownloadedAsset,
    NotionFileUpload,
    NotionPropertyMapping
} from '../../types.js';
import type { XPostPayload } from '../x/types.js';
import { deleteFromCache } from '../storage/cache.js';

const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03';
const MAX_DIRECT_UPLOAD_BYTES = 20 * 1024 * 1024;
const DEFAULT_FIELD_TYPES = {
    title: 'title',
    screenName: 'rich_text',
    userName: 'rich_text',
    tweetUrl: 'url',
    postedAt: 'date'
} as const;

type JsonObject = Record<string, unknown>;

export type NotionRichTextItem = {
    type: 'text';
    text: {
        content: string;
        link?: { url: string } | null;
    };
};

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null;
}

export async function notionRequest(
    path: string,
    init: RequestInit,
    settings: AppSettings
): Promise<Response> {
    const headers: Record<string, string> = {
        Authorization: `Bearer ${settings.notionApiKey.trim()}`,
        'Notion-Version': NOTION_VERSION
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
    const trimmed = text
        ?.replace(/https?:\/\/\S+/g, '')
        ?.replace(/#[\p{L}\p{N}_]+/gu, '')
        ?.replace(/\$[\p{L}\p{N}_]+/gu, '')
        ?.replace(/[ \t]+/g, ' ')
        ?.trim();
    if (!trimmed) return 'Image';
    const newlineIndex = trimmed.indexOf('\n');
    const endIndex = newlineIndex === -1 ? 30 : Math.min(newlineIndex, 30);
    return trimmed.slice(0, endIndex);
}

export function buildProperties(payload: XPostPayload, map: AppSettings['propertyMap']) {
    const properties: Record<string, unknown> = {};
    const fallbackTitle = buildCompactTitle(payload.text);
    const normalizedMap = normalizePropertyMapInput(map as unknown);
    applyMappedProperty(properties, normalizedMap.title, fallbackTitle || 'Image');
    applyMappedProperty(properties, normalizedMap.screenName, payload.screenName);
    applyMappedProperty(properties, normalizedMap.userName, payload.userName);
    applyMappedProperty(properties, normalizedMap.tweetUrl, payload.url);
    applyMappedProperty(properties, normalizedMap.postedAt, payload.timestamp);

    return properties;
}

function normalizePropertyMapInput(input: unknown): Partial<AppSettings['propertyMap']> {
    const raw = isJsonObject(input) ? input : {};
    const normalized: Partial<AppSettings['propertyMap']> = {};

    const title = normalizeMapping(raw.title, DEFAULT_FIELD_TYPES.title);
    if (title) normalized.title = title;

    const screenName = normalizeMapping(raw.screenName, DEFAULT_FIELD_TYPES.screenName);
    if (screenName) normalized.screenName = screenName;

    const userName = normalizeMapping(raw.userName, DEFAULT_FIELD_TYPES.userName);
    if (userName) normalized.userName = userName;

    const tweetUrl = normalizeMapping(raw.tweetUrl, DEFAULT_FIELD_TYPES.tweetUrl);
    if (tweetUrl) normalized.tweetUrl = tweetUrl;

    const postedAt = normalizeMapping(raw.postedAt, DEFAULT_FIELD_TYPES.postedAt);
    if (postedAt) normalized.postedAt = postedAt;

    return normalized;
}

function normalizeMapping(
    value: unknown,
    fallbackType: NotionPropertyMapping['propertyType']
): NotionPropertyMapping | undefined {
    if (typeof value === 'string') {
        const propertyName = value.trim();
        if (!propertyName) return undefined;
        return {
            propertyName,
            propertyType: fallbackType
        };
    }

    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const raw = value as JsonObject;
    if (typeof raw.propertyName !== 'string') return undefined;
    const propertyName = raw.propertyName.trim();
    if (!propertyName) return undefined;
    const propertyType = normalizePropertyType(raw.propertyType, fallbackType);

    return {
        propertyName,
        propertyType
    };
}

function normalizePropertyType(
    value: unknown,
    fallbackType: NotionPropertyMapping['propertyType']
): NotionPropertyMapping['propertyType'] {
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
    return fallbackType;
}

function applyMappedProperty(
    properties: Record<string, unknown>,
    mapping: NotionPropertyMapping | undefined,
    rawValue: string
) {
    if (!mapping) return;
    const propertyName = mapping.propertyName?.trim();
    const value = rawValue?.trim();
    if (!propertyName || !value) return;

    switch (mapping.propertyType) {
        case 'title':
            properties[propertyName] = {
                title: [{ text: { content: value } }]
            };
            return;
        case 'rich_text':
            properties[propertyName] = {
                rich_text: [{ text: { content: value } }]
            };
            return;
        case 'select':
            properties[propertyName] = {
                select: { name: value }
            };
            return;
        case 'multi_select':
            properties[propertyName] = {
                multi_select: [{ name: value }]
            };
            return;
        case 'url':
            if (!isValidUrl(value)) {
                throw new Error(`URL 型に無効な値を設定しようとしました: ${propertyName}`);
            }
            properties[propertyName] = {
                url: value
            };
            return;
        case 'date': {
            const isoDate = normalizeDateValue(value);
            if (!isoDate) {
                throw new Error(`date 型に変換できない値です: ${propertyName}`);
            }
            properties[propertyName] = {
                date: {
                    start: isoDate
                }
            };
        }
    }
}

function isValidUrl(value: string) {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

function normalizeDateValue(value: string) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString();
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
        children.push(...buildTextParagraphBlocks(payload.text));
    }

    const assetMap = new Map(
        mediaAssets.map((asset) => [asset.sourceUrl, asset])
    );
    const usedSources = new Set<string>();

    if (Array.isArray(payload.images) && payload.images.length > 0) {
        // keep Notion children aligned with the extracted order, falling back to external URLs if downloads failed
        for (const originalUrl of payload.images) {
            if (!originalUrl) continue;
            if (isVideoUrl(originalUrl)) {
                children.push({
                    object: 'block',
                    type: 'embed',
                    embed: {
                        url: originalUrl
                    }
                });
                continue;
            }
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

function buildTextParagraphBlocks(text: string) {
    return text.split('\n').map((line) => ({
        object: 'block',
        type: 'paragraph',
        paragraph: {
            rich_text: line ? buildParagraphRichText(line) : []
        }
    }));
}

export function buildParagraphRichText(text: string) {
    const richText: NotionRichTextItem[] = [];
    const urlPattern = /https?:\/\/[^\s]+|(?:www\.[^\s]+|(?<![@\w])[a-z0-9.-]+\.[a-z]{2,}[^\s]*)/gi;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = urlPattern.exec(text)) !== null) {
        const [rawUrl] = match;
        const start = match.index;
        const end = start + rawUrl.length;

        if (start > cursor) {
            richText.push({
                type: 'text',
                text: {
                    content: text.slice(cursor, start)
                }
            });
        }

        const normalizedUrl = normalizeLinkTarget(rawUrl);
        richText.push({
            type: 'text',
            text: {
                content: rawUrl,
                link: normalizedUrl ? { url: normalizedUrl } : null
            }
        });
        cursor = end;
    }

    if (cursor < text.length) {
        richText.push({
            type: 'text',
            text: {
                content: text.slice(cursor)
            }
        });
    }

    if (richText.length === 0) {
        return [
            {
                type: 'text' as const,
                text: {
                    content: text
                }
            }
        ];
    }

    return richText;
}

function normalizeLinkTarget(rawUrl: string) {
    const cleaned = rawUrl.replace(/[)\]}>,.!?;:、。！？…]+$/gu, '');
    if (/^https?:\/\//i.test(cleaned)) {
        return isValidUrl(cleaned) ? cleaned : null;
    }
    const withScheme = `https://${cleaned}`;
    return isValidUrl(withScheme) ? withScheme : null;
}

function isVideoUrl(url: string) {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        return /\.(mp4|mov|m4v|webm|ogv)$/i.test(pathname);
    } catch {
        return false;
    }
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
        parent: { data_source_id: databaseId },
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
        let parsed: JsonObject = {};
        try {
            const maybeParsed: unknown = detail ? JSON.parse(detail) : {};
            parsed = isJsonObject(maybeParsed) ? maybeParsed : {};
        } catch {
            // If detail is not valid JSON (e.g., HTML error page), treat as empty object
            parsed = {};
        }
        if (response.status === 404 || parsed.code === 'object_not_found') {
            throw new Error('Notion の保存先が見つかりません。データベース/データソースを integration に共有しているか確認してください。');
        } else if (response.status === 401 || response.status === 403) {
            throw new Error('Notion API キーが無効か権限が不足しています。Options で API キーと DB 共有を確認してください。');
        } else {
            throw new Error(`Notion ページの作成に失敗しました（HTTP ${response.status}）: ${detail}`);
        }
    }
}
