import type { NotionPropertyMap } from '../../types.js';

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
