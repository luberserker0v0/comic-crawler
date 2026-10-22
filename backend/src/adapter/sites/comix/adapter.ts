import {
  AdapterBase,
  ChapterImagesCapability,
  ComicError,
  CommonCapability,
  ErrorType,
  VerificationCapability,
} from '../../base';

export class ComixAdapter extends AdapterBase {
  readonly id = 'comix';
  readonly name = 'Comix';
  readonly domains = ['comix.to'];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = {
    verification: true,
    metadata: false,
    chapterImages: true,
  };
  readonly common: ComixCommonCapability = new ComixCommonCapability(this);
  readonly verification: ComixVerificationCapability = new ComixVerificationCapability(this);
  readonly chapterImages: ComixChapterImagesCapability = new ComixChapterImagesCapability(this);
}

class ComixCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return /^(?:www\.)?comix\.to$/i.test(parsed.hostname)
        && /^\/title\/[^/]+\/\d+-chapter-[^/?#]+\/?$/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }
}

class ComixVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    const $ = this.adapter.parseHtml(input);
    const loadedReaderPages = $('.rpage-main .rpage-page[data-page]').filter((_, element) => {
      const page = $(element);
      const image = page.find('img.rpage-page__img').first();
      return Boolean(
        page.attr('data-comiccrawler-image-url')
        || image.attr('data-comiccrawler-src')
        || image.attr('src')
        || image.attr('data-src')
        || image.attr('data-lazy-src')
        || image.attr('srcset')
      );
    });
    if ($('.rpage-main').length > 0 && loadedReaderPages.length > 0) return false;
    return looksLikeComixChallenge(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return {
      supported: true,
      flow: 'Open the chapter through the task-bound Browser Worker, complete the Comix/Cloudflare verification, then resume the task with the same browser session.',
    };
  }
}

const BLOCK_SIGNALS = [
  'attention required! | cloudflare', 'sorry, you have been blocked', 'you are unable to access',
];
const CHALLENGE_SIGNALS = [
  ...BLOCK_SIGNALS, 'cdn-cgi/challenge-platform', 'window.__cf$cv', 'cf-chl', 'cf-error',
  'cloudflare ray id', 'verify you are human', 'checking if the site connection is secure',
  '<title>請稍候', '<title>请稍候', '正在執行安全驗證', '正在执行安全验证', '人机验证', '人機驗證',
];

function looksLikeComixChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  if (!CHALLENGE_SIGNALS.some((signal) => lower.includes(signal))) return false;
  const imageCount = (html.match(/<img\b/gi) ?? []).length;
  const anchorCount = (html.match(/<a\s/gi) ?? []).length;
  return (imageCount === 0 && anchorCount === 0)
    || BLOCK_SIGNALS.some((signal) => lower.includes(signal));
}

class ComixChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    const pageNodes = $('.rpage-main__inner .rpage-page[data-page]');
    const pages = pageNodes.map((index, element) => {
      const node = $(element);
      const page = Number.parseInt(node.attr('data-page') ?? '', 10);
      const raw = readerImageSource(node, node.find('img.rpage-page__img').first());
      return { page: Number.isFinite(page) ? page : index + 1, url: resolveHttpImageUrl(this.adapter, sourceUrl, raw) };
    }).get().filter((entry): entry is { page: number; url: string } => Boolean(entry.url));
    pages.sort((left, right) => left.page - right.page);
    const urls = Array.from(new Set(pages.map((entry) => entry.url)));
    assertAllPagesLoaded(this.adapter.id, sourceUrl, pageNodes.length, urls.length);
    return urls;
  }
}

function readerImageSource(page: { attr(name: string): string | undefined }, image: { attr(name: string): string | undefined }): string | undefined {
  return page.attr('data-comiccrawler-image-url') ?? image.attr('data-comiccrawler-src')
    ?? image.attr('src') ?? image.attr('data-src') ?? image.attr('data-lazy-src')
    ?? firstSrcsetUrl(image.attr('srcset'));
}

function assertAllPagesLoaded(adapterId: string, sourceUrl: string, expected: number, actual: number): void {
  if (expected === 0 || actual === expected) return;
  throw new ComicError(
    `Comix rendered ${expected} reader pages, but only ${actual} image URLs were loaded.`,
    ErrorType.PARSING_ERROR, true,
    { adapterId, url: sourceUrl, expectedImageCount: expected, extractedImageCount: actual, lazyImagesIncomplete: true }
  );
}

function firstSrcsetUrl(srcset: string | undefined): string | undefined {
  return srcset?.split(',')[0]?.trim().split(/\s+/)[0];
}

function resolveHttpImageUrl(adapter: AdapterBase, baseUrl: string, raw: string | undefined): string {
  const value = raw?.trim();
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) return '';
  try {
    const resolved = adapter.resolveUrl(baseUrl, value);
    const parsed = new URL(resolved);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}
