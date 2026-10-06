import type { AdapterFunctionTestResponse } from '@comiccrawler/shared';
import type * as cheerio from 'cheerio';

export type AdapterFunctionId =
  | 'matchUrl'
  | 'detectVerificationRequired'
  | 'describeVerificationHandoff'
  | 'extractTitle'
  | 'extractAuthor'
  | 'extractDescription'
  | 'extractCoverUrl'
  | 'extractTags'
  | 'extractStatus'
  | 'extractChapterList'
  | 'extractChapterImageUrls';

export type AdapterCrawlerMode = 'static' | 'playwright';

export type AdapterFunctionTiming = NonNullable<AdapterFunctionTestResponse['timings']>[number];

export interface VerifiedChallengeDocument {
  document: cheerio.CheerioAPI;
  page: { url: string; title: string; html: string };
}
