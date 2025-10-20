import { getSettings, parseDatabaseIdFromUrl, saveSettings } from './settings.js';
import type { NotionSettings } from './types.js';

const form = document.getElementById('options-form') as HTMLFormElement | null;
const statusField = document.getElementById('status');

async function hydrateForm() {
  if (!form) {
    return;
  }

  const settings = await getSettings();

  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
  const databaseUrlInput = document.getElementById('databaseUrl') as HTMLInputElement | null;
  const titleInput = document.getElementById('titleProperty') as HTMLInputElement | null;
  const screenNameInput = document.getElementById('screenNameProperty') as HTMLInputElement | null;
  const userNameInput = document.getElementById('userNameProperty') as HTMLInputElement | null;
  const urlInput = document.getElementById('urlProperty') as HTMLInputElement | null;
  const timestampInput = document.getElementById('timestampProperty') as HTMLInputElement | null;

  if (apiKeyInput) {
    apiKeyInput.value = settings.notionApiKey;
  }
  if (databaseUrlInput) {
    databaseUrlInput.value = settings.notionDatabaseUrl;
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
  const notionApiKey = String(formData.get('apiKey') ?? '').trim();
  const notionDatabaseUrl = String(formData.get('databaseUrl') ?? '').trim();
  const notionDatabaseId = parseDatabaseIdFromUrl(notionDatabaseUrl);

  const isSupportedToken =
    notionApiKey.startsWith('secret_') || notionApiKey.startsWith('ntn_');

  if (!isSupportedToken) {
    setStatus('Notion API キーは secret_ または ntn_ で始まる値を入力してください。', true);
    return;
  }

  if (!notionDatabaseId) {
    setStatus('データベース URL から ID を抽出できませんでした。URL を確認してください。', true);
    return;
  }

  const propertyMap = {
    title: String(formData.get('titleProperty') ?? '').trim(),
    screenName: String(formData.get('screenNameProperty') ?? '').trim(),
    userName: String(formData.get('userNameProperty') ?? '').trim(),
    tweetUrl: String(formData.get('urlProperty') ?? '').trim(),
    postedAt: String(formData.get('timestampProperty') ?? '').trim()
  };

  const settings: NotionSettings = {
    notionApiKey,
    notionDatabaseUrl,
    notionDatabaseId,
    propertyMap
  };

  try {
    await saveSettings(settings);
    setStatus('保存しました。');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '保存中にエラーが発生しました。';
    setStatus(message, true);
  }
}

if (form) {
  form.addEventListener('submit', handleSubmit);
  void hydrateForm();
}
