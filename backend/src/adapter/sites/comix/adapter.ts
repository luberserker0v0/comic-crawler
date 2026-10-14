import { AdapterBase, ChapterImagesCapability, CommonCapability, VerificationCapability } from '../../base';
import { ComicError, ErrorType } from '../../../error/types';

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
    return /(?:cf-chl-|cdn-cgi\/challenge-platform|正在執行安全驗證|performing security verification|just a moment|verify you are human|驗證並確認您不是機器人)/i.test(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return {
      supported: true,
      flow: 'Open the chapter through the remote Playwright handoff, complete the Comix/Cloudflare verification, then resume the task with the same browser context.',
    };
  }
}

class ComixChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    const pageNodes = $('.rpage-main__inner .rpage-page[data-page]');
    const pages = pageNodes
      .map((index, element) => {
        const page = Number.parseInt($(element).attr('data-page') ?? '', 10);
        const image = $(element).find('img.rpage-page__img').first();
        const raw = image.attr('src')
          ?? image.attr('data-src')
          ?? image.attr('data-lazy-src')
          ?? firstSrcsetUrl(image.attr('srcset'));
        return {
          page: Number.isFinite(page) ? page : index + 1,
          url: resolveHttpImageUrl(this.adapter, sourceUrl, raw),
        };
      })
      .get()
      .filter((entry): entry is { page: number; url: string } => Boolean(entry.url))
      .sort((left, right) => left.page - right.page);

    const urls = Array.from(new Set(pages.map((entry) => entry.url)));
    if (pageNodes.length > 0 && urls.length !== pageNodes.length) {
      throw new ComicError(
        `Comix rendered ${pageNodes.length} reader pages, but only ${urls.length} image URLs were loaded.`,
        ErrorType.PARSING_ERROR,
        true,
        {
          adapterId: this.adapter.id,
          url: sourceUrl,
          expectedImageCount: pageNodes.length,
          extractedImageCount: urls.length,
          lazyImagesIncomplete: true,
        }
      );
    }

    return urls;
  }
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
