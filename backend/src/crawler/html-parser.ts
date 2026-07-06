import * as cheerio from 'cheerio';
import { ComicError, ErrorType } from '../error/types';

export interface ParseResult {
  title: string;
  links: Array<{ text: string; href: string }>;
  images: Array<{ src: string; alt: string }>;
  text: string;
}

export class HtmlParser {
  private defaultSelector: string;

  constructor(defaultSelector = 'body') {
    this.defaultSelector = defaultSelector;
  }

  parse(html: string): cheerio.CheerioAPI {
    if (!html || typeof html !== 'string') {
      throw new ComicError(
        'Invalid HTML input',
        ErrorType.PARSING_ERROR
      );
    }

    try {
      return cheerio.load(html);
    } catch (error) {
      throw new ComicError(
        `Failed to parse HTML: ${error instanceof Error ? error.message : String(error)}`,
        ErrorType.PARSING_ERROR
      );
    }
  }

  extractText($: cheerio.CheerioAPI, selector: string): string {
    return $(selector).first().text().trim();
  }

  extractAttr($: cheerio.CheerioAPI, selector: string, attr: string): string {
    return $(selector).first().attr(attr)?.trim() ?? '';
  }

  extractAll($: cheerio.CheerioAPI, selector: string, attr?: string): string[] {
    return $(selector)
      .map((_, el) => {
        if (attr) {
          return $(el).attr(attr)?.trim() ?? '';
        }
        return $(el).text().trim();
      })
      .get()
      .filter(Boolean);
  }

  extractLinks($: cheerio.CheerioAPI, selector = 'a'): Array<{ text: string; href: string }> {
    return $(selector)
      .map((_, el) => ({
        text: $(el).text().trim(),
        href: $(el).attr('href') ?? '',
      }))
      .get()
      .filter((link) => link.href);
  }

  extractImages($: cheerio.CheerioAPI, selector = 'img'): Array<{ src: string; alt: string }> {
    return $(selector)
      .map((_, el) => ({
        src: $(el).attr('src') ?? $(el).attr('data-src') ?? '',
        alt: $(el).attr('alt') ?? '',
      }))
      .get()
      .filter((img) => img.src);
  }

  extractJsonFromScript($: cheerio.CheerioAPI, selector: string): Record<string, unknown> | null {
    const scriptContent = $(selector).first().html();
    if (!scriptContent) return null;

    try {
      const jsonMatch = scriptContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  resolveUrls($: cheerio.CheerioAPI, selector: string, baseUrl: string, attr = 'href'): string[] {
    return this.extractAll($, selector, attr).map((url) => {
      try {
        return new URL(url, baseUrl).href;
      } catch {
        return url;
      }
    });
  }
}
