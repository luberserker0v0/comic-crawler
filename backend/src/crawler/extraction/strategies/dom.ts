import type * as cheerio from 'cheerio';
import type { ComicMetadata, ImageInfo, SearchResult, SearchOptions, ComicUpdate, ComicStatus } from '@comiccrawler/shared';
import type { IExtractionStrategy, ExtractionContext } from '../types';
import { ComicError, ErrorType } from '../../../error/types';

export class DomExtractionStrategy implements IExtractionStrategy {
  readonly name = 'dom';
  readonly parseMode = 'playwright' as const;

  async extractMetadata(context: ExtractionContext): Promise<ComicMetadata> {
    const { $ } = context;
    this.ensureCheerio($, context.pageType ?? 'metadata');
    const chapters = await this.extractChapters({ ...context, pageType: 'chapters' });
    return this.buildMetadata($, context, chapters);
  }

  async extractChapters(context: ExtractionContext): Promise<Array<{ id: string; title: string; url: string }>> {
    const { $, selectors, baseUrl } = context;
    this.ensureCheerio($, context.pageType ?? 'chapters');

    const chapterList = $(selectors.chapters.list);
    const items = chapterList.length > 0
      ? chapterList.find(selectors.chapters.item)
      : $(selectors.chapters.item);
    const chapters = this.collectChapters($, items, context);
    this.ensureResults(chapters, baseUrl, 'chapters', selectors.chapters.item);
    return chapters;
  }

  async extractImages(context: ExtractionContext): Promise<ImageInfo[]> {
    const { $, selectors, baseUrl } = context;
    this.ensureCheerio($, context.pageType ?? 'images');

    const container = selectors.images.container ? $(selectors.images.container) : null;
    const items = container && container.length > 0
      ? container.find(selectors.images.item)
      : $(selectors.images.item);
    const images: ImageInfo[] = [];
    items.each((i, el) => this.appendImage(images, $, el, i, context));
    this.ensureResults(images, baseUrl, 'images', selectors.images.item);
    return images;
  }

  private buildMetadata($: cheerio.CheerioAPI, context: ExtractionContext,
    chapters: ComicMetadata['chapters']): ComicMetadata {
    const { metadata } = context.selectors;
    const author = this.extractOptionalText($, metadata.author);
    const description = this.extractOptionalText($, metadata.description);
    const cover = this.extractFirstAttr($, metadata.cover, ['src', 'content', 'data-src', 'data-original']);
    const tags = this.extractAllText($, metadata.tags);
    return { id: this.generateId(context.baseUrl),
      title: this.extractRequiredText($, metadata.title, 'metadata.title', context.baseUrl),
      author: author || undefined, coverUrl: this.resolveUrl(cover, context.baseUrl) || undefined,
      description: description || undefined, chapters, tags: tags.length ? tags : undefined,
      status: this.parseStatus(this.extractOptionalText($, metadata.status).toLowerCase()) };
  }

  private collectChapters($: cheerio.CheerioAPI, items: cheerio.Cheerio<any>,
    context: ExtractionContext): ComicMetadata['chapters'] {
    const chapters: ComicMetadata['chapters'] = [];
    items.each((index, element) => {
      const item = $(element as any);
      const titleSelector = context.selectors.chapters.title;
      const urlSelector = context.selectors.chapters.url;
      const title = titleSelector ? item.find(titleSelector).first().text().trim() || item.text().trim() : item.text().trim();
      const rawUrl = urlSelector ? item.find(urlSelector).first().attr('href') || item.attr('href') : item.attr('href');
      if (!title || !rawUrl) return;
      const url = this.resolveUrl(rawUrl, context.baseUrl);
      chapters.push({ id: this.generateId(url, `ch-${index}`), title, url });
    });
    return chapters;
  }

  private appendImage(images: ImageInfo[], $: cheerio.CheerioAPI, element: unknown,
    index: number, context: ExtractionContext): void {
    const item = $(element as any);
    const src = item.attr(context.selectors.images.srcAttr || 'src')
      || item.attr('data-src') || item.attr('data-original') || item.attr('src');
    if (!src) return;
    const url = this.resolveUrl(src, context.baseUrl);
    images.push({ url, index, filename: this.createFilename(index, url) });
  }

  private ensureResults(results: unknown[], baseUrl: string, pageType: string, selector: string): void {
    if (results.length) return;
    throw new ComicError(`No ${pageType} found for ${baseUrl}`, ErrorType.PARSING_ERROR,
      false, { pageType, selector, baseUrl });
  }

  async search?(_query: string, _options: SearchOptions, _context: ExtractionContext): Promise<SearchResult[]> {
    return [];
  }

  async fetchUpdates?(_since: Date, _context: ExtractionContext): Promise<ComicUpdate[]> {
    return [];
  }

  async validate(context: ExtractionContext): Promise<boolean> {
    const { $, selectors, pageType } = context;
    if (!$) return false;

    if (pageType === 'images') {
      return $(selectors.images.item).length > 0;
    }

    if (pageType === 'chapters') {
      const chapters = $(selectors.chapters.list).find(selectors.chapters.item);
      return chapters.length > 0 || $(selectors.chapters.item).length > 0;
    }

    const hasTitle = $(selectors.metadata.title).length > 0;
    const hasChapters = $(selectors.chapters.list).find(selectors.chapters.item).length > 0 || $(selectors.chapters.item).length > 0;
    return hasTitle && hasChapters;
  }

  private ensureCheerio($: cheerio.CheerioAPI | undefined, pageType: string): asserts $ is cheerio.CheerioAPI {
    if (!$) {
      throw new ComicError(
        `Cheerio instance is required for ${pageType} extraction`,
        ErrorType.PARSING_ERROR,
        false,
        { pageType }
      );
    }
  }

  private extractRequiredText($: cheerio.CheerioAPI, selector: string, selectorName: string, baseUrl: string): string {
    const value = $(selector).first().text().trim();
    if (value) {
      return value;
    }

    throw new ComicError(
      `Required selector "${selectorName}" did not return text`,
      ErrorType.PARSING_ERROR,
      false,
      { selector, selectorName, baseUrl }
    );
  }

  private extractOptionalText($: cheerio.CheerioAPI, selector?: string): string {
    if (!selector) return '';
    return $(selector).first().text().trim();
  }

  private extractFirstAttr($: cheerio.CheerioAPI, selector: string, attrs: string[]): string {
    const element = $(selector).first();
    for (const attr of attrs) {
      const value = element.attr(attr)?.trim();
      if (value) {
        return value;
      }
    }
    return '';
  }

  private extractAllText($: cheerio.CheerioAPI, selector: string): string[] {
    return $(selector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
  }

  private resolveUrl(url: string, baseUrl: string): string {
    if (!url) return '';
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  }

  private parseStatus(text: string): ComicStatus {
    if (
      text.includes('ongoing') ||
      text.includes('連載中') ||
      text.includes('serialization') ||
      text.includes('serializing')
    ) {
      return 'ongoing';
    }

    if (
      text.includes('completed') ||
      text.includes('完結') ||
      text.includes('finished') ||
      text.includes('complete')
    ) {
      return 'completed';
    }

    return 'unknown';
  }

  private generateId(url: string, fallback?: string): string {
    try {
      const parsed = new URL(url);
      const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
      return lastSegment || fallback || parsed.pathname.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-|-$/g, '');
    } catch {
      return fallback || Buffer.from(url).toString('base64').slice(0, 16);
    }
  }

  private createFilename(index: number, url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const extension = pathname.split('.').pop();
      const normalizedExtension = extension && extension.length <= 5 ? extension : 'jpg';
      return `${String(index + 1).padStart(3, '0')}.${normalizedExtension}`;
    } catch {
      return `${String(index + 1).padStart(3, '0')}.jpg`;
    }
  }
}
