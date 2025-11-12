import type { Worker } from '@playwright/test';

const NOTION_PAGES_KEY = '__xClipperNotionPages';

export async function mockNotionApi(worker: Worker) {
  await worker.evaluate(({ pagesKey }) => {
    const notionPages: Array<Record<string, unknown>> = [];
    (globalThis as Record<string, unknown>)[pagesKey] = notionPages;

    const jsonResponse = (body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });

    const originalFetch = fetch.bind(globalThis);

    globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      try {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input?.url ?? '';
        const method = (init.method ?? 'GET').toUpperCase();

        if (!url) {
          return originalFetch(input, init);
        }

        if (url === 'https://api.notion.com/v1/file_uploads' && method === 'POST') {
          const id =
            typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `upload_${Date.now()}`;
          return jsonResponse({ id });
        }

        const sendMatch = url.match(
          /^https:\/\/api\.notion\.com\/v1\/file_uploads\/([^/]+)\/send$/
        );
        if (sendMatch && method === 'POST') {
          const uploadId = sendMatch[1];
          return jsonResponse({
            id: uploadId,
            status: 'uploaded',
            filename: `${uploadId}.png`,
            content_type: 'image/png'
          });
        }

        if (url === 'https://api.notion.com/v1/pages' && method === 'POST') {
          let parsed: Record<string, unknown> = {};
          if (typeof init.body === 'string') {
            try {
              parsed = JSON.parse(init.body);
            } catch {
              parsed = {};
            }
          }
          notionPages.push(parsed);
          return jsonResponse({ id: 'mock-page-id' });
        }
      } catch (error) {
        console.warn('mockNotionApi fetch error', error);
      }

      return originalFetch(input, init);
    };
  }, { pagesKey: NOTION_PAGES_KEY });
}

export async function getNotionPages(worker: Worker) {
  return worker.evaluate(({ pagesKey }) => {
    const stored = (globalThis as Record<string, unknown>)[pagesKey];
    return (Array.isArray(stored) ? stored : []) as Array<Record<string, unknown>>;
  }, { pagesKey: NOTION_PAGES_KEY });
}
