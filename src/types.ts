export type NotionPropertyType =
  | 'title'
  | 'rich_text'
  | 'select'
  | 'multi_select'
  | 'url'
  | 'date';

export interface NotionPropertyMapping {
  propertyName: string;
  propertyType: NotionPropertyType;
}

export interface NotionPropertyMap {
  title: NotionPropertyMapping;
  screenName: NotionPropertyMapping;
  userName: NotionPropertyMapping;
  tweetUrl: NotionPropertyMapping;
  postedAt: NotionPropertyMapping;
}

export interface AppSettings {
  notionApiKey: string;
  notionDatabaseId: string;
  notionVersion: string;
  propertyMap: NotionPropertyMap;
}


export interface NotionFileUpload {
  id: string;
  status?: string;
  filename?: string | null;
  content_type?: string | null;
}

export interface DownloadedAsset {
  label: string;
  sourceUrl: string;
  blob: Blob;
  fileName: string;
  contentType: string;
  notionFileUpload?: NotionFileUpload;
}
