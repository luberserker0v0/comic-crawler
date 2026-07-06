import * as undici from 'undici';
import * as cheerio from 'cheerio';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  IComicAdapter,
  ComicMetadata,
  ImageInfo,
  SearchResult,
  SearchOptions,
  Credentials,
} from '@comiccrawler/shared';
import { ComicError, ErrorType } from '../error/types';
import type { RetryHandler } from '../error/retry';
import type { HtmlRenderer } from '../crawler/html-renderer';

export type HtmlFetchMode = 'static' | 'headless';

const htmlFetchModeStorage = new AsyncLocalStorage<HtmlFetchMode>();

export abstract class BaseAdapter implements IComicAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly domains: string[];
  readonly parseMode: 'static' | 'dynamic' | 'interactive' = 'static';
  readonly capabilities = {
    verification: false,
    metadata: true,
    chapterImages: true,
  };

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

  abstract matchUrl(url: string): boolean;
  abstract fetchMetadata(url: string): Promise<ComicMetadata>;
  abstract fetchChapterImages(chapterUrl: string): Promise<ImageInfo[]>;

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

  async withHtmlFetchMode<T>(mode: HtmlFetchMode, fn: () => Promise<T>): Promise<T> {
    return htmlFetchModeStorage.run(mode, fn);
  }

  setHtmlRenderer(renderer: HtmlRenderer | undefined): void {
    this.htmlRenderer = renderer;
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

  protected parseHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html);
  }

  protected resolveUrl(base: string, relative: string): string {
    return new URL(relative, base).href;
  }

  protected extractText($: cheerio.CheerioAPI, selector: string): string {
    return $(selector).first().text().trim();
  }

  protected extractAttr($: cheerio.CheerioAPI, selector: string, attr: string): string {
    return $(selector).first().attr(attr)?.trim() ?? '';
  }

  protected extractAllText($: cheerio.CheerioAPI, selector: string): string[] {
    return $(selector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
  }

  setHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  setHeaders(headers: Record<string, string>): void {
    this.headers = { ...this.headers, ...headers };
  }

  async dispose(): Promise<void> {
    await this.client.close();
  }
}
