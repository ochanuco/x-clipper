import type { BrowserContext, Page } from '@playwright/test';

export async function keepServiceWorkerAlive(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#e2e-keep-alive`);
  await page.evaluate(() => {
    const globalScope = globalThis as Record<string, unknown>;
    if (!globalScope.__xClipperKeepAlivePort) {
      globalScope.__xClipperKeepAlivePort = chrome.runtime.connect({
        name: 'x-clipper-e2e-keep-alive'
      });
    }
  });
  return page;
}
