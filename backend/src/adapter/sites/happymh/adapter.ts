import type { ChapterInfo, ComicMetadata, ComicStatus } from '@comiccrawler/shared';
import * as cheerio from 'cheerio';
import { AdapterBase, ChapterImagesCapability, CommonCapability, MetadataCapability } from '../../base';
import { HAPPYMH_SELECTORS } from './selectors';

export class HappyMhAdapter extends AdapterBase {
  readonly id = 'happymh';
  readonly name = 'HappyMH';
  readonly domains = ['m.happymh.com'];
  readonly parseMode = 'dynamic' as const;
  readonly capabilities = {
    verification: true,
    metadata: true,
    chapterImages: true,
  };
  readonly common: HappyMhCommonCapability = new HappyMhCommonCapability(this);
  readonly metadata: HappyMhMetadataCapability = new HappyMhMetadataCapability(this);
  readonly chapterImages: HappyMhChapterImagesCapability = new HappyMhChapterImagesCapability(this);
}

class HappyMhCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return /^https?:\/\/m\.happymh\.com\/(?:manga|mangaread)\//i.test(url);
  }
}

class HappyMhMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, _sourceUrl: string): string {
    return extractMangaTitle(this.adapter.asCheerio(document));
  }

  extractAuthor(document: unknown, _sourceUrl: string): string | undefined {
    return firstText(this.adapter.asCheerio(document), ['.author', '.comic-author', '.detail-author', 'a[href*="author"]']) || undefined;
  }

  extractDescription(document: unknown, _sourceUrl: string): string | undefined {
    return firstText(this.adapter.asCheerio(document), [
      '.description',
      '.summary',
      '.intro',
      '.comic-description',
      '.detail-desc',
      'meta[name="description"]',
    ]) || undefined;
  }

  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined {
    return firstAttr(this.adapter, this.adapter.asCheerio(document), [
      ['meta[property="og:image"]', 'content'],
      ['.cover img', 'data-src'],
      ['.cover img', 'src'],
      ['.comic-cover img', 'data-src'],
      ['.comic-cover img', 'src'],
      ['.detail-cover img', 'data-src'],
      ['.detail-cover img', 'src'],
      ['img[src*="cover"]', 'src'],
    ], sourceUrl) || undefined;
  }

  extractTags(document: unknown, _sourceUrl: string): string[] {
    return allText(this.adapter.asCheerio(document), ['.tags a', '.tag a', 'a[href*="tag"]', 'a[href*="category"]']);
  }

  extractStatus(_document: unknown, _sourceUrl: string): ComicStatus {
    return 'unknown';
  }

  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    return extractChapters(this.adapter, this.adapter.asCheerio(document), sourceUrl);
  }
}

class HappyMhChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, chapterUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
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
    const urls: string[] = [];

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        const node = $(element);
        const raw = node.attr('data-original')
          ?? node.attr('data-src')
          ?? node.attr('data-url')
          ?? node.attr('src')
          ?? '';
        const resolved = cleanImageUrl(this.adapter, raw, chapterUrl);
        if (!resolved || seen.has(resolved) || !looksLikeComicImageUrl(resolved)) return;
        seen.add(resolved);
        urls.push(resolved);
      });
    }

    for (const url of extractImageUrlsFromScripts(this.adapter, $.html(), chapterUrl)) {
      if (seen.has(url) || !looksLikeComicImageUrl(url)) continue;
      seen.add(url);
      urls.push(url);
    }

    return urls;
  }
}

function extractChapters(adapter: AdapterBase, $: cheerio.CheerioAPI, baseUrl: string): ComicMetadata['chapters'] {
  const seen = new Set<string>();
  const chapters: ComicMetadata['chapters'] = [];
  $(HAPPYMH_SELECTORS.chapters.item).each((_, element) => {
    const node = $(element);
    const href = node.attr('href') ?? '';
    if (!href) return;
    const url = adapter.resolveUrl(baseUrl, href);
    if (!/\/mangaread\/[^/]+\/[^/?#]+/i.test(new URL(url).pathname) || seen.has(url)) return;
    const title = node.text().replace(/\s+/g, ' ').trim();
    if (isNonCatalogChapterLink(title)) return;
    seen.add(url);
    chapters.push({
      id: deriveChapterId(url, chapters.length),
      title: title || `Chapter ${chapters.length + 1}`,
      url,
      number: chapters.length + 1,
    });
  });
  return chapters;
}

function firstText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const node = $(selector).first();
    const value = node.attr('content') ?? node.text();
    if (value.trim()) return value.replace(/\s+/g, ' ').trim();
  }
  return '';
}

function extractMangaTitle($: cheerio.CheerioAPI): string {
  const candidates = [
    ...textCandidates($, ['.detail-title', '.comic-title', '.manga-title']),
    ...attrCandidates($, [
      ['meta[property="og:title"]', 'content'],
      ['meta[name="twitter:title"]', 'content'],
    ]),
    ...textCandidates($, ['title', 'h1', '.title']),
  ];

  for (const candidate of candidates) {
    const cleaned = cleanMangaTitle(candidate);
    if (cleaned && !isGenericMangaTitle(cleaned)) return cleaned;
  }

  return '';
}

function textCandidates($: cheerio.CheerioAPI, selectors: string[]): string[] {
  const values: string[] = [];
  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const value = $(element).text().replace(/\s+/g, ' ').trim();
      if (value) values.push(value);
    });
  }
  return values;
}

function attrCandidates($: cheerio.CheerioAPI, candidates: Array<[string, string]>): string[] {
  const values: string[] = [];
  for (const [selector, attr] of candidates) {
    $(selector).each((_, element) => {
      const value = $(element).attr(attr)?.replace(/\s+/g, ' ').trim();
      if (value) values.push(value);
    });
  }
  return values;
}

function cleanMangaTitle(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:-|_|｜|\|)\s*(?:HappyMH|嗨皮漫画|嗨皮漫畫|.*漫画.*|.*漫畫.*).*$/i, '')
    .replace(/\s*(?:漫画全集|漫畫全集|在线观看|線上看|最新章节|最新章節).*$/i, '')
    .trim();
}

function isGenericMangaTitle(title: string): boolean {
  const normalized = title.trim();
  return /^(HappyMH|嗨皮漫画|嗨皮漫畫|漫画|漫畫|漫画全集|漫畫全集|首页|首頁)$/i.test(normalized)
    || /(?:人机验证|人機驗證|blocked|unable to access|cloudflare)/i.test(normalized);
}

function allText($: cheerio.CheerioAPI, selectors: string[]): string[] {
  const values = new Set<string>();
  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const value = $(element).text().replace(/\s+/g, ' ').trim();
      if (value) values.add(value);
    });
  }
  return Array.from(values);
}

function firstAttr(adapter: AdapterBase, $: cheerio.CheerioAPI, candidates: Array<[string, string]>, baseUrl: string): string {
  for (const [selector, attr] of candidates) {
    const value = $(selector).first().attr(attr)?.trim();
    if (value) return adapter.resolveUrl(baseUrl, value);
  }
  return '';
}

function extractImageUrlsFromScripts(adapter: AdapterBase, html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const regex = /(?:"|')([^"']+\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^"']*)?)(?:"|')/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const resolved = cleanImageUrl(adapter, match[1] ?? '', baseUrl);
    if (resolved && looksLikeImageUrl(resolved)) urls.add(resolved);
  }
  return Array.from(urls);
}

function cleanImageUrl(adapter: AdapterBase, raw: string, baseUrl: string): string {
  const value = raw.trim();
  if (!value || value.startsWith('data:')) return '';
  return adapter.resolveUrl(baseUrl, value);
}

function looksLikeImageUrl(url: string): boolean {
  return /\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?|$)/i.test(url);
}

function looksLikeComicImageUrl(url: string): boolean {
  if (!looksLikeImageUrl(url)) return false;
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'ruicdn.happymh.com' || hostname === 'img.happymh.com') return true;
  if (hostname.endsWith('.happymh.com') && /\/(?:comic|manga|chapter|read|upload|images?)\//i.test(parsed.pathname)) {
    return !/\/(?:mcover|imgs|next|static|assets?)\//i.test(parsed.pathname);
  }
  return false;
}

function isNonCatalogChapterLink(title: string): boolean {
  return /^(首页|首頁|目录|目錄|开始阅读|開始閱讀|下一页|下一頁|上一页|上一頁|返回|下载|下載)$/i.test(title.trim());
}

function deriveChapterId(url: string, index: number): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return segments.at(-1) ?? `chapter-${index + 1}`;
}
