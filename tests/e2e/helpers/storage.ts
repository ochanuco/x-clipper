import type { Worker } from '@playwright/test';

const STORAGE_KEY = 'notionSettings';

export async function seedSettings(worker: Worker, settings: Record<string, unknown>) {
  await worker.evaluate(
    ({ storageKey, value }) =>
      new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [storageKey]: value }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      }),
    { storageKey: STORAGE_KEY, value: settings }
  );
}
