import type { DownloadedAsset } from '../types.js';
import { saveToCache } from '../domain/storage/cache.js';

const MAX_DIRECT_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function downloadAsset(url: string, label: string): Promise<DownloadedAsset> {
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
