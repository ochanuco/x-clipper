import type { BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type OfflineTweetAssets = {
    tweetHtml: string;
    avatarBuffer: Buffer;
    mediaBuffer: Buffer;
    fixtureDir?: string; // SingleFileで保存されたHTMLのディレクトリ(画像も含む)
};

export async function serveOfflineTweet(
    context: BrowserContext,
    { tweetHtml, avatarBuffer, mediaBuffer, fixtureDir }: OfflineTweetAssets
) {
    // 実サイトの追加リクエストがCIで遅延しないよう、必要ドメイン以外は即座に捨てる
    await context.route(/^(?!https:\/\/(?:x\.com|pbs\.twimg\.com)\/).*/, (route) =>
        route.fulfill({ status: 204, body: '' })
    );

    await context.route('https://x.com/**', (route) => {
        const url = route.request().url();

        // SingleFileの画像パス(例: https://x.com/images/18.jpg)を処理
        if (fixtureDir && url.includes('/images/')) {
            const imageName = url.split(/\/images\//)[1];
            const imagePath = path.join(fixtureDir, 'images', imageName);
            try {
                const imageBuffer = readFileSync(imagePath);
                return route.fulfill({
                    status: 200,
                    body: imageBuffer,
                    headers: { 'content-type': 'image/jpeg' }
                });
            } catch (error) {
                console.error(`Failed to load image: ${imagePath}`, error);
                return route.fulfill({ status: 404, body: '' });
            }
        }

        // 通常のHTMLレスポンス
        return route.fulfill({
            status: 200,
            body: tweetHtml,
            headers: { 'content-type': 'text/html; charset=utf-8' }
        });
    });

    await context.route('https://pbs.twimg.com/**', (route) => {
        const isAvatar = route.request().url().includes('profile_images');
        const body = isAvatar ? avatarBuffer : mediaBuffer;
        return route.fulfill({
            status: 200,
            body,
            headers: { 'content-type': 'image/png' }
        });
    });
}
