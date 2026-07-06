import type * as cheerio from 'cheerio';
import type { Page } from 'playwright';
import type { ComicMetadata, ImageInfo, SearchResult, SearchOptions, ComicUpdate } from '@comiccrawler/shared';
import type { SiteSelectors } from '@comiccrawler/shared';

export interface ExtractionContext {
  $?: cheerio.CheerioAPI;
  page?: Page;
  baseUrl: string;
  selectors: SiteSelectors;
  pageType?: 'metadata' | 'chapters' | 'images';
}

export interface ExtractionResult {
  metadata?: ComicMetadata;
  chapters?: Array<{ id: string; title: string; url: string }>;
  images?: ImageInfo[];
  searchResults?: SearchResult[];
  updates?: ComicUpdate[];
}

export interface IExtractionStrategy {
  readonly name: string;
  readonly parseMode: 'static' | 'dynamic' | 'interactive';

  extractMetadata(context: ExtractionContext): Promise<ComicMetadata>;
  extractChapters(context: ExtractionContext): Promise<Array<{ id: string; title: string; url: string }>>;
  extractImages(context: ExtractionContext): Promise<ImageInfo[]>;
  search?(query: string, options: SearchOptions, context: ExtractionContext): Promise<SearchResult[]>;
  fetchUpdates?(since: Date, context: ExtractionContext): Promise<ComicUpdate[]>;

  validate?(context: ExtractionContext): Promise<boolean>;
}

export interface SelectorConfig {
  title: string;
  author: string;
  cover: string;
  status: string;
  tags: string;
  chapterList: string;
  chapterItem: string;
  chapterTitle: string;
  chapterUrl: string;
  imageContainer: string;
  imageItem: string;
  imageSrcAttr: string;
}
