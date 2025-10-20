import { getSettings, saveSettings } from './settings.js';
import type { AppSettings } from './types.js';

const form = document.getElementById('options-form') as HTMLFormElement | null;
const statusField = document.getElementById('status');

async function hydrateForm() {
  if (!form) {
    return;
  }

  const settings = await getSettings();

  const backendEndpointInput = document.getElementById('backendEndpoint') as HTMLInputElement | null;
  const backendAuthTokenInput = document.getElementById('backendAuthToken') as HTMLInputElement | null;
  const titleInput = document.getElementById('titleProperty') as HTMLInputElement | null;
  const screenNameInput = document.getElementById('screenNameProperty') as HTMLInputElement | null;
  const userNameInput = document.getElementById('userNameProperty') as HTMLInputElement | null;
  const urlInput = document.getElementById('urlProperty') as HTMLInputElement | null;
  const timestampInput = document.getElementById('timestampProperty') as HTMLInputElement | null;

  if (backendEndpointInput) {
    backendEndpointInput.value = settings.backendEndpoint;
  }
  if (backendAuthTokenInput) {
    backendAuthTokenInput.value = settings.backendAuthToken;
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
  const backendEndpoint = String(formData.get('backendEndpoint') ?? '').trim();
  const backendAuthToken = String(formData.get('backendAuthToken') ?? '').trim();

  const propertyMap = {
    title: String(formData.get('titleProperty') ?? '').trim(),
    screenName: String(formData.get('screenNameProperty') ?? '').trim(),
    userName: String(formData.get('userNameProperty') ?? '').trim(),
    tweetUrl: String(formData.get('urlProperty') ?? '').trim(),
    postedAt: String(formData.get('timestampProperty') ?? '').trim()
  };

  if (!backendEndpoint) {
    setStatus('バックエンドのエンドポイント URL を入力してください。', true);
    return;
  }

  try {
    // eslint-disable-next-line no-new
    new URL(backendEndpoint);
  } catch {
    setStatus('バックエンドのエンドポイント URL が不正です。', true);
    return;
  }

  const settings: AppSettings = {
    backendEndpoint,
    backendAuthToken,
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
