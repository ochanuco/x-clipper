export interface NotionPropertyMap {
  title: string;
  screenName: string;
  userName: string;
  tweetUrl: string;
  postedAt: string;
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
