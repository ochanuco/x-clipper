import type { NotionSettings, XPostPayload } from './types.js';

const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const NOTION_VERSION = '2022-06-28';

function buildProperties(settings: NotionSettings, post: XPostPayload) {
  const properties: Record<string, unknown> = {};
  const titleProperty = settings.propertyMap.title?.trim();
  const screenNameProperty = settings.propertyMap.screenName?.trim();
  const userNameProperty = settings.propertyMap.userName?.trim();
  const urlProperty = settings.propertyMap.tweetUrl?.trim();
  const postedAtProperty = settings.propertyMap.postedAt?.trim();

  const fallbackTitle = post.text
    ? post.text.slice(0, 100)
    : `${post.screenName} (${post.userName})`;

  if (titleProperty) {
    properties[titleProperty] = {
      title: [
        {
          text: {
            content: fallbackTitle
          }
        }
      ]
    };
  }

  if (screenNameProperty) {
    properties[screenNameProperty] = {
      rich_text: [
        {
          text: {
            content: post.screenName
          }
        }
      ]
    };
  }

  if (userNameProperty) {
    properties[userNameProperty] = {
      rich_text: [
        {
          text: {
            content: post.userName
          }
        }
      ]
    };
  }

  if (urlProperty) {
    properties[urlProperty] = {
      url: post.url
    };
  }

  if (postedAtProperty && post.timestamp) {
    properties[postedAtProperty] = {
      date: {
        start: post.timestamp
      }
    };
  }

  return properties;
}

function buildChildren(post: XPostPayload) {
  const children: unknown[] = [];

  if (post.text) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: post.text
            }
          }
        ]
      }
    });
  }

  for (const imageUrl of post.images) {
    children.push({
      object: 'block',
      type: 'image',
      image: {
        type: 'external',
        external: {
          url: imageUrl
        }
      }
    });
  }

  return children;
}

export interface NotionError extends Error {
  responseStatus?: number;
  responseBody?: string;
}

export async function createNotionPage(
  settings: NotionSettings,
  post: XPostPayload
): Promise<void> {
  if (!settings.notionApiKey) {
    throw new Error('Notion API キーが未設定です。');
  }

  if (!settings.notionDatabaseId) {
    throw new Error('Notion データベース ID が未設定です。');
  }

  const properties = buildProperties(settings, post);
  const children = buildChildren(post);

  const response = await fetch(NOTION_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.notionApiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION
    },
    body: JSON.stringify({
      parent: {
        database_id: settings.notionDatabaseId
      },
      properties,
      children
    })
  });

  if (!response.ok) {
    const error = new Error('Notion への書き込みに失敗しました。') as NotionError;
    error.responseStatus = response.status;
    try {
      error.responseBody = await response.text();
    } catch {
      error.responseBody = 'レスポンス本文の取得に失敗しました。';
    }
    throw error;
  }
}
