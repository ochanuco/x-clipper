import { getSettings, saveSettings } from './settings.js';
import type {
  AppSettings,
  NotionPropertyMap,
  NotionPropertyMapping,
  NotionPropertyType
} from './types.js';

const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03';

type MappingKey = keyof NotionPropertyMap;

type NotionDatabaseProperty = {
  type: NotionPropertyType | string;
};

type NotionDatabaseSchema = Record<string, NotionDatabaseProperty>;

type NotionDatabaseItem = {
  id: string;
  title: string;
};

const typeLabel: Record<NotionPropertyType, string> = {
  title: 'title',
  rich_text: 'text',
  select: 'select',
  multi_select: 'multi_select',
  url: 'url',
  date: 'date'
};

const mappingSelectIds: Record<MappingKey, string> = {
  title: 'mapTitle',
  screenName: 'mapScreenName',
  userName: 'mapUserName',
  tweetUrl: 'mapTweetUrl',
  postedAt: 'mapPostedAt'
};

const allowedTypesByField: Record<MappingKey, NotionPropertyType[]> = {
  title: ['title', 'rich_text', 'select', 'multi_select', 'url', 'date'],
  screenName: ['rich_text', 'select', 'multi_select', 'url', 'date'],
  userName: ['rich_text', 'select', 'multi_select', 'url', 'date'],
  tweetUrl: ['rich_text', 'select', 'multi_select', 'url', 'date'],
  postedAt: ['rich_text', 'select', 'multi_select', 'url', 'date']
};

const form = document.getElementById('options-form') as HTMLFormElement | null;
const statusField = document.getElementById('status') as HTMLParagraphElement | null;
const loadDatabasesButton = document.getElementById('loadDatabasesButton') as HTMLButtonElement | null;
const databaseSelect = document.getElementById('notionDatabaseId') as HTMLSelectElement | null;

let currentDatabaseSchema: NotionDatabaseSchema = {};
let currentDatabaseSchemaSourceId = '';
let currentDatabases: NotionDatabaseItem[] = [];
let pendingSettings: AppSettings | null = null;
let schemaLoadGeneration = 0;
let databaseLoadGeneration = 0;

class NotionApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Notion API エラー（HTTP ${status}）: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

function setStatus(message: string, isError = false) {
  if (!statusField) return;
  statusField.textContent = message;
  statusField.style.color = isError ? '#dc2626' : '#059669';
}

function getInputValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el?.value.trim() ?? '';
}

function getMappingSelect(key: MappingKey): HTMLSelectElement | null {
  const id = mappingSelectIds[key];
  return document.getElementById(id) as HTMLSelectElement | null;
}

function isSupportedPropertyType(value: unknown): value is NotionPropertyType {
  return (
    value === 'title' ||
    value === 'rich_text' ||
    value === 'select' ||
    value === 'multi_select' ||
    value === 'url' ||
    value === 'date'
  );
}

function normalizeDatabaseIdLocal(input: string): string {
  const trimmed = input.trim();
  const match =
    trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i) ??
    trimmed.match(/[a-f0-9]{32}/i);
  if (!match) {
    throw new Error('Notion データベース ID の形式が正しくありません。');
  }
  return match[0].replace(/-/g, '');
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  };
}

async function notionApiRequest(path: string, init: RequestInit, apiKey: string) {
  const res = await fetch(`${NOTION_API_URL}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(apiKey),
      ...(init.headers ?? {})
    }
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Notion API キーが無効か、権限が不足しています。');
    }
    throw new NotionApiError(res.status, json);
  }

  return json;
}

function extractTitle(database: Record<string, unknown>): string {
  const title = database.title;
  if (!Array.isArray(title)) {
    return 'Untitled';
  }
  const plain = title
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      return String((item as Record<string, unknown>).plain_text ?? '');
    })
    .join('')
    .trim();

  return plain || 'Untitled';
}

async function fetchDatabases(apiKey: string): Promise<NotionDatabaseItem[]> {
  let searchObjectType: 'data_source' | 'database' = 'data_source';
  const databases: NotionDatabaseItem[] = [];
  let cursor: string | undefined;

  for (let i = 0; i < 10; i += 1) {
    const body: Record<string, unknown> = {
      page_size: 100,
      filter: {
        property: 'object',
        value: searchObjectType
      }
    };

    if (cursor) {
      body.start_cursor = cursor;
    }

    let json: Record<string, unknown>;
    try {
      json = (await notionApiRequest(
        '/search',
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        apiKey
      )) as Record<string, unknown>;
    } catch (error) {
      if (
        error instanceof NotionApiError &&
        error.status === 400 &&
        searchObjectType === 'data_source'
      ) {
        const message = String((error.body as Record<string, unknown> | null)?.message ?? '');
        if (message.includes('body.filter.value')) {
          searchObjectType = 'database';
          i = -1;
          cursor = undefined;
          databases.length = 0;
          continue;
        }
      }
      throw error;
    }

    const results = Array.isArray(json.results) ? json.results : [];
    for (const result of results) {
      if (!result || typeof result !== 'object') continue;
      const db = result as Record<string, unknown>;
      if (db.object !== searchObjectType) continue;

      const rawId = String(db.id ?? '');
      if (!rawId) continue;

      databases.push({
        id: normalizeDatabaseIdLocal(rawId),
        title: extractTitle(db)
      });
    }

    const hasMore = Boolean(json.has_more);
    const nextCursor = typeof json.next_cursor === 'string' ? json.next_cursor : undefined;
    if (!hasMore || !nextCursor) {
      break;
    }
    cursor = nextCursor;
  }

  return databases;
}

async function fetchDatabaseSchema(
  apiKey: string,
  databaseId: string
): Promise<NotionDatabaseSchema> {
  const compactId = normalizeDatabaseIdLocal(databaseId);
  let json: Record<string, unknown> | null = null;

  try {
    json = (await notionApiRequest(
      `/data_sources/${compactId}`,
      { method: 'GET' },
      apiKey
    )) as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof NotionApiError) || error.status !== 404) {
      const message = String(
        (error instanceof NotionApiError ? (error.body as Record<string, unknown>)?.message : '') ?? ''
      );
      if (!(error instanceof NotionApiError && error.status === 400 && message.includes('path failed validation'))) {
        throw error;
      }
    }
  }

  if (!json) {
    json = (await notionApiRequest(
      `/databases/${compactId}`,
      { method: 'GET' },
      apiKey
    )) as Record<string, unknown>;
  }

  const properties = json.properties;
  if (!properties || typeof properties !== 'object') {
    throw new Error('データベースのスキーマ取得に失敗しました。');
  }

  return properties as NotionDatabaseSchema;
}

function encodeMappingValue(mapping: NotionPropertyMapping): string {
  return JSON.stringify(mapping);
}

function decodeMappingValue(value: string): NotionPropertyMapping | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const propertyName = String(parsed.propertyName ?? '').trim();
    const propertyType = parsed.propertyType;
    if (!propertyName || !isSupportedPropertyType(propertyType)) return null;

    return {
      propertyName,
      propertyType
    };
  } catch {
    return null;
  }
}

function getSchemaOptionsForField(field: MappingKey, schema: NotionDatabaseSchema) {
  const allowedTypes = new Set(allowedTypesByField[field]);

  return Object.entries(schema)
    .filter(([, prop]) => isSupportedPropertyType(prop.type) && allowedTypes.has(prop.type))
    .map(([propertyName, prop]) => ({
      propertyName,
      propertyType: prop.type as NotionPropertyType
    }));
}

function populateMappingSelect(field: MappingKey, preferred?: NotionPropertyMapping) {
  const select = getMappingSelect(field);
  if (!select) return;

  const options = getSchemaOptionsForField(field, currentDatabaseSchema);

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = options.length > 0 ? '選択してください' : '利用可能なプロパティがありません';
  select.innerHTML = '';
  select.appendChild(placeholder);

  for (const option of options) {
    const el = document.createElement('option');
    el.value = encodeMappingValue(option);
    el.textContent = `${option.propertyName} (${typeLabel[option.propertyType]})`;
    select.appendChild(el);
  }

  if (preferred) {
    const encoded = encodeMappingValue(preferred);
    const exists = options.some(
      (opt) => opt.propertyName === preferred.propertyName && opt.propertyType === preferred.propertyType
    );
    select.value = exists ? encoded : '';
  } else {
    select.value = '';
  }
}

function populateAllMappingSelects(preferredMap?: NotionPropertyMap) {
  populateMappingSelect('title', preferredMap?.title);
  populateMappingSelect('screenName', preferredMap?.screenName);
  populateMappingSelect('userName', preferredMap?.userName);
  populateMappingSelect('tweetUrl', preferredMap?.tweetUrl);
  populateMappingSelect('postedAt', preferredMap?.postedAt);
}

function populateDatabaseSelect(databases: NotionDatabaseItem[], selectedId = '') {
  if (!databaseSelect) return;

  databaseSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent =
    databases.length > 0 ? 'データベースを選択してください' : '共有済みデータベースが見つかりません';
  databaseSelect.appendChild(placeholder);

  for (const database of databases) {
    const option = document.createElement('option');
    option.value = database.id;
    option.textContent = `${database.title} (${database.id})`;
    option.selected = database.id === selectedId;
    databaseSelect.appendChild(option);
  }

  if (!databases.some((database) => database.id === selectedId)) {
    databaseSelect.value = '';
  }
}

async function loadSchemaForSelectedDatabase(preferredMap?: NotionPropertyMap) {
  const myGeneration = ++schemaLoadGeneration;
  const apiKey = getInputValue('notionApiKey');
  const selectedDatabaseId = databaseSelect?.value.trim() ?? '';

  if (!apiKey || !selectedDatabaseId) {
    currentDatabaseSchema = {};
    currentDatabaseSchemaSourceId = '';
    populateAllMappingSelects();
    return;
  }

  const schema = await fetchDatabaseSchema(apiKey, selectedDatabaseId);
  if (myGeneration !== schemaLoadGeneration) {
    return;
  }
  currentDatabaseSchema = schema;
  currentDatabaseSchemaSourceId = selectedDatabaseId;
  populateAllMappingSelects(preferredMap);
}

async function loadDatabases() {
  const myGeneration = ++databaseLoadGeneration;
  const apiKey = getInputValue('notionApiKey');
  if (!apiKey) {
    setStatus('Notion API キーを入力してください。', true);
    return;
  }

  if (loadDatabasesButton) {
    loadDatabasesButton.disabled = true;
  }
  setStatus('データベース一覧を取得しています...');

  try {
    const databases = await fetchDatabases(apiKey);
    if (myGeneration !== databaseLoadGeneration) {
      return;
    }

    currentDatabases = databases;
    populateDatabaseSelect(currentDatabases, pendingSettings?.notionDatabaseId ?? '');

    if (databaseSelect?.value) {
      await loadSchemaForSelectedDatabase(pendingSettings?.propertyMap);
    } else {
      currentDatabaseSchema = {};
      currentDatabaseSchemaSourceId = '';
      populateAllMappingSelects();
    }

    setStatus(
      currentDatabases.length > 0
        ? `${currentDatabases.length} 件のデータベースを取得しました。`
        : '利用可能なデータベースがありません。'
    );
  } catch (error) {
    if (myGeneration !== databaseLoadGeneration) {
      return;
    }
    const message = error instanceof Error ? error.message : 'データベース一覧の取得に失敗しました。';
    setStatus(message, true);
  } finally {
    if (myGeneration === databaseLoadGeneration && loadDatabasesButton) {
      loadDatabasesButton.disabled = false;
    }
  }
}

function validateAndCollectMapping(field: MappingKey): NotionPropertyMapping {
  const select = getMappingSelect(field);
  const mapping = decodeMappingValue(select?.value ?? '');
  if (!mapping) {
    throw new Error('すべてのプロパティマッピングを選択してください。');
  }

  const schemaProp = currentDatabaseSchema[mapping.propertyName];
  if (!schemaProp) {
    throw new Error(`選択したプロパティがDBに存在しません: ${mapping.propertyName}`);
  }

  if (schemaProp.type !== mapping.propertyType) {
    throw new Error(
      `選択したプロパティの型が一致しません: ${mapping.propertyName} (${schemaProp.type})`
    );
  }

  if (!allowedTypesByField[field].includes(mapping.propertyType)) {
    throw new Error(`この項目には選択できない型です: ${mapping.propertyType}`);
  }

  return mapping;
}

async function handleSubmit(event: Event) {
  event.preventDefault();

  const notionApiKey = getInputValue('notionApiKey');
  const notionDatabaseId = databaseSelect?.value?.trim() ?? '';

  if (!notionApiKey) {
    setStatus('Notion API キーを入力してください。', true);
    return;
  }

  if (!notionDatabaseId) {
    setStatus('Notion データベースを選択してください。', true);
    return;
  }

  try {
    const hasSchemaForSelectedDatabase =
      Object.keys(currentDatabaseSchema).length > 0 &&
      currentDatabaseSchemaSourceId === notionDatabaseId;
    if (!hasSchemaForSelectedDatabase) {
      await loadSchemaForSelectedDatabase();
    }
    if (currentDatabaseSchemaSourceId !== notionDatabaseId) {
      throw new Error('選択中のデータベースに対応するスキーマを取得できませんでした。');
    }

    const propertyMap: NotionPropertyMap = {
      title: validateAndCollectMapping('title'),
      screenName: validateAndCollectMapping('screenName'),
      userName: validateAndCollectMapping('userName'),
      tweetUrl: validateAndCollectMapping('tweetUrl'),
      postedAt: validateAndCollectMapping('postedAt')
    };

    const settings: AppSettings = {
      notionApiKey,
      notionDatabaseId,
      propertyMap
    };

    await saveSettings(settings);
    pendingSettings = cloneSettings(settings);
    setStatus('設定を保存しました。');
  } catch (error) {
    const message = error instanceof Error ? error.message : '設定の保存に失敗しました。';
    setStatus(message, true);
  }
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    notionApiKey: settings.notionApiKey,
    notionDatabaseId: settings.notionDatabaseId,
    propertyMap: {
      title: { ...settings.propertyMap.title },
      screenName: { ...settings.propertyMap.screenName },
      userName: { ...settings.propertyMap.userName },
      tweetUrl: { ...settings.propertyMap.tweetUrl },
      postedAt: { ...settings.propertyMap.postedAt }
    }
  };
}

async function initialize() {
  const settings = await getSettings();
  pendingSettings = cloneSettings(settings);

  const apiKeyInput = document.getElementById('notionApiKey') as HTMLInputElement | null;
  if (apiKeyInput) {
    apiKeyInput.value = settings.notionApiKey;
  }

  populateDatabaseSelect([], settings.notionDatabaseId);
  populateAllMappingSelects(settings.propertyMap);

  if (settings.notionApiKey) {
    try {
      await loadDatabases();
      setStatus('保存済み設定を読み込みました。');
    } catch {
      setStatus('保存済み設定を読み込みました。DB一覧は再取得してください。');
    }
  }
}

loadDatabasesButton?.addEventListener('click', () => {
  void loadDatabases();
});

databaseSelect?.addEventListener('change', () => {
  void (async () => {
    try {
      setStatus('データベースのスキーマを取得しています...');
      await loadSchemaForSelectedDatabase(pendingSettings?.propertyMap);
      setStatus('データベースのスキーマを取得しました。');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'データベースのスキーマ取得に失敗しました。';
      setStatus(message, true);
    }
  })();
});

form?.addEventListener('submit', (event) => {
  void handleSubmit(event);
});

void initialize();
