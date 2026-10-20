import * as cheerio from 'cheerio';
import type {
  AdapterFunctionRecommendedAction,
  DomReadinessReport,
  DomReadinessTarget,
} from '@comiccrawler/shared';
import { looksLikeAntiBotChallenge } from '../crawler/anti-bot';

export interface DomReadinessInput {
  url: string;
  html: string;
  target: DomReadinessTarget;
  functionId?: string;
  extractionResult?: unknown;
}

const READER_IMAGE_SELECTOR = [
  'main img[src]', 'main img[data-src]', 'main img[data-original]', 'article img[src]',
  'article img[data-src]', '.reader img[src]', '.reader img[data-src]', '.reader img[data-original]',
  '.comic img[src]', '.comic img[data-src]', '.chapter img[src]', '.chapter img[data-src]',
  'img[src*="happymh"]', 'img[data-src*="happymh"]', 'main [data-comiccrawler-image-url]',
  'article [data-comiccrawler-image-url]', '.reader [data-comiccrawler-image-url]',
  '.comic [data-comiccrawler-image-url]', '.chapter [data-comiccrawler-image-url]',
].join(', ');
const PAGE_CONTAINER_SELECTOR = [
  '.rpage-page', '.reader-page', '.chapter-page', '[class*="reader-page"]',
  '[class*="chapter-page"]', '[data-page][class*="page"]',
].join(', ');

export class DomReadinessChecker {
  check(input: DomReadinessInput): DomReadinessReport {
    const html = input.html ?? '';
    if (!html.trim()) return report(input.target, 0, ['DOM is empty.'], 'capture_verified_fixture');
    if (looksLikeAntiBotChallenge(html)) {
      return report(input.target, 0.05, ['DOM looks like an anti-bot or human verification page.'], 'human_verification_handoff');
    }
    const $ = cheerio.load(html);
    if (input.target === 'metadata') return metadataReadiness(input.target, $);
    if (input.target === 'chapterImages') return chapterReadiness(input, $);
    return fallbackReadiness(input);
  }
}

function metadataReadiness(target: DomReadinessTarget, $: cheerio.CheerioAPI): DomReadinessReport {
  const titleSignals = [
    $('meta[property="og:title"]').attr('content'), $('meta[name="twitter:title"]').attr('content'),
    $('h1').first().text(), $('title').text(),
  ].filter((value) => value && value.trim().length > 0);
  const chapterLinks = $('a[href*="/mangaread/"], a[href*="/chapter"], a[href*="chapter"]').length;
  const reasons: string[] = [];
  if (titleSignals.length === 0) reasons.push('No strong title signal was found.');
  if (chapterLinks === 0) reasons.push('No chapter-list links were found in the metadata DOM.');
  const confidence = clamp(0.35 + (titleSignals.length > 0 ? 0.3 : 0) + (chapterLinks > 0 ? 0.3 : 0));
  return report(target, confidence, reasons, confidence >= 0.75 ? 'continue' : 'capture_verified_fixture');
}

function chapterReadiness(input: DomReadinessInput, $: cheerio.CheerioAPI): DomReadinessReport {
  const reasons: string[] = [];
  const counts = chapterDomCounts($);
  if (counts.imageCount === 0) reasons.push('No image elements were found in the chapter DOM.');
  if (counts.imageCount > 0 && counts.readerImageCount === 0) reasons.push('Images exist, but none look like reader images.');
  const incomplete = incompleteChapterReport(input, counts, reasons);
  if (incomplete) return incomplete;
  const confidence = clamp(0.3 + (counts.imageCount > 0 ? 0.25 : 0) + (counts.readerImageCount > 0 ? 0.35 : 0));
  return report(input.target, confidence, reasons, confidence >= 0.75 ? 'continue' : 'capture_verified_fixture');
}

function chapterDomCounts($: cheerio.CheerioAPI) {
  const imageCount = $('img[src], img[data-src], img[data-original], image[href], [data-comiccrawler-image-url]').length;
  const readerImageCount = $(READER_IMAGE_SELECTOR).length;
  const pageContainers = $(PAGE_CONTAINER_SELECTOR);
  const loadedPageCount = pageContainers.filter((_, element) => {
    const node = $(element);
    return node.is('img[src], img[data-src], img[data-original], image[href], [data-comiccrawler-image-url]')
      || node.find('img[src], img[data-src], img[data-original], image[href], source[srcset]').length > 0;
  }).length;
  return { imageCount, readerImageCount, pageContainerCount: pageContainers.length, loadedPageCount };
}

function incompleteChapterReport(input: DomReadinessInput, counts: ReturnType<typeof chapterDomCounts>,
  reasons: string[]): DomReadinessReport | undefined {
  if (counts.pageContainerCount >= 2 && counts.loadedPageCount < counts.pageContainerCount) {
    reasons.push(`Reader DOM is incomplete: ${counts.loadedPageCount} of ${counts.pageContainerCount} page containers contain loaded images.`);
    return report(input.target, 0.45, reasons, 'capture_verified_fixture');
  }
  const extracted = getExtractedImageCount(input.extractionResult);
  if (counts.pageContainerCount >= 2 && extracted !== undefined && extracted < counts.pageContainerCount) {
    reasons.push(`Extraction is incomplete: ${extracted} image URLs for ${counts.pageContainerCount} reader pages.`);
    return report(input.target, 0.45, reasons, 'manual_review');
  }
  return undefined;
}

function fallbackReadiness(input: DomReadinessInput): DomReadinessReport {
  if (input.extractionResult !== undefined && isEmptyExtractionResult(input.extractionResult)) {
    return report(input.target, 0.4, ['The extraction result is empty.'], 'manual_review');
  }
  return report(input.target, 0.85, [], 'continue');
}

function getExtractedImageCount(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return undefined;
  const imageUrls = (value as { imageUrls?: unknown }).imageUrls;
  return Array.isArray(imageUrls) ? imageUrls.length : undefined;
}

function report(
  target: DomReadinessTarget,
  confidence: number,
  reasons: string[],
  recommendedAction: AdapterFunctionRecommendedAction
): DomReadinessReport {
  return {
    target,
    confidence,
    reasons: reasons.length > 0 ? reasons : ['DOM passed the basic readiness checks.'],
    recommendedAction,
    status: recommendedAction === 'continue'
      ? 'ready'
      : recommendedAction === 'human_verification_handoff'
        ? 'human_verification_required'
        : 'needs_fixture_or_manual_review',
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function isEmptyExtractionResult(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((item) => isEmptyExtractionResult(item));
  }
  return false;
}
