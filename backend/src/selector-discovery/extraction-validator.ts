import * as cheerio from 'cheerio';
import type { SiteSelectors } from '@comiccrawler/shared';
import { DomExtractionStrategy } from '../crawler/extraction/strategies/dom';
import { fetchSafeHtml } from './safe-fetch';
import type { SelectorExtractionValidation } from './types';

export async function validateSelectorExtraction(input: {
  metadataUrl: string;
  selectors: SiteSelectors;
}): Promise<SelectorExtractionValidation> {
  const errors: string[] = [];
  const checkedAt = new Date().toISOString();
  const dom = new DomExtractionStrategy();

  let metadataTitle: string | undefined;
  let chapterCount = 0;
  let firstChapterUrl: string | undefined;
  let imageCount = 0;
  let firstImageUrl: string | undefined;

  try {
    const metadataFetch = await fetchSafeHtml(input.metadataUrl);
    const $ = cheerio.load(metadataFetch.html);
    const metadata = await dom.extractMetadata({
      $,
      baseUrl: metadataFetch.finalUrl,
      selectors: input.selectors,
      pageType: 'metadata',
    });
    metadataTitle = metadata.title;
    chapterCount = metadata.chapters.length;
    firstChapterUrl = metadata.chapters[0]?.url;
  } catch (error) {
    errors.push(`Metadata/chapter extraction failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (firstChapterUrl) {
    try {
      const chapterFetch = await fetchSafeHtml(firstChapterUrl);
      const $ = cheerio.load(chapterFetch.html);
      const images = await dom.extractImages({
        $,
        baseUrl: chapterFetch.finalUrl,
        selectors: input.selectors,
        pageType: 'images',
      });
      imageCount = images.length;
      firstImageUrl = images[0]?.url;
    } catch (error) {
      errors.push(`Image extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    errors.push('No chapter URL was available for image extraction validation.');
  }

  return {
    valid: errors.length === 0 && Boolean(metadataTitle) && chapterCount > 0 && imageCount > 0,
    checkedAt,
    metadata: {
      title: metadataTitle,
      chapterCount,
      firstChapterUrl,
    },
    images: firstChapterUrl
      ? {
          chapterUrl: firstChapterUrl,
          imageCount,
          firstImageUrl,
        }
      : undefined,
    errors,
  };
}

export async function validateChapterImageSelectorExtraction(input: {
  chapterUrl: string;
  selectors: { images?: SiteSelectors['images'] };
}): Promise<SelectorExtractionValidation> {
  const errors: string[] = [];
  const checkedAt = new Date().toISOString();
  let imageCount = 0;
  let firstImageUrl: string | undefined;

  if (!input.selectors.images?.item || !input.selectors.images.srcAttr) {
    errors.push('Image selectors are incomplete.');
  } else {
    try {
      const chapterFetch = await fetchSafeHtml(input.chapterUrl);
      const $ = cheerio.load(chapterFetch.html);
      const selectors = input.selectors.images;
      const root = selectors.container ? $(selectors.container) : $.root();
      const images = root
        .find(selectors.item)
        .map((index, element) => {
          const value = $(element).attr(selectors.srcAttr) ?? $(element).attr('src') ?? '';
          return value ? { url: new URL(value, chapterFetch.finalUrl).href, index } : null;
        })
        .get()
        .filter((image): image is { url: string; index: number } => Boolean(image));
      imageCount = images.length;
      firstImageUrl = images[0]?.url;
    } catch (error) {
      errors.push(`Image extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    valid: errors.length === 0 && imageCount > 0,
    checkedAt,
    metadata: {
      chapterCount: 0,
    },
    images: {
      chapterUrl: input.chapterUrl,
      imageCount,
      firstImageUrl,
    },
    errors,
  };
}
