export interface NotionPropertyMap {
  title: string;
  screenName: string;
  userName: string;
  tweetUrl: string;
  postedAt: string;
}

export interface AppSettings {
  backendEndpoint: string;
  backendAuthToken: string;
  propertyMap: NotionPropertyMap;
}

export interface XPostPayload {
  screenName: string;
  userName: string;
  text: string;
  timestamp: string;
  images: string[];
  avatarUrl: string | null;
  url: string;
  propertyMap?: NotionPropertyMap;
}
