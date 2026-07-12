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
    return extractAuthorName(this.adapter.asCheerio(document));
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
    return extractTagsFromDetail(this.adapter.asCheerio(document));
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
  const mangaSlug = extractMangaSlug(baseUrl);
  const scopedLinks = [
    '#detail-app a[href*="/mangaread/"]',
    '.chapter-list a[href*="/mangaread/"]',
    '.chapterList a[href*="/mangaread/"]',
    '.catalog-list a[href*="/mangaread/"]',
    '.episode-list a[href*="/mangaread/"]',
    '.mh-chapter-list a[href*="/mangaread/"]',
  ].join(', ');
  const sameMangaLinks = mangaSlug ? $(`a[href*="/mangaread/${mangaSlug}/"]`) : cheerio.load('').root();
  const scopedCandidates = $(scopedLinks);
  const links = sameMangaLinks.length > scopedCandidates.length
    ? sameMangaLinks
    : scopedCandidates.length > 0
      ? scopedCandidates
      : $(HAPPYMH_SELECTORS.chapters.item);
  links.each((_, element) => {
    const node = $(element);
    const href = node.attr('href') ?? '';
    if (!href) return;
    const url = adapter.resolveUrl(baseUrl, href);
    const pathname = new URL(url).pathname;
    if (!/\/mangaread\/[^/]+\/[^/?#]+/i.test(pathname)) return;
    if (mangaSlug && !pathname.includes(`/mangaread/${mangaSlug}/`)) return;
    if (seen.has(url)) return;
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

function extractMangaSlug(url: string): string | undefined {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    if ((segments[0] === 'manga' || segments[0] === 'mangaread') && segments[1]) {
      return segments[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function firstText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const node = $(selector).first();
    const value = node.attr('content') ?? node.text();
    if (value.trim()) return value.replace(/\s+/g, ' ').trim();
  }
  return '';
}

const HAPPYMH_TAG_LABELS = [
  '\u79d1\u5e7b',
  '\u5192\u9669',
  '\u5192\u96aa',
  '\u8f7b\u5c0f\u8bf4',
  '\u8f15\u5c0f\u8aaa',
  '\u9b54\u5e7b',
];

function extractAuthorName($: cheerio.CheerioAPI): string | undefined {
  const detailAuthors = primaryDetailTexts($, { beforeLabels: HAPPYMH_TAG_LABELS })
    .map(cleanAuthorName)
    .filter((value) => value && !isGenericAuthorText(value));
  if (detailAuthors.length > 0) {
    return Array.from(new Set(detailAuthors)).join(', ');
  }

  const candidates = [
    ...textCandidates($, [
      '.detail-author',
      '.comic-author',
      '.author',
      '.book-author',
      '.bookauthor',
      '.info-author',
      'a[href*="author"]',
    ]),
    ...textCandidates($, ['.detail-info', '.comic-info', '.manga-info']),
    ...attrCandidates($, [['title', 'text']]).flatMap(extractAuthorCandidatesFromTitle),
  ];

  for (const candidate of candidates) {
    const cleaned = cleanAuthorName(candidate);
    if (cleaned && !isGenericAuthorText(cleaned)) return cleaned;
  }

  return undefined;
}

function extractTagsFromDetail($: cheerio.CheerioAPI): string[] {
  const tags = primaryDetailTexts($, { afterLabels: HAPPYMH_TAG_LABELS })
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => value && !isGenericTagText(value));
  if (tags.length > 0) return Array.from(new Set(tags));
  return allText($, ['.tags a', '.tag a', 'a[href*="tag"]', 'a[href*="category"]'])
    .filter((value) => !isGenericTagText(value));
}

function primaryDetailTexts(
  $: cheerio.CheerioAPI,
  options: { beforeLabels?: string[]; afterLabels?: string[] } = {}
): string[] {
  const values = $('.mg-detail a')
    .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean);
  if (values.length === 0) return [];
  const labels = options.beforeLabels ?? options.afterLabels ?? [];
  const firstLabelIndex = values.findIndex((value) => labels.includes(value));
  if (options.beforeLabels) return firstLabelIndex >= 0 ? values.slice(0, firstLabelIndex) : values.slice(0, 2);
  if (options.afterLabels) return firstLabelIndex >= 0 ? values.slice(firstLabelIndex) : [];
  return values;
}

function cleanAuthorName(raw: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  const labelPattern = /(?:\u4f5c\u8005|\u539f\u4f5c|\u4f5c[\u756b\u753b]|\u6f2b\u756b\u4f5c\u8005|\u6f2b\u753b\u4f5c\u8005|\u4f5c\u8005\u540d)\s*[:\uff1a]\s*([^|\uff5c/\uff0f\n\r]+)/i;
  const labelled = labelPattern.exec(compact)?.[1]?.trim();
  let value = labelled ?? compact;
  value = value.replace(/^(?:\u4f5c\u8005|\u539f\u4f5c|\u4f5c[\u756b\u753b]|\u6f2b\u756b\u4f5c\u8005|\u6f2b\u753b\u4f5c\u8005|\u4f5c\u8005\u540d)\s*[:\uff1a]\s*/i, '');
  return value
    .replace(/\s*(?:\u6f2b\u753b\u5168\u96c6|\u6f2b\u756b\u5168\u96c6|\u6f2b\u753b\u8bc4\u5206|\u6f2b\u756b\u8a55\u5206|\u8bc4\u5206|\u8a55\u5206|\u8be6\u60c5|\u8a73\u60c5|\u7b80\u4ecb|\u7c21\u4ecb).*$/i, '')
    .trim();
}

function isGenericAuthorText(value: string): boolean {
  return /^(?:\u4f5c\u8005|\u539f\u4f5c|\u4f5c\u756b|\u4f5c\u753b|\u6f2b\u756b\u4f5c\u8005|\u6f2b\u753b\u4f5c\u8005|\u672a\u77e5|\u6682\u65e0|\u66ab\u7121|\u65e0|\u7121)$/i.test(value);
}

function extractMangaTitle($: cheerio.CheerioAPI): string {
  const candidates = [
    ...attrCandidates($, [
      ['meta[property="og:title"]', 'content'],
      ['meta[name="twitter:title"]', 'content'],
    ]),
    ...textCandidates($, ['title']),
    ...textCandidates($, [
      'main .detail-title',
      'main .comic-title',
      'main .manga-title',
      'main .book-title',
      'main .bookname',
      'main .info-title',
      'main .detail-info h1',
      '.manga-detail .detail-title',
      '.manga-detail .comic-title',
      '.manga-detail .manga-title',
      '.manga-detail .book-title',
      '.manga-detail .bookname',
      '.manga-detail .info-title',
      '.manga-detail .detail-info h1',
    ]),
    ...textCandidates($, ['h1', '.title']),
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
      const raw = attr === 'text' ? $(element).text() : $(element).attr(attr);
      const value = raw?.replace(/\s+/g, ' ').trim();
      if (value) values.push(value);
    });
  }
  return values;
}

function cleanMangaTitle(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\s*[-\u2014]\s*.*$/u, '')
    .replace(/\u6f2b\u753b$/u, '')
    .replace(/\u6f2b\u756b$/u, '')
    .replace(/\s*(?:-|_|\uff5c|\|)\s*(?:HappyMH|\u55e8\u76ae\u6f2b\u753b|\u55e8\u76ae\u6f2b\u756b|.*\u6f2b\u753b.*|.*\u6f2b\u756b.*).*$/i, '')
    .replace(/\s*(?:\u6f2b\u753b\u5168\u96c6|\u6f2b\u756b\u5168\u96c6|\u6f2b\u753b\u8bc4\u5206|\u6f2b\u756b\u8a55\u5206|\u8bc4\u5206|\u8a55\u5206|\u5728\u7ebf\u89c2\u770b|\u7dda\u4e0a\u770b|\u6700\u65b0\u7ae0\u8282|\u6700\u65b0\u7ae0\u7bc0|\u76ee\u5f55|\u76ee\u9304).*$/i, '')
    .trim();
}

function extractAuthorCandidatesFromTitle(title: string): string[] {
  const match = title.match(/\u6f2b\u753b\s*[-\u2014]\s*([^\u2014|]+)/u) ?? title.match(/\u6f2b\u756b\s*[-\u2014]\s*([^\u2014|]+)/u);
  if (!match?.[1]) return [];
  return match[1]
    .split(/[,，、]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isGenericMangaTitle(title: string): boolean {
  const normalized = title.trim();
  return /^(?:HappyMH|\u55e8\u76ae\u6f2b\u753b|\u55e8\u76ae\u6f2b\u756b|\u6f2b\u753b|\u6f2b\u756b|\u6f2b\u753b\u5168\u96c6|\u6f2b\u756b\u5168\u96c6|\u6f2b\u753b\u8bc4\u5206|\u6f2b\u756b\u8a55\u5206|\u9996\u9875|\u9996\u9801|\u76ee\u5f55|\u76ee\u9304|\u5f00\u59cb\u9605\u8bfb|\u958b\u59cb\u95b1\u8b80)$/i.test(normalized)
    || /(?:\u4eba\u673a\u9a8c\u8bc1|\u4eba\u6a5f\u9a57\u8b49|blocked|unable to access|cloudflare)/i.test(normalized);
}

function isGenericTagText(value: string): boolean {
  return /^(?:\u4f5c\u8005|\u539f\u4f5c|\u4f5c\u756b|\u4f5c\u753b|\u8be6\u60c5|\u8a73\u60c5|\u7b80\u4ecb|\u7c21\u4ecb|\u76ee\u5f55|\u76ee\u9304|\u8fde\u8f7d\u4e2d|\u9023\u8f09\u4e2d|\u5b8c\u7ed3|\u5b8c\u7d50)$/i.test(value.trim());
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
  return /^(?:\u9996\u9875|\u9996\u9801|\u76ee\u5f55|\u76ee\u9304|\u5f00\u59cb\u9605\u8bfb|\u958b\u59cb\u95b1\u8b80|\u4e0a\u4e00\u7ae0|\u4e0b\u4e00\u7ae0|\u8bc4\u8bba|\u8a55\u8ad6|\u6536\u85cf|\u5206\u4eab)$/i.test(title.trim());
}

function deriveChapterId(url: string, index: number): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return segments.at(-1) ?? `chapter-${index + 1}`;
}
