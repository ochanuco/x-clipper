export interface NotionPropertyMap {
  title: string;
  screenName: string;
  userName: string;
  tweetUrl: string;
  postedAt: string;
}

export interface NotionSettings {
  notionApiKey: string;
  notionDatabaseUrl: string;
  notionDatabaseId: string;
  propertyMap: NotionPropertyMap;
}

export interface XPostPayload {
  screenName: string;
  userName: string;
  text: string;
  timestamp: string;
  images: string[];
  url: string;
}
