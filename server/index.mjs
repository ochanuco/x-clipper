import dotenv from 'dotenv';
import { Client as NotionClient } from '@notionhq/client';
import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { extension as extensionFromMime, lookup as lookupMime } from 'mime-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

dotenv.config();
const serverEnvPath = path.join(__dirname, '.env');
const serverEnv = dotenv.config({ path: serverEnvPath });
if (serverEnv.error && serverEnv.error.code !== 'ENOENT') {
  throw serverEnv.error;
}

const app = express();
app.use(express.json({ limit: '2mb' }));

const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = normalizeDatabaseId(process.env.NOTION_DATABASE_ID);
const NOTION_VERSION = process.env.NOTION_VERSION ?? '2025-09-03';
const AUTH_TOKEN =
  process.env.X_CLIPPER_TOKEN ?? process.env.CLIP_NOTION_TOKEN;
const PORT = Number.parseInt(process.env.PORT ?? '8787', 10);
const ASSET_BASE_URL =
  process.env.ASSET_BASE_URL ?? `http://localhost:${PORT}`;

const DEFAULT_PROPERTY_MAP = {
  title: 'Name',
  screenName: 'Screen Name',
  userName: 'Username',
  tweetUrl: 'Tweet URL',
  postedAt: 'Posted At'
};

if (!NOTION_API_KEY) {
  throw new Error('NOTION_API_KEY is required');
}

if (!NOTION_DATABASE_ID) {
  throw new Error('NOTION_DATABASE_ID is required');
}

const notion = new NotionClient({
  auth: NOTION_API_KEY,
  notionVersion: NOTION_VERSION
});

await mkdir(uploadsDir, { recursive: true });
app.use(
  '/uploads',
  express.static(uploadsDir, {
    maxAge: '365d',
    immutable: true
  })
);

if (AUTH_TOKEN) {
  app.use((req, res, next) => {
    const authHeader = req.header('authorization');
    const expected = `Bearer ${AUTH_TOKEN}`;
    if (authHeader !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  });
}

app.post('/clip', async (req, res) => {
  try {
    const payload = normalizePayload(req.body);

    const avatarAsset = payload.avatarUrl
      ? await persistRemoteAsset({
          url: payload.avatarUrl,
          label: 'avatar'
        })
      : null;

    const mediaAssets = [];
    for (const [index, imageUrl] of payload.images.entries()) {
      try {
        const asset = await persistRemoteAsset({
          url: imageUrl,
          label: `media-${index + 1}`
        });
        mediaAssets.push(asset);
      } catch (error) {
        console.warn('Failed to persist media', imageUrl, error);
      }
    }

    const avatarUpload = avatarAsset
      ? await uploadAssetToNotion(avatarAsset)
      : null;
    if (avatarUpload) {
      avatarAsset.notionFileUpload = avatarUpload;
    }

    await Promise.all(
      mediaAssets.map(async (asset) => {
        const upload = await uploadAssetToNotion(asset);
        if (upload) {
          asset.notionFileUpload = upload;
        }
      })
    );

    const page = await createNotionPage({
      payload,
      avatarAsset,
      mediaAssets
    });

    res.json({
      ok: true,
      notionPageId: page.id,
      notionPageUrl: page.url
    });
  } catch (error) {
    console.error('clip handler failed', error);
    const status = error.statusCode ?? error.status ?? 500;
    const message =
      error instanceof Error ? error.message : 'Unexpected server error';
    res.status(status).json({ error: message });
  }
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(
    `X Clipper backend listening on http://localhost:${PORT} (asset base ${ASSET_BASE_URL})`
  );
});

function normalizePayload(body = {}) {
  const screenName = String(body.screenName ?? '').trim();
  const userName = String(body.userName ?? '').trim();
  const url = String(body.url ?? '').trim();

  if (!url) {
    throw Object.assign(new Error('Tweet URL is required'), { statusCode: 400 });
  }

  const propertyMap = {
    ...DEFAULT_PROPERTY_MAP,
    ...(body.propertyMap ?? {})
  };

  return {
    screenName,
    userName,
    text: String(body.text ?? '').trim(),
    timestamp: String(body.timestamp ?? '').trim(),
    avatarUrl: coerceUrl(body.avatarUrl),
    images: Array.isArray(body.images)
      ? body.images.map(coerceUrl).filter(Boolean)
      : [],
    url,
    propertyMap
  };
}

function normalizeDatabaseId(input) {
  if (!input) {
    throw new Error('NOTION_DATABASE_ID is required');
  }
  const trimmed = String(input).trim();
  const match =
    trimmed.match(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i
    ) ?? trimmed.match(/[a-f0-9]{32}/i);

  if (!match) {
    throw new Error(
      'NOTION_DATABASE_ID must be the database UUID (with or without hyphens) or a Notion database URL containing it.'
    );
  }
  return match[0].replace(/-/g, '');
}

function coerceUrl(candidate) {
  if (!candidate || typeof candidate !== 'string') {
    return null;
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }
  try {
    // eslint-disable-next-line no-new
    new URL(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

async function persistRemoteAsset({ url, label }) {
  const response = await fetch(url);
  if (!response.ok) {
    throw Object.assign(
      new Error(`Failed to download asset (${response.status})`),
      { statusCode: 502 }
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const contentType =
    response.headers.get('content-type') ??
    lookupMime(url) ??
    'application/octet-stream';

  const extension = resolveExtension(url, contentType);
  const fileName = buildFileName(label, extension);
  const filePath = path.join(uploadsDir, fileName);

  await writeFile(filePath, buffer);

  const assetUrl = new URL(`/uploads/${fileName}`, ASSET_BASE_URL).toString();

  return {
    fileName,
    filePath,
    assetUrl,
    contentType
  };
}

function resolveExtension(url, contentType) {
  const urlObj = new URL(url);
  const extFromUrl = path.extname(urlObj.pathname).replace('.', '');
  if (extFromUrl) {
    return extFromUrl;
  }

  const extFromMime = extensionFromMime(contentType);
  if (extFromMime) {
    return extFromMime;
  }
  return 'bin';
}

function buildFileName(label, extension) {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '-');
  const hash = crypto.randomBytes(8).toString('hex');
  return `${safeLabel}-${hash}.${extension}`;
}

async function createNotionPage({ payload, avatarAsset, mediaAssets }) {
  const properties = buildProperties(payload);
  const children = buildChildren(payload, mediaAssets);
  const icon = buildIconFromAsset(avatarAsset);
  const cover = buildCoverFromAsset(mediaAssets[0]);

  const response = await notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: {
        database_id: NOTION_DATABASE_ID
      },
      icon,
      cover,
      properties,
      children
    })
  });

  const json = await response.json();
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Notion page creation failed (${response.status}): ${JSON.stringify(
          json
        )}`
      ),
      { statusCode: response.status }
    );
  }

  return json;
}

function buildProperties(payload) {
  const { propertyMap } = payload;
  const properties = {};
  const fallbackTitle = payload.text
    ? payload.text.slice(0, 100)
    : `${payload.screenName} (${payload.userName})`;

  if (propertyMap.title) {
    properties[propertyMap.title] = {
      title: [
        {
          text: {
            content: fallbackTitle || 'X Clip'
          }
        }
      ]
    };
  }

  if (propertyMap.screenName && payload.screenName) {
    properties[propertyMap.screenName] = {
      rich_text: [
        {
          text: {
            content: payload.screenName
          }
        }
      ]
    };
  }

  if (propertyMap.userName && payload.userName) {
    properties[propertyMap.userName] = {
      rich_text: [
        {
          text: {
            content: payload.userName
          }
        }
      ]
    };
  }

  if (propertyMap.tweetUrl) {
    properties[propertyMap.tweetUrl] = {
      url: payload.url
    };
  }

  if (propertyMap.postedAt && payload.timestamp) {
    properties[propertyMap.postedAt] = {
      date: {
        start: payload.timestamp
      }
    };
  }

  return properties;
}

function buildChildren(payload, mediaAssets) {
  const children = [];

  if (payload.text) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: payload.text
            }
          }
        ]
      }
    });
  }

  for (const asset of mediaAssets) {
    const imageSource = buildNotionFileSource(asset);
    if (!imageSource) {
      continue;
    }
    children.push({
      object: 'block',
      type: 'image',
      image: {
        ...imageSource
      }
    });
  }

  return children;
}

function buildNotionFileSource(asset) {
  if (!asset) {
    return null;
  }
  if (asset.notionFileUpload?.id) {
    return {
      type: 'file_upload',
      file_upload: {
        id: asset.notionFileUpload.id
      }
    };
  }
  return {
    type: 'external',
    external: {
      url: asset.assetUrl
    }
  };
}

async function createFileUploadObject() {
  const response = await notionFetch('/file_uploads', {
    method: 'POST',
    body: '{}'
  });
  const json = await response.json();
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Notion file upload create failed (${response.status}): ${JSON.stringify(
          json
        )}`
      ),
      { statusCode: response.status }
    );
  }

  if (!json?.id) {
    throw new Error('Notion file upload response missing id');
  }

  return json;
}

async function sendFileUploadContents({
  fileUploadId,
  buffer,
  fileName,
  contentType
}) {
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([buffer], {
      type: contentType
    }),
    fileName
  );

  const response = await notionFetch(`/file_uploads/${fileUploadId}/send`, {
    method: 'POST',
    body: formData
  });

  const json = await response.json();
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Notion file upload send failed (${response.status}): ${JSON.stringify(
          json
        )}`
      ),
      { statusCode: response.status }
    );
  }
  return json;
}

function notionFetch(path, init) {
  const url = `${NOTION_API_URL}${path}`;
  const headers = {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION
  };

  const isFormData =
    typeof FormData !== 'undefined' && init?.body instanceof FormData;
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  if (init?.headers) {
    Object.assign(headers, init.headers);
  }

  return fetch(url, {
    ...init,
    headers
  });
}

async function uploadAssetToNotion(asset) {
  try {
    const buffer = await readFile(asset.filePath);
    const fileUpload = await createFileUploadObject();
    const uploaded = await sendFileUploadContents({
      fileUploadId: fileUpload.id,
      buffer,
      fileName: asset.fileName,
      contentType: asset.contentType
    });

    if (uploaded.status !== 'uploaded') {
      throw new Error(
        `Notion file upload did not complete (status: ${uploaded.status})`
      );
    }

    return uploaded;
  } catch (error) {
    console.warn('Failed to upload asset to Notion', asset.fileName, error);
    return null;
  }
}

function buildIconFromAsset(asset) {
  if (!asset) {
    return undefined;
  }
  const source = buildNotionFileSource(asset);
  return source ?? undefined;
}

function buildCoverFromAsset(asset) {
  if (!asset) {
    return undefined;
  }
  const source = buildNotionFileSource(asset);
  return source ?? undefined;
}
