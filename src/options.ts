import { getSettings, saveSettings } from './settings.js';
import type { AppSettings } from './types.js';

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
