import * as undici from 'undici';
import * as cheerio from 'cheerio';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ChapterImagesCapabilityContract,
  ChapterInfo,
  ComicMetadata,
  ComicStatus,
  CommonCapabilityContract,
  Credentials,
  IComicAdapter,
  ImageInfo,
  MetadataCapabilityContract,
  SearchOptions,
  SearchResult,
  VerificationCapabilityContract,
} from '@comiccrawler/shared';
import { ComicError, ErrorType } from '../error/types';
import type { RetryHandler } from '../error/retry';
import type { HtmlRenderer } from '../crawler/html-renderer';

export type HtmlFetchMode = 'static' | 'headless';

const htmlFetchModeStorage = new AsyncLocalStorage<HtmlFetchMode>();

export abstract class AdapterBase implements IComicAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly domains: string[];
  readonly parseMode: 'static' | 'dynamic' | 'interactive' = 'static';
  readonly capabilities = {
    verification: false,
    metadata: true,
    chapterImages: true,
  };

  readonly common?: CommonCapabilityContract;
  readonly verification?: VerificationCapabilityContract;
  readonly metadata?: MetadataCapabilityContract;
  readonly chapterImages?: ChapterImagesCapabilityContract;

  protected client: undici.Dispatcher;
  protected retryHandler?: RetryHandler;
  protected headers: Record<string, string> = {};
  private htmlRenderer?: HtmlRenderer;

  constructor(options?: { retryHandler?: RetryHandler; headers?: Record<string, string> }) {
    this.client = new undici.Agent({
      connections: 5,
      keepAliveTimeout: 30000,
      keepAliveMaxTimeout: 60000,
    });
    this.retryHandler = options?.retryHandler;
    this.headers = options?.headers ?? {};
  }

  matchUrl(url: string): boolean {
    if (this.common) return this.common.matchUrl(url);
    return this.domains.includes(new URL(url).hostname);
  }

  async fetchMetadata(url: string): Promise<ComicMetadata> {
    if (!this.capabilities.metadata) {
      throw new ComicError(
        `Adapter "${this.id}" does not support metadata capability.`,
        ErrorType.ADAPTER_ERROR,
        false,
        { adapterId: this.id, capability: 'metadata' }
      );
    }
    const html = await this.fetchHtml(url);
    const document = this.parseHtml(html);
    const title = await this.extractTitle(document, url);
    const chapters = await this.extractChapterList(document, url);
    if (!title || chapters.length === 0) {
      throw new ComicError(
        `Adapter "${this.id}" did not extract required metadata fields.`,
        ErrorType.PARSING_ERROR,
        false,
        { adapterId: this.id, url, missing: { title: !title, chapters: chapters.length === 0 } }
      );
    }

    return {
      id: this.deriveMetadataId(url),
      title,
      author: await this.extractAuthor(document, url),
      coverUrl: await this.extractCoverUrl(document, url),
      status: await this.extractStatus(document, url) ?? 'unknown',
      tags: await this.extractTags(document, url),
      description: await this.extractDescription(document, url),
      chapters,
    };
  }

  async fetchChapterImages(chapterUrl: string): Promise<ImageInfo[]> {
    if (!this.capabilities.chapterImages) {
      throw new ComicError(
        `Adapter "${this.id}" does not support chapterImages capability.`,
        ErrorType.ADAPTER_ERROR,
        false,
        { adapterId: this.id, capability: 'chapterImages' }
      );
    }
    const html = await this.fetchHtml(chapterUrl);
    const document = this.parseHtml(html);
    const urls = await this.extractChapterImageUrls(document, chapterUrl);
    if (urls.length === 0) {
      throw new ComicError(
        `Adapter "${this.id}" did not extract any chapter image URLs.`,
        ErrorType.PARSING_ERROR,
        false,
        { adapterId: this.id, url: chapterUrl }
      );
    }
    return urls.map((url, index) => ({
      url,
      index,
      filename: `${String(index + 1).padStart(3, '0')}.${this.composedImageExtensionFor(url)}`,
    }));
  }

  extractTitle(document: unknown, sourceUrl: string): Promise<string> | string {
    if (this.metadata) return this.metadata.extractTitle(document, sourceUrl);
    return this.unsupportedExtraction('extractTitle');
  }

  extractAuthor(document: unknown, sourceUrl: string): Promise<string | undefined> | string | undefined {
    return this.metadata?.extractAuthor?.(document, sourceUrl);
  }

  extractDescription(document: unknown, sourceUrl: string): Promise<string | undefined> | string | undefined {
    return this.metadata?.extractDescription?.(document, sourceUrl);
  }

  extractCoverUrl(document: unknown, sourceUrl: string): Promise<string | undefined> | string | undefined {
    return this.metadata?.extractCoverUrl?.(document, sourceUrl);
  }

  extractTags(document: unknown, sourceUrl: string): Promise<string[]> | string[] {
    return this.metadata?.extractTags?.(document, sourceUrl) ?? [];
  }

  extractStatus(document: unknown, sourceUrl: string): Promise<ComicStatus | undefined> | ComicStatus | undefined {
    return this.metadata?.extractStatus?.(document, sourceUrl);
  }

  extractChapterList(document: unknown, sourceUrl: string): Promise<ChapterInfo[]> | ChapterInfo[] {
    if (this.metadata) return this.metadata.extractChapterList(document, sourceUrl);
    return this.unsupportedExtraction('extractChapterList');
  }

  extractChapterImageUrls(document: unknown, sourceUrl: string): Promise<string[]> | string[] {
    if (this.chapterImages) return this.chapterImages.extractChapterImageUrls(document, sourceUrl);
    return this.unsupportedExtraction('extractChapterImageUrls');
  }

  detectVerificationRequired(input: string): Promise<boolean> | boolean {
    return this.verification?.detectVerificationRequired(input) ?? defaultVerificationDetection(input);
  }

  describeVerificationHandoff(): Promise<Record<string, unknown>> | Record<string, unknown> {
    return this.verification?.describeVerificationHandoff() ?? {
      supported: this.capabilities.verification,
      flow: 'Task enters waiting_verification and the user completes verification through the task detail handoff.',
    };
  }

  async login?(credentials: Credentials): Promise<boolean>;
  async search?(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  async fetchUpdates?(since: Date): Promise<import('@comiccrawler/shared').ComicUpdate[]>;

  async fetchHtml(url: string): Promise<string> {
    const mode = htmlFetchModeStorage.getStore() ?? 'static';
    if (mode === 'headless') {
      if (!this.htmlRenderer) {
        throw new ComicError(
          'Headless HTML renderer is not configured.',
          ErrorType.CONFIG_ERROR,
          false,
          { url }
        );
      }
      return this.htmlRenderer.render(url);
    }

    return this.fetchStaticHtml(url);
  }

  async loadDocument(url: string): Promise<unknown> {
    return this.parseHtml(await this.fetchHtml(url));
  }

  async withHtmlFetchMode<T>(mode: HtmlFetchMode, fn: () => Promise<T>): Promise<T> {
    return htmlFetchModeStorage.run(mode, fn);
  }

  setHtmlRenderer(renderer: HtmlRenderer | undefined): void {
    this.htmlRenderer = renderer;
  }

  async dispose(): Promise<void> {
    await this.client.close();
  }

  public parseHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html);
  }

  public resolveUrl(base: string, relative: string): string {
    return new URL(relative, base).href;
  }

  public extractText($: cheerio.CheerioAPI, selector: string): string {
    return $(selector).first().text().trim();
  }

  public extractAttr($: cheerio.CheerioAPI, selector: string, attr: string): string {
    return $(selector).first().attr(attr)?.trim() ?? '';
  }

  public extractAllText($: cheerio.CheerioAPI, selector: string): string[] {
    return $(selector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
  }

  public asCheerio(document: unknown): cheerio.CheerioAPI {
    return document as cheerio.CheerioAPI;
  }

  setHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  setHeaders(headers: Record<string, string>): void {
    this.headers = { ...this.headers, ...headers };
  }

  protected unsupportedExtraction(method: string): never {
    throw new ComicError(
      `Adapter "${this.id}" does not support ${method}().`,
      ErrorType.ADAPTER_ERROR,
      false,
      { adapterId: this.id, method }
    );
  }

  private async fetchStaticHtml(url: string): Promise<string> {
    const fetchFn = async () => {
      const response = await this.client.request({
        method: 'GET',
        origin: new URL(url).origin,
        path: new URL(url).pathname + new URL(url).search,
        headers: {
          'User-Agent': this.headers['User-Agent'] ?? 'ComicCrawler/1.0.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          ...this.headers,
        },
      });

      if (response.statusCode >= 400) {
        throw new ComicError(
          `HTTP ${response.statusCode} for ${url}`,
          ErrorType.NETWORK_ERROR,
          response.statusCode < 500,
          { url, statusCode: response.statusCode }
        );
      }

      return await response.body.text();
    };

    if (this.retryHandler) {
      return this.retryHandler.executeWithRetry(fetchFn);
    }

    return fetchFn();
  }

  private deriveMetadataId(url: string): string {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments.at(-1) ?? this.id;
  }

  private composedImageExtensionFor(url: string): string {
    return /\.(jpg|jpeg|png|webp|gif|avif)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg';
  }
}

export abstract class CommonCapability implements CommonCapabilityContract {
  constructor(protected readonly adapter: AdapterBase) {}
  abstract matchUrl(url: string): boolean;
}

export abstract class MetadataCapability implements MetadataCapabilityContract {
  constructor(protected readonly adapter: AdapterBase) {}
  abstract extractTitle(document: unknown, sourceUrl: string): Promise<string> | string;
  extractAuthor(_document: unknown, _sourceUrl: string): Promise<string | undefined> | string | undefined {
    return undefined;
  }
  extractDescription(_document: unknown, _sourceUrl: string): Promise<string | undefined> | string | undefined {
    return undefined;
  }
  extractCoverUrl(_document: unknown, _sourceUrl: string): Promise<string | undefined> | string | undefined {
    return undefined;
  }
  extractTags(_document: unknown, _sourceUrl: string): Promise<string[]> | string[] {
    return [];
  }
  extractStatus(_document: unknown, _sourceUrl: string): Promise<ComicStatus | undefined> | ComicStatus | undefined {
    return undefined;
  }
  abstract extractChapterList(document: unknown, sourceUrl: string): Promise<ChapterInfo[]> | ChapterInfo[];
}

export abstract class ChapterImagesCapability implements ChapterImagesCapabilityContract {
  constructor(protected readonly adapter: AdapterBase) {}
  abstract extractChapterImageUrls(document: unknown, sourceUrl: string): Promise<string[]> | string[];
}

export class VerificationCapability implements VerificationCapabilityContract {
  constructor(protected readonly adapter: AdapterBase) {}
  detectVerificationRequired(input: string): boolean {
    return defaultVerificationDetection(input);
  }
  describeVerificationHandoff(): Record<string, unknown> {
    return {
      supported: this.adapter.capabilities.verification,
      flow: 'Task enters waiting_verification and the user completes verification through the task detail handoff.',
    };
  }
}

export abstract class BaseAdapter extends AdapterBase {}

function defaultVerificationDetection(input: string): boolean {
  return /anti-bot|human verification|challenge|cloudflare|sorry, you have been blocked|unable to access|人机验证|人機驗證|HTTP\s+(?:401|403|429|503)\b/i.test(input);
}
