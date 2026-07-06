import type * as cheerio from 'cheerio';
import type { ComicMetadata, ImageInfo, SearchResult, SearchOptions, ComicUpdate, ComicStatus } from '@comiccrawler/shared';
import type { IExtractionStrategy, ExtractionContext } from '../types';
import { ComicError, ErrorType } from '../../../error/types';

export class DomExtractionStrategy implements IExtractionStrategy {
  readonly name = 'dom';
  readonly parseMode = 'static' as const;

  async extractMetadata(context: ExtractionContext): Promise<ComicMetadata> {
    const { $, selectors, baseUrl } = context;
    this.ensureCheerio($, context.pageType ?? 'metadata');

    const title = this.extractRequiredText($, selectors.metadata.title, 'metadata.title', baseUrl);
    const author = this.extractOptionalText($, selectors.metadata.author);
    const description = selectors.metadata.description
      ? this.extractOptionalText($, selectors.metadata.description)
      : '';
    const coverUrl = this.extractFirstAttr($, selectors.metadata.cover, ['src', 'content', 'data-src', 'data-original']);
    const statusText = this.extractOptionalText($, selectors.metadata.status).toLowerCase();
    const tags = this.extractAllText($, selectors.metadata.tags);
    const chapters = await this.extractChapters({ ...context, pageType: 'chapters' });

    return {
      id: this.generateId(baseUrl),
      title,
      author: author || undefined,
      coverUrl: this.resolveUrl(coverUrl, baseUrl) || undefined,
      description: description || undefined,
      chapters,
      tags: tags.length > 0 ? tags : undefined,
      status: this.parseStatus(statusText),
    };
  }

  async extractChapters(context: ExtractionContext): Promise<Array<{ id: string; title: string; url: string }>> {
    const { $, selectors, baseUrl } = context;
    this.ensureCheerio($, context.pageType ?? 'chapters');

    const chapterList = $(selectors.chapters.list);
    const items = chapterList.length > 0
      ? chapterList.find(selectors.chapters.item)
      : $(selectors.chapters.item);
    const chapters: Array<{ id: string; title: string; url: string }> = [];

    items.each((i, el) => {
      const $el = $(el as any);
      const title = selectors.chapters.title
        ? $el.find(selectors.chapters.title).first().text().trim() || $el.text().trim()
        : $el.text().trim();
      const rawUrl = selectors.chapters.url
        ? $el.find(selectors.chapters.url).first().attr('href') || $el.attr('href')
        : $el.attr('href');

      if (!title || !rawUrl) {
        return;
      }

      const url = this.resolveUrl(rawUrl, baseUrl);
      chapters.push({
        id: this.generateId(url, `ch-${i}`),
        title,
        url,
      });
    });

    if (chapters.length === 0) {
      throw new ComicError(
        `No chapters found for ${baseUrl}`,
        ErrorType.PARSING_ERROR,
        false,
        {
          pageType: 'chapters',
          selector: selectors.chapters.item,
          baseUrl,
        }
      );
    }

    return chapters;
  }

  async extractImages(context: ExtractionContext): Promise<ImageInfo[]> {
    const { $, selectors, baseUrl } = context;
    this.ensureCheerio($, context.pageType ?? 'images');

    const container = selectors.images.container ? $(selectors.images.container) : null;
    const items = container && container.length > 0
      ? container.find(selectors.images.item)
      : $(selectors.images.item);
    const srcAttr = selectors.images.srcAttr || 'src';
    const images: ImageInfo[] = [];

    items.each((i, el) => {
      const $el = $(el as any);
      const src = $el.attr(srcAttr) || $el.attr('data-src') || $el.attr('data-original') || $el.attr('src');

      if (!src) {
        return;
      }

      const resolvedUrl = this.resolveUrl(src, baseUrl);
      images.push({
        url: resolvedUrl,
        index: i,
        filename: this.createFilename(i, resolvedUrl),
      });
    });

    if (images.length === 0) {
      throw new ComicError(
        `No images found for ${baseUrl}`,
        ErrorType.PARSING_ERROR,
        false,
        {
          pageType: 'images',
          selector: selectors.images.item,
          baseUrl,
        }
      );
    }

    return images;
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
