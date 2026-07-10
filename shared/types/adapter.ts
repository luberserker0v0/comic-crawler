import type { ComicMetadata, ImageInfo, SearchResult, SearchOptions, Credentials, ComicStatus } from './comic';
import type { ChapterInfo } from './task';

export interface AdapterCapabilities {
  verification: boolean;
  metadata: boolean;
  chapterImages: boolean;
}

export interface CommonCapabilityContract {
  matchUrl(url: string): boolean;
}

export interface VerificationCapabilityContract {
  detectVerificationRequired(input: string): Promise<boolean> | boolean;
  describeVerificationHandoff(): Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface MetadataCapabilityContract {
  extractTitle(document: unknown, sourceUrl: string): Promise<string> | string;
  extractAuthor?(document: unknown, sourceUrl: string): Promise<string | undefined> | string | undefined;
  extractDescription?(document: unknown, sourceUrl: string): Promise<string | undefined> | string | undefined;
  extractCoverUrl?(document: unknown, sourceUrl: string): Promise<string | undefined> | string | undefined;
  extractTags?(document: unknown, sourceUrl: string): Promise<string[]> | string[];
  extractStatus?(document: unknown, sourceUrl: string): Promise<ComicStatus | undefined> | ComicStatus | undefined;
  extractChapterList(document: unknown, sourceUrl: string): Promise<ChapterInfo[]> | ChapterInfo[];
}

export interface ChapterImagesCapabilityContract {
  extractChapterImageUrls(document: unknown, sourceUrl: string): Promise<string[]> | string[];
}

export interface IComicAdapter {
  readonly id: string;
  readonly name: string;
  readonly domains: string[];
  readonly parseMode: 'static' | 'dynamic' | 'interactive';
  readonly capabilities?: AdapterCapabilities;
  readonly common?: CommonCapabilityContract;
  readonly verification?: VerificationCapabilityContract;
  readonly metadata?: MetadataCapabilityContract;
  readonly chapterImages?: ChapterImagesCapabilityContract;

  matchUrl(url: string): boolean;
  extractTitle?(document: unknown, sourceUrl: string): Promise<string> | string;
  extractAuthor?(document: unknown, sourceUrl: string): Promise<string | undefined> | string | undefined;
  extractDescription?(document: unknown, sourceUrl: string): Promise<string | undefined> | string | undefined;
  extractCoverUrl?(document: unknown, sourceUrl: string): Promise<string | undefined> | string | undefined;
  extractTags?(document: unknown, sourceUrl: string): Promise<string[]> | string[];
  extractStatus?(document: unknown, sourceUrl: string): Promise<ComicStatus | undefined> | ComicStatus | undefined;
  extractChapterList?(document: unknown, sourceUrl: string): Promise<ChapterInfo[]> | ChapterInfo[];
  extractChapterImageUrls?(document: unknown, sourceUrl: string): Promise<string[]> | string[];
  detectVerificationRequired?(input: string): Promise<boolean> | boolean;
  describeVerificationHandoff?(): Promise<Record<string, unknown>> | Record<string, unknown>;
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
