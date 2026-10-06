import * as cheerio from 'cheerio';
import { DEFAULTS } from '@comiccrawler/shared';
import type {
  AdapterDomSource,
  AdapterFunctionTestResponse,
  DomReadinessReport,
  DomReadinessTarget,
} from '@comiccrawler/shared';
import type { AdapterRegistry } from '../../adapter/registry';
import { getAdapterCapabilities } from '../../adapter/registry';
import { looksLikeAntiBotChallenge } from '../../crawler/anti-bot';
import { PlaywrightHtmlRenderer } from '../../crawler/html-renderer';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { ChallengeDiscoveryJob } from '../../challenge/discovery-types';
import type {
  AdapterCrawlerMode,
  AdapterFunctionId,
  AdapterFunctionTiming,
  VerifiedChallengeDocument,
} from './adapter-function-types';

const STATIC_ADAPTER_FUNCTION_TIMEOUT_MS = 30_000;
const PLAYWRIGHT_ADAPTER_FUNCTION_TIMEOUT_MS = 15 * 60 * 1000;

class TimingCollector {
  private readonly entries: AdapterFunctionTiming[] = [];

  async measure<T>(step: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await operation();
    } finally {
      this.entries.push({ step, durationMs: Date.now() - startedAt });
    }
  }

  list(): AdapterFunctionTiming[] {
    return [...this.entries];
  }
}

export async function testAdapterFunction(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  functionId: AdapterFunctionId,
  url: string,
  options: {
    challengeDiscoveryId?: string;
    challengeDiscoveryService?: ChallengeDiscoveryService;
  } = {}
): Promise<AdapterFunctionTestResponse> {
  const startedAt = Date.now();
  const timings = new TimingCollector();
  const crawlerMode = defaultCrawlerModeForAdapter(adapter);
  const target = readinessTargetForFunction(functionId);
  const domSource = domSourceForCrawlerMode(crawlerMode);
  const renderer = crawlerMode === 'playwright'
    ? new PlaywrightHtmlRenderer({
        ...DEFAULTS.browser,
        mode: 'headless',
        challengeAutoAttempt: false,
        challengeWaitMs: 0,
      })
      : undefined;
  try {
    if (renderer && typeof (adapter as unknown as { setHtmlRenderer?: (renderer: unknown) => void }).setHtmlRenderer === 'function') {
      (adapter as unknown as { setHtmlRenderer: (renderer: unknown) => void }).setHtmlRenderer(renderer);
    }
    const challengeDiscoveryId = options.challengeDiscoveryId;
    const verifiedDocument = challengeDiscoveryId
      ? await timings.measure('dom_acquisition', () => loadVerifiedChallengeDocument(options.challengeDiscoveryService, challengeDiscoveryId, url, {
        settle: functionId === 'extractChapterImageUrls',
        allowNavigate: false,
      }))
      : undefined;
    const resultSummary: Record<string, unknown> = await withTimeout(() => runWithCrawlerMode(adapter, crawlerMode, async (): Promise<Record<string, unknown>> => {
      if (functionId === 'matchUrl') {
        return timings.measure('extraction', async () => ({ matched: adapter.matchUrl(url), domSource }));
      }
      if (functionId === 'detectVerificationRequired') {
        if (verifiedDocument) {
          const html = verifiedDocument.page.html;
          return timings.measure('extraction', async () => ({
            verificationRequired: looksLikeAntiBotChallenge(html),
            source: 'verified-browser-html',
            htmlLength: html.length,
            domSource: 'verified-fixture',
            ...verifiedDocumentSourceSummary(verifiedDocument),
          }));
        }
        return timings.measure('extraction', () => detectVerificationRequiredForUrl(adapter, url, crawlerMode));
      }
      if (functionId === 'describeVerificationHandoff') {
        const capabilities = getAdapterCapabilities(adapter);
        return timings.measure('extraction', async () => ({
          supported: capabilities.verification,
          matched: adapter.matchUrl(url),
          flow: await adapter.describeVerificationHandoff?.(),
          domSource,
        }));
      }
      if (isMetadataFunction(functionId)) {
        const document = verifiedDocument?.document ?? await timings.measure('dom_acquisition', () => loadAdapterDocument(adapter, url));
        const sourceSummary = verifiedDocument ? verifiedDocumentSourceSummary(verifiedDocument) : {};
        return timings.measure('extraction', async () => {
          if (functionId === 'extractTitle') return { title: await adapter.extractTitle?.(document, url), ...sourceSummary };
          if (functionId === 'extractAuthor') return { author: await adapter.extractAuthor?.(document, url), ...sourceSummary };
          if (functionId === 'extractDescription') return { description: await adapter.extractDescription?.(document, url), ...sourceSummary };
          if (functionId === 'extractCoverUrl') return { coverUrl: await adapter.extractCoverUrl?.(document, url), ...sourceSummary };
          if (functionId === 'extractTags') return { tags: await adapter.extractTags?.(document, url), ...sourceSummary };
          if (functionId === 'extractStatus') return { status: await adapter.extractStatus?.(document, url), ...sourceSummary };
          const chapters = await adapter.extractChapterList?.(document, url) ?? [];
          return {
            chapterCount: chapters.length,
            chapters,
            chapterDiagnostics: analyzeChapterExtractionInput(adapter, document, url, chapters),
            ...sourceSummary,
          };
        });
      }
      const document = verifiedDocument?.document ?? await timings.measure('dom_acquisition', () => loadAdapterDocument(adapter, url));
      return timings.measure('extraction', async () => {
        const urls = await adapter.extractChapterImageUrls?.(document, url) ?? [];
        return {
          imageUrlCount: urls.length,
          imageUrls: urls,
          ...(verifiedDocument ? verifiedDocumentSourceSummary(verifiedDocument) : {}),
        };
      });
    }), adapterFunctionTimeoutMs(crawlerMode));

    if (crawlerMode === 'playwright' && functionId === 'detectVerificationRequired' && resultSummary.verificationRequired === true) {
      return createVerificationRequiredResponse({
        adapterId: adapter.id,
        functionId,
        durationMs: Date.now() - startedAt,
        timings: timings.list(),
        url,
        error: typeof resultSummary.error === 'string' ? resultSummary.error : 'The page requires human verification.',
        challengeDiscoveryService: options.challengeDiscoveryService,
        existingChallengeDiscoveryId: options.challengeDiscoveryId,
      });
    }

    const readiness = combineReadiness(
      undefined,
      await timings.measure('readiness', async () => readinessForResult({
        target,
        functionId,
        resultSummary,
      }))
    );
    if (readiness.status !== 'ready') {
      return {
        ok: false,
        status: 'failed',
        adapterId: adapter.id,
        functionId,
        durationMs: Date.now() - startedAt,
        timings: timings.list(),
        domSource: verifiedDocument ? 'verified-fixture' : domSource,
        readiness,
        recommendedAction: readiness.recommendedAction,
        resultSummary,
        error: `DOM readiness is not trusted enough for this function: ${readiness.reasons.join(' ')}`,
        requiresVerification: false,
      };
    }

    return {
      ok: true,
      status: 'passed',
      adapterId: adapter.id,
      functionId,
      durationMs: Date.now() - startedAt,
      timings: timings.list(),
      domSource: verifiedDocument ? 'verified-fixture' : domSource,
      readiness,
      recommendedAction: readiness.recommendedAction,
      resultSummary,
      requiresVerification: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (crawlerMode === 'playwright' && shouldOfferHandoffForPlaywrightTest(message)) {
      return createVerificationRequiredResponse({
        adapterId: adapter.id,
        functionId,
        durationMs: Date.now() - startedAt,
        timings: timings.list(),
        url,
        error: message,
        challengeDiscoveryService: options.challengeDiscoveryService,
        existingChallengeDiscoveryId: options.challengeDiscoveryId,
      });
    }
    return {
      ok: false,
      status: 'failed',
      adapterId: adapter.id,
      functionId,
      durationMs: Date.now() - startedAt,
      timings: timings.list(),
      domSource,
      readiness: failureReadiness(target, message),
      recommendedAction: looksLikeVerificationRequired(message) ? 'human_verification_handoff' : 'manual_review',
      error: message,
      requiresVerification: false,
    };
  } finally {
    if (renderer && typeof (adapter as unknown as { setHtmlRenderer?: (renderer: undefined) => void }).setHtmlRenderer === 'function') {
      (adapter as unknown as { setHtmlRenderer: (renderer: undefined) => void }).setHtmlRenderer(undefined);
    }
    await renderer?.dispose().catch(() => undefined);
  }
}

export async function createVerificationRequiredResponse(input: {
  adapterId: string;
  functionId: AdapterFunctionId;
  durationMs: number;
  timings?: AdapterFunctionTiming[];
  url: string;
  error: string;
  challengeDiscoveryService?: ChallengeDiscoveryService;
  existingChallengeDiscoveryId?: string;
}): Promise<AdapterFunctionTestResponse> {
  const job = input.existingChallengeDiscoveryId
    ? await input.challengeDiscoveryService?.get(input.existingChallengeDiscoveryId)
    : await input.challengeDiscoveryService?.createDeferred({ url: input.url });

  return {
    ok: false,
    status: 'verification_required',
    adapterId: input.adapterId,
    functionId: input.functionId,
    durationMs: input.durationMs,
    timings: input.timings,
    domSource: 'handoff-required',
    readiness: {
      status: 'human_verification_required',
      target: readinessTargetForFunction(input.functionId),
      confidence: 0,
      reasons: [input.error],
      recommendedAction: 'human_verification_handoff',
    },
    recommendedAction: 'human_verification_handoff',
    error: input.error,
    requiresVerification: true,
    challengeDiscoveryId: job?.id ?? input.existingChallengeDiscoveryId,
    retryableAfterVerification: Boolean(job?.id ?? input.existingChallengeDiscoveryId),
    verificationMessage: job
      ? 'Human verification is required. Open the verification browser, complete the check, then continue this adapter function test.'
      : 'Human verification is required, but the handoff service is not available in this backend instance.',
  };
}

export async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Adapter function test timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function looksLikeVerificationRequired(message: string): boolean {
  return /anti-bot|human verification|人机验证|人機驗證|验证|驗證|challenge|cloudflare|sorry, you have been blocked|unable to access|HTTP\s+(?:401|403|429|503)\b/i.test(message);
}

export function shouldOfferHandoffForPlaywrightTest(message: string): boolean {
  return looksLikeVerificationRequired(message)
    || /(?:page\.goto|navigation|render|adapter function test).*timed out|timeout\s+\d+ms exceeded/i.test(message);
}

export function isMetadataFunction(functionId: AdapterFunctionId): boolean {
  return [
    'extractTitle',
    'extractAuthor',
    'extractDescription',
    'extractCoverUrl',
    'extractTags',
    'extractStatus',
    'extractChapterList',
  ].includes(functionId);
}

export function defaultCrawlerModeForAdapter(adapter: NonNullable<ReturnType<AdapterRegistry['get']>>): AdapterCrawlerMode {
  return adapter.parseMode === 'dynamic' || adapter.parseMode === 'interactive'
    ? 'playwright'
    : 'static';
}

export function adapterFunctionTimeoutMs(crawlerMode: AdapterCrawlerMode): number {
  return crawlerMode === 'playwright'
    ? PLAYWRIGHT_ADAPTER_FUNCTION_TIMEOUT_MS
    : STATIC_ADAPTER_FUNCTION_TIMEOUT_MS;
}

export async function runWithCrawlerMode<T>(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  crawlerMode: AdapterCrawlerMode,
  operation: () => Promise<T>
): Promise<T> {
  const mode = crawlerMode === 'playwright' ? 'headless' : 'static';
  const maybeScopedAdapter = adapter as unknown as {
    withHtmlFetchMode?: <TResult>(mode: 'static' | 'headless', fn: () => Promise<TResult>) => Promise<TResult>;
  };
  if (maybeScopedAdapter.withHtmlFetchMode) {
    return maybeScopedAdapter.withHtmlFetchMode(mode, operation);
  }
  return operation();
}

export async function loadAdapterDocument(adapter: NonNullable<ReturnType<AdapterRegistry['get']>>, url: string): Promise<unknown> {
  const maybeDocumentLoader = adapter as unknown as { loadDocument?: (url: string) => Promise<unknown> };
  if (!maybeDocumentLoader.loadDocument) {
    throw new Error(`Adapter "${adapter.id}" does not expose the internal document loader required for fine-grained function tests.`);
  }
  return maybeDocumentLoader.loadDocument(url);
}

export async function loadVerifiedChallengeDocument(
  challengeDiscoveryService: ChallengeDiscoveryService | undefined,
  challengeDiscoveryId: string,
  url: string,
  options: {
    settle?: boolean;
    allowNavigate?: boolean;
  } = {}
): Promise<VerifiedChallengeDocument> {
  if (!challengeDiscoveryService) {
    throw new Error('Human verification is required, but the handoff service is not available.');
  }

  const job = await challengeDiscoveryService.get(challengeDiscoveryId);
  if (!job) {
    throw new Error(`Challenge discovery job "${challengeDiscoveryId}" was not found.`);
  }
  if (job.status !== 'ready') {
    throw new Error(createChallengeNotReadyMessage(job));
  }

  const snapshot = await challengeDiscoveryService.readCdpPageSnapshot(challengeDiscoveryId, job.browserCdpUrl, {
    settle: options.settle,
    allowNavigate: options.allowNavigate,
  });
  if (!sameDocumentPath(snapshot.page.url, url)) {
    throw new Error(`Verified browser page does not match the test URL. Browser page: ${snapshot.page.url}`);
  }
  return {
    document: cheerio.load(snapshot.page.html),
    page: snapshot.page,
  };
}

export function createChallengeNotReadyMessage(job: ChallengeDiscoveryJob): string {
  return [
    `Human verification is still required for challenge job ${job.id}.`,
    job.error,
  ].filter(Boolean).join(' ');
}

export function sameDocumentPath(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.hostname === rightUrl.hostname && normalizePathname(leftUrl.pathname) === normalizePathname(rightUrl.pathname);
  } catch {
    return false;
  }
}

export function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

export function verifiedDocumentSourceSummary(verifiedDocument: VerifiedChallengeDocument): Record<string, unknown> {
  return {
    sourcePageUrl: verifiedDocument.page.url,
    sourcePageTitle: verifiedDocument.page.title,
    sourceHtmlLength: verifiedDocument.page.html.length,
  };
}

export function analyzeChapterExtractionInput(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  document: unknown,
  sourceUrl: string,
  chapters: Array<{ url: string; title?: string }>
): Record<string, unknown> {
  const maybeCheerioAdapter = adapter as unknown as { asCheerio?: (document: unknown) => cheerio.CheerioAPI };
  if (!maybeCheerioAdapter.asCheerio) {
    return { available: false, reason: 'Adapter does not expose a Cheerio document helper.' };
  }

  const $ = maybeCheerioAdapter.asCheerio(document);
  const sourceSlug = extractPathSegment(sourceUrl, ['manga', 'mangaread']);
  const allMangareadLinks = collectLinks($, sourceUrl, 'a[href*="/mangaread/"]');
  const sameSlugLinks = sourceSlug
    ? allMangareadLinks.filter((link) => link.pathname.includes(`/mangaread/${sourceSlug}/`))
    : [];
  const returnedUrls = new Set(chapters.map((chapter) => chapter.url));
  const notReturned = sameSlugLinks
    .filter((link) => !returnedUrls.has(link.url))
    .slice(0, 10)
    .map(({ text, url }) => ({ text, url }));

  return {
    available: true,
    sourceSlug,
    allMangareadLinkCount: allMangareadLinks.length,
    sameSlugLinkCount: sameSlugLinks.length,
    returnedChapterCount: chapters.length,
    notReturnedSample: notReturned,
  };
}

export function collectLinks($: cheerio.CheerioAPI, sourceUrl: string, selector: string): Array<{ text: string; url: string; pathname: string }> {
  const links: Array<{ text: string; url: string; pathname: string }> = [];
  $(selector).each((_, element) => {
    const href = $(element).attr('href') ?? '';
    if (!href) return;
    try {
      const url = new URL(href, sourceUrl);
      links.push({
        text: $(element).text().replace(/\s+/g, ' ').trim(),
        url: url.href,
        pathname: url.pathname,
      });
    } catch {
      // Ignore malformed hrefs in diagnostics.
    }
  });
  return links;
}

export function extractPathSegment(url: string, prefixes: string[]): string | undefined {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return prefixes.includes(segments[0] ?? '') ? segments[1] : undefined;
  } catch {
    return undefined;
  }
}

export async function detectVerificationRequiredForUrl(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  urlOrHtml: string,
  crawlerMode: AdapterCrawlerMode
): Promise<Record<string, unknown>> {
  const detect = adapter.detectVerificationRequired?.bind(adapter) ?? ((input: string) => looksLikeVerificationRequired(input));
  if (!/^https?:\/\//i.test(urlOrHtml)) {
    return {
      verificationRequired: await detect(urlOrHtml),
      source: 'input',
      domSource: domSourceForCrawlerMode(crawlerMode),
    };
  }

  const maybeFetcher = adapter as unknown as { fetchHtml?: (url: string) => Promise<string> };
  if (!maybeFetcher.fetchHtml) {
    return {
      verificationRequired: await detect(urlOrHtml),
      source: 'url-only',
      warning: 'Adapter does not expose the internal HTML fetcher, so only the URL text was inspected.',
      domSource: domSourceForCrawlerMode(crawlerMode),
    };
  }

  try {
    const html = await maybeFetcher.fetchHtml(urlOrHtml);
    return {
      verificationRequired: looksLikeAntiBotChallenge(html),
      source: 'fetched-html',
      htmlLength: html.length,
      domSource: domSourceForCrawlerMode(crawlerMode),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      verificationRequired: looksLikeVerificationRequired(message),
      source: 'fetch-error',
      error: message,
      domSource: domSourceForCrawlerMode(crawlerMode),
    };
  }
}

export function domSourceForCrawlerMode(crawlerMode: AdapterCrawlerMode): AdapterDomSource {
  return crawlerMode === 'playwright' ? 'rendered' : 'static';
}

export function readinessTargetForFunction(functionId: AdapterFunctionId): DomReadinessTarget {
  if (isMetadataFunction(functionId)) return 'metadata';
  if (functionId === 'extractChapterImageUrls') return 'chapterImages';
  if (functionId === 'detectVerificationRequired' || functionId === 'describeVerificationHandoff') return 'verification';
  return 'common';
}

export function readinessForResult(input: {
  target: DomReadinessTarget;
  functionId: AdapterFunctionId;
  resultSummary: Record<string, unknown>;
}): DomReadinessReport {
  if (input.target === 'common' || input.target === 'verification') {
    return {
      status: 'ready',
      target: input.target,
      confidence: 0.9,
      reasons: ['Function does not require DOM extraction readiness.'],
      recommendedAction: 'continue',
    };
  }
  const empty = isEmptyResultForFunction(input.functionId, input.resultSummary);
  return {
    status: empty ? 'needs_fixture_or_manual_review' : 'ready',
    target: input.target,
    confidence: empty ? 0.35 : 0.8,
    reasons: empty
      ? ['Extraction returned an empty or low-signal result.']
      : ['Extraction returned a non-empty result.'],
    recommendedAction: empty ? 'capture_verified_fixture' : 'continue',
  };
}

export function combineReadiness(
  domReadiness: DomReadinessReport | undefined,
  resultReadiness: DomReadinessReport
): DomReadinessReport {
  if (!domReadiness) return resultReadiness;
  if (domReadiness.status === 'ready' && resultReadiness.status === 'ready') {
    return {
      ...domReadiness,
      confidence: Math.min(domReadiness.confidence, resultReadiness.confidence),
      reasons: [...domReadiness.reasons, ...resultReadiness.reasons],
    };
  }
  if (domReadiness.status !== 'ready') return domReadiness;
  return {
    ...resultReadiness,
    reasons: [...domReadiness.reasons, ...resultReadiness.reasons],
  };
}

export function failureReadiness(target: DomReadinessTarget, message: string): DomReadinessReport {
  return {
    status: looksLikeVerificationRequired(message) ? 'human_verification_required' : 'failed',
    target,
    confidence: 0,
    reasons: [message],
    recommendedAction: looksLikeVerificationRequired(message) ? 'human_verification_handoff' : 'manual_review',
  };
}

export function isEmptyResultForFunction(functionId: AdapterFunctionId, result: Record<string, unknown>): boolean {
  const keyByFunction: Partial<Record<AdapterFunctionId, string>> = {
    extractTitle: 'title',
    extractAuthor: 'author',
    extractDescription: 'description',
    extractCoverUrl: 'coverUrl',
    extractTags: 'tags',
    extractStatus: 'status',
    extractChapterList: 'chapterCount',
    extractChapterImageUrls: 'imageUrlCount',
  };
  const key = keyByFunction[functionId];
  if (!key) return false;
  const value = result[key];
  if (typeof value === 'number') return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return value === undefined || value === null;
}
