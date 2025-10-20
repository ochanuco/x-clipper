import 'dotenv/config';
import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { extension as extensionFromMime, lookup as lookupMime } from 'mime-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

const app = express();
app.use(express.json({ limit: '2mb' }));

const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = process.env.NOTION_VERSION ?? '2022-06-28';
const AUTH_TOKEN = process.env.CLIP_NOTION_TOKEN;
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
    `Clip to Notion backend listening on http://localhost:${PORT} (asset base ${ASSET_BASE_URL})`
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

  const icon = avatarAsset
    ? {
        type: 'external',
        external: {
          url: avatarAsset.assetUrl
        }
      }
    : undefined;

  const cover =
    mediaAssets.length > 0
      ? {
          type: 'external',
          external: {
            url: mediaAssets[0].assetUrl
          }
        }
      : undefined;

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
    children.push({
      object: 'block',
      type: 'image',
      image: {
        type: 'external',
        external: {
          url: asset.assetUrl
        }
      }
    });
  }

  return children;
}

function notionFetch(path, init) {
  const url = `${NOTION_API_URL}${path}`;
  const headers = {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
  };

  if (init?.headers) {
    Object.assign(headers, init.headers);
  }

  return fetch(url, {
    ...init,
    headers
  });
}
