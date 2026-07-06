import type { ComicMetadata, ImageInfo, SearchResult, SearchOptions, Credentials } from './comic';

export interface AdapterCapabilities {
  verification: boolean;
  metadata: boolean;
  chapterImages: boolean;
}

export interface IComicAdapter {
  readonly id: string;
  readonly name: string;
  readonly domains: string[];
  readonly parseMode: 'static' | 'dynamic' | 'interactive';
  readonly capabilities?: AdapterCapabilities;

  matchUrl(url: string): boolean;
  fetchMetadata(url: string): Promise<ComicMetadata>;
  fetchChapterImages(chapterUrl: string): Promise<ImageInfo[]>;
  login?(credentials: Credentials): Promise<boolean>;
  search?(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  fetchUpdates?(since: Date): Promise<ComicUpdate[]>;
}

export interface ComicUpdate {
  comicId: string;
  type: 'new_chapter' | 'updated_chapter';
  chapterId: string;
}

export interface AdapterInfo {
  id: string;
  name: string;
  domains: string[];
  enabled: boolean;
  version: string;
  supportsLogin: boolean;
  supportsSearch: boolean;
  capabilities: AdapterCapabilities;
  parseMode: 'static' | 'dynamic' | 'interactive';
  configSchema?: Record<string, ConfigField>;
}

export interface ConfigField {
  type: 'string' | 'number' | 'boolean';
  default?: unknown;
  required?: boolean;
}

export interface SiteSelectors {
  metadata: {
    title: string;
    author: string;
    cover: string;
    status: string;
    tags: string;
    description?: string;
  };
  chapters: {
    list: string;
    item: string;
    title?: string;
    url?: string;
  };
  images: {
    container?: string;
    item: string;
    srcAttr: string;
  };
}
