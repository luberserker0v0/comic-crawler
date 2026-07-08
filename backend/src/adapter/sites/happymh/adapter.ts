import type { ComicMetadata, ImageInfo } from '@comiccrawler/shared';
import * as cheerio from 'cheerio';
import { BaseAdapter } from '../../base';
import { ComicError, ErrorType } from '../../../error/types';
import { HAPPYMH_SELECTORS } from './selectors';
import { HAPPYMH_SITE_MANIFEST } from './manifest';
import { buildExtractionFailureContext } from '../../../agent/error-context';

export class HappyMhAdapter extends BaseAdapter {
  readonly id = 'happymh';
  readonly name = 'HappyMH';
  readonly domains = ['m.happymh.com'];
  readonly parseMode = 'dynamic' as const;
  readonly capabilities = {
    verification: true,
    metadata: true,
    chapterImages: true,
  };

  matchUrl(url: string): boolean {
    return /^https?:\/\/m\.happymh\.com\/(?:manga|mangaread)\//i.test(url);
  }

  async fetchMetadata(url: string): Promise<ComicMetadata> {
    const html = await this.fetchHtml(url);
    const $ = this.parseHtml(html);
    const title = this.firstText($, [
      '.detail-title',
      '.comic-title',
      '.manga-title',
      'meta[property="og:title"]',
      'h1',
      '.title',
      'title',
    ]);
    const chapters = this.extractChapters($, url);

    if (!title || chapters.length === 0) {
      throw new ComicError(
        `HappyMH metadata extraction returned incomplete result for ${url}`,
        ErrorType.PARSING_ERROR,
        false,
        buildExtractionFailureContext({
          adapterId: this.id,
          manifest: HAPPYMH_SITE_MANIFEST,
          pageType: 'metadata',
          url,
          html,
          message: 'Missing title or chapter list.',
        })
      );
    }

    return {
      id: this.deriveMangaId(url),
      title,
      author: this.firstText($, ['.author', '.comic-author', '.detail-author', 'a[href*="author"]']) || undefined,
      coverUrl: this.firstAttr($, [
        ['meta[property="og:image"]', 'content'],
        ['.cover img', 'data-src'],
        ['.cover img', 'src'],
        ['.comic-cover img', 'data-src'],
        ['.comic-cover img', 'src'],
        ['.detail-cover img', 'data-src'],
        ['.detail-cover img', 'src'],
        ['img[src*="cover"]', 'src'],
      ], url) || undefined,
      status: 'unknown',
      tags: this.allText($, ['.tags a', '.tag a', 'a[href*="tag"]', 'a[href*="category"]']),
      description: this.firstText($, [
        '.description',
        '.summary',
        '.intro',
        '.comic-description',
        '.detail-desc',
        'meta[name="description"]',
      ]) || undefined,
      chapters,
    };
  }

  async fetchChapterImages(chapterUrl: string): Promise<ImageInfo[]> {
    const html = await this.fetchHtml(chapterUrl);
    const $ = this.parseHtml(html);
    const selectors = [
      '#cp_image img',
      '#cp_img img',
      '.comicpage img',
      '.reader img',
      '.read-content img',
      '.chapter-content img',
      'img[data-original]',
      'img[data-src]',
    ];
    const seen = new Set<string>();
    const images: ImageInfo[] = [];

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        const node = $(element);
        const raw = node.attr('data-original')
          ?? node.attr('data-src')
          ?? node.attr('data-url')
          ?? node.attr('src')
          ?? '';
        const resolved = this.cleanImageUrl(raw, chapterUrl);
        if (!resolved || seen.has(resolved) || !this.looksLikeComicImageUrl(resolved)) return;
        seen.add(resolved);
        images.push({
          url: resolved,
          index: images.length,
          filename: `${String(images.length + 1).padStart(3, '0')}.${this.extensionFor(resolved)}`,
        });
      });
    }

    for (const url of this.extractImageUrlsFromScripts(html, chapterUrl)) {
      if (seen.has(url) || !this.looksLikeComicImageUrl(url)) continue;
      seen.add(url);
      images.push({
        url,
        index: images.length,
        filename: `${String(images.length + 1).padStart(3, '0')}.${this.extensionFor(url)}`,
      });
    }

    if (images.length === 0) {
      throw new ComicError(
        `HappyMH image extraction returned no result for ${chapterUrl}`,
        ErrorType.PARSING_ERROR,
        false,
        buildExtractionFailureContext({
          adapterId: this.id,
          manifest: HAPPYMH_SITE_MANIFEST,
          pageType: 'images',
          url: chapterUrl,
          html,
          message: 'No image URLs were found.',
        })
      );
    }

    return images;
  }

  private extractChapters($: cheerio.CheerioAPI, baseUrl: string): ComicMetadata['chapters'] {
    const seen = new Set<string>();
    const chapters: ComicMetadata['chapters'] = [];
    $(HAPPYMH_SELECTORS.chapters.item).each((_, element) => {
      const node = $(element);
      const href = node.attr('href') ?? '';
      if (!href) return;
      const url = this.resolveUrl(baseUrl, href);
      if (!/\/mangaread\/[^/]+\/[^/?#]+/i.test(new URL(url).pathname) || seen.has(url)) return;
      const title = node.text().replace(/\s+/g, ' ').trim();
      if (this.isNonCatalogChapterLink(title)) return;
      seen.add(url);
      chapters.push({
        id: this.deriveChapterId(url, chapters.length),
        title: title || `Chapter ${chapters.length + 1}`,
        url,
        number: chapters.length + 1,
      });
    });
    return chapters;
  }

  private firstText($: cheerio.CheerioAPI, selectors: string[]): string {
    for (const selector of selectors) {
      const node = $(selector).first();
      const value = node.attr('content') ?? node.text();
      if (value.trim()) return value.replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  private allText($: cheerio.CheerioAPI, selectors: string[]): string[] {
    const values = new Set<string>();
    for (const selector of selectors) {
      $(selector).each((_, element) => {
        const value = $(element).text().replace(/\s+/g, ' ').trim();
        if (value) values.add(value);
      });
    }
    return Array.from(values);
  }

  private firstAttr($: cheerio.CheerioAPI, candidates: Array<[string, string]>, baseUrl: string): string {
    for (const [selector, attr] of candidates) {
      const value = $(selector).first().attr(attr)?.trim();
      if (value) return this.resolveUrl(baseUrl, value);
    }
    return '';
  }

  private extractImageUrlsFromScripts(html: string, baseUrl: string): string[] {
    const urls = new Set<string>();
    const regex = /(?:"|')([^"']+\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^"']*)?)(?:"|')/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const resolved = this.cleanImageUrl(match[1] ?? '', baseUrl);
      if (resolved && this.looksLikeImageUrl(resolved)) urls.add(resolved);
    }
    return Array.from(urls);
  }

  private cleanImageUrl(raw: string, baseUrl: string): string {
    const value = raw.trim();
    if (!value || value.startsWith('data:')) return '';
    return this.resolveUrl(baseUrl, value);
  }

  private looksLikeImageUrl(url: string): boolean {
    return /\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?|$)/i.test(url);
  }

  private looksLikeComicImageUrl(url: string): boolean {
    if (!this.looksLikeImageUrl(url)) return false;
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'ruicdn.happymh.com' || hostname === 'img.happymh.com') return true;
    if (hostname.endsWith('.happymh.com') && /\/(?:comic|manga|chapter|read|upload|images?)\//i.test(parsed.pathname)) {
      return !/\/(?:mcover|imgs|next|static|assets?)\//i.test(parsed.pathname);
    }
    return false;
  }

  private isNonCatalogChapterLink(title: string): boolean {
    return /^(开始阅读|開始閱讀|继续阅读|繼續閱讀|阅读|閱讀)$/i.test(title.trim());
  }

  private deriveMangaId(url: string): string {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments.at(-1) ?? 'happymh-manga';
  }

  private deriveChapterId(url: string, index: number): string {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments.at(-1) ?? `chapter-${index + 1}`;
  }

  private extensionFor(url: string): string {
    return /\.(jpg|jpeg|png|webp|gif|avif)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg';
  }
}
