import { getSettings, saveSettings } from './settings.js';
import type { AppSettings } from './types.js';

// IndexedDB settings must match background.ts
const IDB_DB_NAME = 'x-clipper-cache';
const IDB_STORE_NAME = 'assets';

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

async function listPendingMedia(): Promise<Array<{ fileName: string; createdAt?: number; meta?: Record<string, unknown> }>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}


const form = document.getElementById('options-form') as HTMLFormElement | null;
const statusField = document.getElementById('status');

async function hydrateForm() {
  if (!form) {
    return;
  }

  const settings = await getSettings();

  const notionApiKeyInput = document.getElementById('notionApiKey') as HTMLInputElement | null;
  const notionDatabaseIdInput = document.getElementById('notionDatabaseId') as HTMLInputElement | null;
  const notionVersionInput = document.getElementById('notionVersion') as HTMLInputElement | null;
  const titleInput = document.getElementById('titleProperty') as HTMLInputElement | null;
  const screenNameInput = document.getElementById('screenNameProperty') as HTMLInputElement | null;
  const userNameInput = document.getElementById('userNameProperty') as HTMLInputElement | null;
  const urlInput = document.getElementById('urlProperty') as HTMLInputElement | null;
  const timestampInput = document.getElementById('timestampProperty') as HTMLInputElement | null;

  if (notionApiKeyInput) {
    notionApiKeyInput.value = settings.notionApiKey;
  }
  if (notionDatabaseIdInput) {
    notionDatabaseIdInput.value = settings.notionDatabaseId;
  }
  if (notionVersionInput) {
    notionVersionInput.value = settings.notionVersion;
  }
  if (titleInput) {
    titleInput.value = settings.propertyMap.title;
  }
  if (screenNameInput) {
    screenNameInput.value = settings.propertyMap.screenName;
  }
  if (userNameInput) {
    userNameInput.value = settings.propertyMap.userName;
  }
  if (urlInput) {
    urlInput.value = settings.propertyMap.tweetUrl;
  }
  if (timestampInput) {
    timestampInput.value = settings.propertyMap.postedAt;
  }
}

function setStatus(message: string, isError = false) {
  if (statusField) {
    statusField.textContent = message;
    statusField.style.color = isError ? '#dc2626' : '#059669';
  }
}

async function handleSubmit(event: Event) {
  event.preventDefault();
  if (!form) {
    return;
  }

  setStatus('保存中...', false);

  const formData = new FormData(form);
  const notionApiKey = String(formData.get('notionApiKey') ?? '').trim();
  const notionDatabaseId = String(formData.get('notionDatabaseId') ?? '').trim();
  const notionVersion = String(formData.get('notionVersion') ?? '').trim();

  const propertyMap = {
    title: String(formData.get('titleProperty') ?? '').trim(),
    screenName: String(formData.get('screenNameProperty') ?? '').trim(),
    userName: String(formData.get('userNameProperty') ?? '').trim(),
    tweetUrl: String(formData.get('urlProperty') ?? '').trim(),
    postedAt: String(formData.get('timestampProperty') ?? '').trim()
  };

  if (!notionApiKey) {
    setStatus('Notion API キーを入力してください。', true);
    return;
  }

  if (!notionDatabaseId) {
    setStatus('Notion データベース ID を入力してください。', true);
    return;
  }

  if (!/^[a-f0-9-]{32,36}$/i.test(notionDatabaseId)) {
    setStatus('Notion データベース ID の形式が正しくありません。', true);
    return;
  }

  if (!notionVersion) {
    setStatus('Notion API バージョンを入力してください。', true);
    return;
  }

  const settings: AppSettings = {
    notionApiKey,
    notionDatabaseId,
    notionVersion,
    propertyMap
  };

  try {
    // Validate database access before saving settings
    await validateNotionDatabase(notionApiKey, notionDatabaseId, notionVersion);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(message, true);
    return;
  }

  try {
    await saveSettings(settings);
    setStatus('保存しました。');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '保存中にエラーが発生しました。';
    setStatus(message, true);
  }
}

const NOTION_API_URL = 'https://api.notion.com/v1';

function normalizeDatabaseIdLocal(input: string) {
  const trimmed = input.trim();
  const match =
    trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i) ??
    trimmed.match(/[a-f0-9]{32}/i);
  if (!match) throw new Error('Notion データベース ID の形式が正しくありません。');
  return match[0].replace(/-/g, '');
}

async function validateNotionDatabase(apiKey: string, databaseId: string, notionVersion: string) {
  if (!apiKey) throw new Error('Notion API キーを入力してください。');
  if (!databaseId) throw new Error('Notion データベース ID を入力してください。');
  const compact = normalizeDatabaseIdLocal(databaseId);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Notion-Version': notionVersion || '2025-09-03'
  };

  const res = await fetch(`${NOTION_API_URL}/databases/${compact}`, { method: 'GET', headers });
  if (res.ok) return true;

  let body = '';
  try {
    const j = await res.json();
    body = JSON.stringify(j);
    if (res.status === 404) {
      throw new Error('Notion のデータベースが見つかりません。対象データベースが integration に共有されているか確認してください。');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('Notion API キーが無効か、権限が不足しています。API キーと integration の共有設定を確認してください。');
    }
    throw new Error(`Notion への接続でエラーが発生しました（HTTP ${res.status}）: ${body}`);
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error('Notion の検証中に不明なエラーが発生しました。');
  }
}

if (form) {
  form.addEventListener('submit', handleSubmit);
  void hydrateForm();
}

// Persist and hydrate cache TTL setting
const cacheTtlInput = document.getElementById('cacheTtlDays') as HTMLInputElement | null;
const pendingContainer = document.getElementById('pending-media') as HTMLElement | null;

async function hydrateCacheSettings() {
  try {
    const data = await new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.local.get(['cacheTtlDays'], (res) => resolve(res));
    });
    const value = (data['cacheTtlDays'] as number) ?? 7;
    if (cacheTtlInput) cacheTtlInput.value = String(value);
  } catch (err) {
    console.warn('failed to hydrate cache settings', err);
  }
}

async function saveCacheSettings() {
  const days = cacheTtlInput ? Math.max(1, Number(cacheTtlInput.value) || 7) : 7;
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.set({ cacheTtlDays: days }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

async function renderPendingMedia() {
  if (!pendingContainer) return;
  pendingContainer.innerHTML = '';
  try {
    const items = await listPendingMedia();
    if (items.length === 0) {
      pendingContainer.innerHTML = '<p class="helper">未送信メディアはありません。</p>';
      return;
    }

    for (const item of items) {
      const el = document.createElement('div');
      el.style.marginBottom = '12px';
      const created = item.createdAt ? new Date(item.createdAt).toLocaleString() : '不明';
      el.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center">
          <div style="flex:1">
            <div style="font-weight:600">${item.fileName}</div>
            <div class="helper">保存日時: ${created}</div>
          </div>
          <div style="width:160px;display:flex;gap:8px">
            <button data-action="reupload" data-filename="${item.fileName}">再送信</button>
            <button data-action="delete" data-filename="${item.fileName}">削除</button>
          </div>
        </div>
      `;
      pendingContainer.appendChild(el);
    }

    // attach handlers
    pendingContainer.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        const target = ev.currentTarget as HTMLButtonElement;
        const action = target.getAttribute('data-action');
        const fileName = target.getAttribute('data-filename') ?? '';
        if (action === 'delete') {
          try {
            const db = await openDb();
            const tx = db.transaction('assets', 'readwrite');
            tx.objectStore('assets').delete(fileName);
            await new Promise((res) => (tx.oncomplete = () => res(undefined)));
            void renderPendingMedia();
          } catch (err) {
            console.warn('failed to delete cached asset from options', err);
          }
        } else if (action === 'reupload') {
          try {
            // ask background to reupload
            chrome.runtime.sendMessage({ type: 'REUPLOAD_ASSET', fileName }, (resp) => {
              // ignore response for now
              void renderPendingMedia();
            });
          } catch (err) {
            console.warn('failed to request reupload', err);
          }
        }
      });
    });
  } catch (err) {
    pendingContainer.innerHTML = '<p class="helper">未送信メディアの読み込みに失敗しました。</p>';
    console.warn('failed to render pending media', err);
  }
}

// wire saving cache TTL on main form submit
const origSubmit = form?.addEventListener.bind(form, 'submit');
if (form && origSubmit) {
  form.addEventListener('submit', async (ev) => {
    await saveCacheSettings();
  });
}

void hydrateCacheSettings();
void renderPendingMedia();
