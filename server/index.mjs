import 'dotenv/config';
import express from 'express';
import { extension as extensionFromMime, lookup as lookupMime } from 'mime-types';

const app = express();
app.use(express.json({ limit: '2mb' }));

const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = process.env.NOTION_VERSION ?? '2022-06-28';
const AUTH_TOKEN = process.env.CLIP_NOTION_TOKEN;

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

    const avatarFile = payload.avatarUrl
      ? await uploadRemoteAsset({
          url: payload.avatarUrl,
          label: 'avatar'
        })
      : null;

    const mediaFiles = [];
    for (const [index, imageUrl] of payload.images.entries()) {
      try {
        const uploaded = await uploadRemoteAsset({
          url: imageUrl,
          label: `media-${index + 1}`
        });
        mediaFiles.push(uploaded);
      } catch (error) {
        console.warn('Failed to upload media', imageUrl, error);
      }
    }

    const page = await createNotionPage({
      payload,
      avatarFile,
      mediaFiles
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

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
app.listen(port, () => {
  console.log(`Clip to Notion backend listening on http://localhost:${port}`);
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

async function uploadRemoteAsset({ url, label }) {
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
  const ext = extensionFromMime(contentType) ?? 'bin';
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '-');
  const name = `${safeLabel}-${Date.now()}.${ext}`;

  const fileMeta = await createNotionFile({
    name,
    contentType
  });

  await uploadToSignedUrl({
    signedUrl: fileMeta.signed_url,
    buffer,
    contentType
  });

  return {
    fileId: fileMeta.id,
    name,
    contentType
  };
}

async function createNotionFile({ name, contentType }) {
  const response = await notionFetch('/files', {
    method: 'POST',
    body: JSON.stringify({
      file: {
        name,
        content_type: contentType
      }
    })
  });

  const json = await response.json();
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Notion file init failed (${response.status}): ${JSON.stringify(json)}`
      ),
      { statusCode: response.status }
    );
  }

  return json.file;
}

async function uploadToSignedUrl({ signedUrl, buffer, contentType }) {
  const response = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': buffer.length.toString()
    },
    body: buffer
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(
      new Error(
        `Failed to upload to signed URL (${response.status}): ${text.slice(
          0,
          200
        )}`
      ),
      { statusCode: 502 }
    );
  }
}

async function createNotionPage({ payload, avatarFile, mediaFiles }) {
  const properties = buildProperties(payload);
  const children = buildChildren(payload, mediaFiles);

  const icon = avatarFile
    ? {
        type: 'file',
        file: {
          file_id: avatarFile.fileId
        }
      }
    : undefined;

  const cover =
    mediaFiles.length > 0
      ? {
          type: 'file',
          file: {
            file_id: mediaFiles[0].fileId
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

function buildChildren(payload, mediaFiles) {
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

  for (const file of mediaFiles) {
    children.push({
      object: 'block',
      type: 'image',
      image: {
        type: 'file',
        file: {
          file_id: file.fileId
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
