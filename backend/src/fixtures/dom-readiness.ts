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

export class DomReadinessChecker {
  check(input: DomReadinessInput): DomReadinessReport {
    const reasons: string[] = [];
    const html = input.html ?? '';
    const $ = cheerio.load(html);

    if (!html.trim()) {
      return report(input.target, 0, ['DOM is empty.'], 'capture_verified_fixture');
    }

    if (looksLikeAntiBotChallenge(html)) {
      return report(input.target, 0.05, ['DOM looks like an anti-bot or human verification page.'], 'human_verification_handoff');
    }

    if (input.target === 'metadata') {
      const titleSignals = [
        $('meta[property="og:title"]').attr('content'),
        $('meta[name="twitter:title"]').attr('content'),
        $('h1').first().text(),
        $('title').text(),
      ].filter((value) => value && value.trim().length > 0);
      const chapterLinks = $('a[href*="/mangaread/"], a[href*="/chapter"], a[href*="chapter"]').length;

      if (titleSignals.length === 0) reasons.push('No strong title signal was found.');
      if (chapterLinks === 0) reasons.push('No chapter-list links were found in the metadata DOM.');

      const confidence = clamp(0.35 + (titleSignals.length > 0 ? 0.3 : 0) + (chapterLinks > 0 ? 0.3 : 0));
      return report(input.target, confidence, reasons, confidence >= 0.75 ? 'continue' : 'capture_verified_fixture');
    }

    if (input.target === 'chapterImages') {
      const imageCount = $('img[src], img[data-src], img[data-original], image[href]').length;
      const readerImageCount = $([
        'main img[src]',
        'main img[data-src]',
        'main img[data-original]',
        'article img[src]',
        'article img[data-src]',
        '.reader img[src]',
        '.reader img[data-src]',
        '.reader img[data-original]',
        '.comic img[src]',
        '.comic img[data-src]',
        '.chapter img[src]',
        '.chapter img[data-src]',
        'img[src*="happymh"]',
        'img[data-src*="happymh"]',
      ].join(', ')).length;
      if (imageCount === 0) reasons.push('No image elements were found in the chapter DOM.');
      if (imageCount > 0 && readerImageCount === 0) reasons.push('Images exist, but none look like reader images.');
      const confidence = clamp(0.3 + (imageCount > 0 ? 0.25 : 0) + (readerImageCount > 0 ? 0.35 : 0));
      return report(input.target, confidence, reasons, confidence >= 0.75 ? 'continue' : 'capture_verified_fixture');
    }

    if (input.extractionResult !== undefined && isEmptyExtractionResult(input.extractionResult)) {
      reasons.push('The extraction result is empty.');
      return report(input.target, 0.4, reasons, 'manual_review');
    }

    return report(input.target, 0.85, reasons, 'continue');
  }
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
