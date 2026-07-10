import type { ImageInfo } from '@comiccrawler/shared';
import type { HtmlParser } from './html-parser';
import type { AdapterBase } from '../adapter/base';
import { ComicError, ErrorType } from '../error/types';

export interface ChapterFetcherOptions {
  selector?: string;
  baseUrl?: string;
  extractImages?: boolean;
}

export class ChapterFetcher {
  private parser: HtmlParser;

  constructor(parser: HtmlParser) {
    this.parser = parser;
  }

  async fetchChapters(adapter: AdapterBase, url: string, options?: ChapterFetcherOptions): Promise<Array<{ id: string; title: string; url: string }>> {
    const html = await adapter.fetchHtml(url);
    const $ = this.parser.parse(html);

    const chapters: Array<{ id: string; title: string; url: string }> = [];

    if (options?.selector) {
      const links = this.parser.extractLinks($, options.selector);
      links.forEach((link, i) => {
        let resolvedUrl = link.href;
        if (options.baseUrl) {
          try {
            resolvedUrl = new URL(link.href, options.baseUrl).href;
          } catch {
            resolvedUrl = link.href;
          }
        }
        chapters.push({
          id: `ch-${i}`,
          title: link.text,
          url: resolvedUrl,
        });
      });
    }

    return chapters;
  }

  async extractImagesFromChapterPage(adapter: AdapterBase, chapterUrl: string, options?: { selector?: string; srcAttr?: string }): Promise<ImageInfo[]> {
    const html = await adapter.fetchHtml(chapterUrl);
    const $ = this.parser.parse(html);

    const selector = options?.selector ?? 'img';
    const srcAttr = options?.srcAttr ?? 'src';

    const images = $(selector)
      .map((i, el) => {
        const $el = $(el);
        const src = $el.attr(srcAttr) || $el.attr('data-src') || $el.attr('data-original');
        return src ? { url: src, index: i } : null;
      })
      .get()
      .filter(Boolean) as ImageInfo[];

    if (images.length === 0) {
      throw new ComicError(
        `No images found in chapter: ${chapterUrl}`,
        ErrorType.PARSING_ERROR,
        false,
        { chapterUrl }
      );
    }

    return images;
  }
}
