import * as cheerio from 'cheerio';
import type {
  ChapterImagesCapabilityContract,
  ChapterInfo,
  ComicStatus,
  CommonCapabilityContract,
  Credentials,
  IComicAdapter,
  MetadataCapabilityContract,
  SearchOptions,
  SearchResult,
  VerificationCapabilityContract,
} from '@comiccrawler/shared';
import { ComicError, ErrorType } from '../error/types';
import type { RetryHandler } from '../error/retry';
import type { HtmlRenderer } from '../crawler/html-renderer';

export { ComicError, ErrorType } from '../error/types';

export abstract class AdapterBase implements IComicAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly domains: string[];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = {
    verification: false,
    metadata: true,
    chapterImages: true,
  };

  readonly common?: CommonCapabilityContract;
  readonly verification?: VerificationCapabilityContract;
  readonly metadata?: MetadataCapabilityContract;
  readonly chapterImages?: ChapterImagesCapabilityContract;

  protected retryHandler?: RetryHandler;
  protected headers: Record<string, string> = {};
  private htmlRenderer?: HtmlRenderer;

  constructor(options?: { retryHandler?: RetryHandler; headers?: Record<string, string> }) {
    this.retryHandler = options?.retryHandler;
    this.headers = options?.headers ?? {};
  }

  matchUrl(url: string): boolean {
    if (this.common) return this.common.matchUrl(url);
    return this.domains.includes(new URL(url).hostname);
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

  async loadDocument(url: string): Promise<unknown> {
    return this.parseHtml(await this.fetchHtml(url));
  }

  setHtmlRenderer(renderer: HtmlRenderer | undefined): void {
    this.htmlRenderer = renderer;
  }

  async dispose(): Promise<void> {
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

function defaultVerificationDetection(input: string): boolean {
  return /anti-bot|human verification|人机验证|人機驗證|验证|驗證|challenge|cloudflare|sorry, you have been blocked|unable to access|HTTP\s+(?:401|403|429|503)\b/i.test(input);
}
