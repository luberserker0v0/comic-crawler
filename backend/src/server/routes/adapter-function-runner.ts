import * as cheerio from 'cheerio';
import type {
  AdapterDomSource,
  AdapterFunctionTestResponse,
  DomReadinessReport,
  DomReadinessTarget,
  EffectiveRenderContext,
  NetworkConfig,
  BrowserTarget,
} from '@comiccrawler/shared';
import type { AdapterRegistry } from '../../adapter/registry';
import { createChapterImageIdentities } from '../../adapter/chapter-image-identity';
import { looksLikeAntiBotChallenge } from '../../crawler/anti-bot';
import type { HtmlRenderer } from '../../crawler/html-renderer';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { ChallengeDiscoveryJob } from '../../challenge/discovery-types';
import type {
  AdapterCrawlerMode,
  AdapterFunctionId,
  AdapterFunctionTiming,
  VerifiedChallengeDocument,
} from './adapter-function-types';

const PLAYWRIGHT_ADAPTER_FUNCTION_TIMEOUT_MS = 15 * 60 * 1000;
const adapterFunctionLocks = new WeakMap<object, Promise<void>>();
type RegisteredAdapter = NonNullable<ReturnType<AdapterRegistry['get']>>;

export interface AdapterFunctionTestOptions {
  challengeDiscoveryId?: string;
  challengeDiscoveryService?: ChallengeDiscoveryService;
  network?: NetworkConfig;
  renderContext?: EffectiveRenderContext;
  signal?: AbortSignal;
  htmlRenderer?: HtmlRenderer;
  verificationHandoff?: {
    ownerUserId: string;
    browserTarget?: BrowserTarget;
    claimBrowserLease?: BrowserLeaseClaim;
  };
}

export interface TransferableBrowserLease {
  sessionId: string;
  release(): Promise<void>;
}

export type BrowserLeaseClaim = () => TransferableBrowserLease;

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
  options: AdapterFunctionTestOptions = {}
): Promise<AdapterFunctionTestResponse> {
  return runWithAdapterFunctionLock(adapter,
    () => runAdapterFunctionTest(adapter, functionId, url, options), options.signal);
}

async function runAdapterFunctionTest(
  adapter: RegisteredAdapter,
  functionId: AdapterFunctionId,
  url: string,
  options: AdapterFunctionTestOptions
): Promise<AdapterFunctionTestResponse> {
  const context = createRunContext(adapter, functionId, url, options);
  let verified: VerifiedChallengeDocument | undefined;
  try {
    attachAdapterRenderer(context);
    verified = await loadRunVerifiedDocument(context);
    const result = await executeAdapterFunction(context, verified);
    return createRunResultResponse(context, result, verified);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    return createRunErrorResponse(context, error);
  } finally {
    await cleanupRunContext(context, Boolean(verified));
  }
}

async function cleanupRunContext(context: RunContext, consumedChallenge: boolean): Promise<void> {
  detachAdapterRenderer(context.adapter);
  await context.renderer.dispose().catch(() => undefined);
  if (!consumedChallenge || !context.options.challengeDiscoveryId) return;
  const service = context.options.challengeDiscoveryService;
  if (!service?.releaseBrowserLease) return;
  await service.releaseBrowserLease(context.options.challengeDiscoveryId).catch(() => undefined);
}

interface RunContext {
  adapter: RegisteredAdapter; functionId: AdapterFunctionId; url: string;
  options: AdapterFunctionTestOptions; startedAt: number; timings: TimingCollector;
  crawlerMode: AdapterCrawlerMode; target: DomReadinessTarget; domSource: AdapterDomSource;
  renderer: HtmlRenderer;
}

function createRunContext(
  adapter: RegisteredAdapter, functionId: AdapterFunctionId, url: string,
  options: AdapterFunctionTestOptions
): RunContext {
  const crawlerMode = defaultCrawlerModeForAdapter(adapter);
  return { adapter, functionId, url, options, startedAt: Date.now(), timings: new TimingCollector(),
    crawlerMode, target: readinessTargetForFunction(functionId), domSource: domSourceForCrawlerMode(crawlerMode),
    renderer: options.htmlRenderer ?? missingBrowserWorkerRenderer() };
}

function attachAdapterRenderer(context: RunContext): void {
  const attachable = context.adapter as unknown as { setHtmlRenderer?: (renderer: unknown) => void };
  if (!attachable.setHtmlRenderer) return;
  attachable.setHtmlRenderer({
    render: (url: string, renderOptions: Parameters<HtmlRenderer['render']>[1]) =>
      renderVerifiedAdapterPage(context, url, renderOptions),
    dispose: async () => undefined,
  });
}

async function renderVerifiedAdapterPage(
  context: RunContext, url: string, options?: Parameters<HtmlRenderer['render']>[1]
): Promise<string> {
  const html = await context.renderer.render(url, options);
  if (context.adapter.verification && await context.adapter.verification.detectVerificationRequired(html))
    throw new Error(`Adapter "${context.adapter.id}" detected that human verification is required for ${url}.`);
  return html;
}

function detachAdapterRenderer(adapter: RegisteredAdapter): void {
  const attachable = adapter as unknown as { setHtmlRenderer?: (renderer: undefined) => void };
  attachable.setHtmlRenderer?.(undefined);
}

async function loadRunVerifiedDocument(context: RunContext): Promise<VerifiedChallengeDocument | undefined> {
  const id = context.options.challengeDiscoveryId;
  if (!id) return undefined;
  return context.timings.measure('dom_acquisition', () => loadVerifiedChallengeDocument(
    context.options.challengeDiscoveryService, id, context.url,
    { settle: context.functionId === 'extractChapterImageUrls', allowNavigate: false }));
}

async function executeAdapterFunction(
  context: RunContext, verified?: VerifiedChallengeDocument
): Promise<Record<string, unknown>> {
  const operation = () => runWithCrawlerMode(context.adapter, context.crawlerMode,
    () => extractAdapterFunctionResult(context, verified));
  return withTimeout(operation, adapterFunctionTimeoutMs(context.crawlerMode), context.options.signal);
}

async function extractAdapterFunctionResult(
  context: RunContext, verified?: VerifiedChallengeDocument
): Promise<Record<string, unknown>> {
  if (context.functionId === 'matchUrl') return measureMatchUrl(context);
  if (context.functionId === 'detectVerificationRequired') return measureVerification(context, verified);
  if (isReaderPreparationFunction(context.functionId)) return measureReaderSelector(context);
  const document = verified?.document ?? await context.timings.measure('dom_acquisition',
    () => loadAdapterDocument(context.adapter, context.url));
  if (isMetadataFunction(context.functionId)) return measureMetadata(context, document, verified);
  return measureChapterImages(context, document, verified);
}

function measureMatchUrl(context: RunContext): Promise<Record<string, unknown>> {
  return context.timings.measure('extraction', async () => ({
    matched: context.adapter.matchUrl(context.url), domSource: context.domSource,
  }));
}

function measureVerification(context: RunContext, verified?: VerifiedChallengeDocument): Promise<Record<string, unknown>> {
  if (!verified) return context.timings.measure('extraction', () => detectVerificationRequiredForUrl(
    context.adapter, context.url, context.crawlerMode));
  const html = verified.page.html;
  return context.timings.measure('extraction', async () => ({
    verificationRequired: looksLikeAntiBotChallenge(html), source: 'verified-browser-html',
    htmlLength: html.length, domSource: 'verified-fixture', ...verifiedDocumentSourceSummary(verified),
  }));
}

function measureReaderSelector(context: RunContext): Promise<Record<string, unknown>> {
  return context.timings.measure('extraction', async () => {
    const capability = context.adapter.readerPreparation;
    if (context.functionId === 'getReaderContainerSelector')
      return { selector: capability?.getReaderContainerSelector(context.url) };
    if (context.functionId === 'getReaderPageSelector')
      return { selector: capability?.getReaderPageSelector(context.url) };
    return { selector: capability?.getReaderEndSelector?.(context.url) };
  });
}

function isReaderPreparationFunction(functionId: AdapterFunctionId): boolean {
  return functionId.startsWith('getReader');
}

function measureMetadata(
  context: RunContext, document: unknown, verified?: VerifiedChallengeDocument
): Promise<Record<string, unknown>> {
  return context.timings.measure('extraction', async () => ({
    ...await extractMetadataValue(context, document),
    ...(verified ? verifiedDocumentSourceSummary(verified) : {}),
  }));
}

async function extractMetadataValue(context: RunContext, document: unknown): Promise<Record<string, unknown>> {
  const { adapter, functionId, url } = context;
  if (functionId === 'extractTitle') return { title: await adapter.extractTitle?.(document, url) };
  if (functionId === 'extractAuthor') return { author: await adapter.extractAuthor?.(document, url) };
  if (functionId === 'extractDescription') return { description: await adapter.extractDescription?.(document, url) };
  if (functionId === 'extractCoverUrl') return { coverUrl: await adapter.extractCoverUrl?.(document, url) };
  if (functionId === 'extractTags') return { tags: await adapter.extractTags?.(document, url) };
  if (functionId === 'extractStatus') return { status: await adapter.extractStatus?.(document, url) };
  const chapters = await adapter.extractChapterList?.(document, url) ?? [];
  return { chapterCount: chapters.length, chapters,
    chapterDiagnostics: analyzeChapterExtractionInput(adapter, document, url, chapters) };
}

function measureChapterImages(
  context: RunContext, document: unknown, verified?: VerifiedChallengeDocument
): Promise<Record<string, unknown>> {
  return context.timings.measure('extraction', async () => {
    const urls = await context.adapter.extractChapterImageUrls?.(document, context.url) ?? [];
    const identities = createChapterImageIdentities({
      adapter: context.adapter, chapterUrl: context.url, imageUrls: urls, document,
    });
    return { imageUrlCount: urls.length, imageUrls: urls, chapter: identities.chapter,
      images: identities.images, ...(verified ? verifiedDocumentSourceSummary(verified) : {}) };
  });
}

async function createRunResultResponse(
  context: RunContext, resultSummary: Record<string, unknown>, verified?: VerifiedChallengeDocument
): Promise<AdapterFunctionTestResponse> {
  if (context.functionId === 'detectVerificationRequired' && resultSummary.verificationRequired === true)
    return createVerificationResponseFromContext(context, resultSummary.error);
  const readiness = combineReadiness(undefined, await context.timings.measure('readiness', async () =>
    readinessForResult({ target: context.target, functionId: context.functionId, resultSummary })));
  const base = createResponseBase(context, verified ? 'verified-fixture' : context.domSource);
  if (readiness.status === 'ready') return { ...base, ok: true, status: 'passed', readiness,
    recommendedAction: readiness.recommendedAction, resultSummary, requiresVerification: false };
  return { ...base, ok: false, status: 'failed', readiness, recommendedAction: readiness.recommendedAction,
    resultSummary, error: `DOM readiness is not trusted enough for this function: ${readiness.reasons.join(' ')}`,
    requiresVerification: false };
}

async function createRunErrorResponse(context: RunContext, error: unknown): Promise<AdapterFunctionTestResponse> {
  const message = error instanceof Error ? error.message : String(error);
  if (shouldOfferHandoffForPlaywrightTest(message)) return createVerificationResponseFromContext(context, message);
  const readiness = failureReadiness(context.target, message);
  return { ...createResponseBase(context, context.domSource), ok: false, status: 'failed', readiness,
    recommendedAction: readiness.recommendedAction, error: message, requiresVerification: false };
}

function createResponseBase(context: RunContext, domSource: AdapterDomSource) {
  return { adapterId: context.adapter.id, functionId: context.functionId,
    durationMs: Date.now() - context.startedAt, timings: context.timings.list(), domSource };
}

function createVerificationResponseFromContext(context: RunContext, error: unknown) {
  return createVerificationRequiredResponse({ ...createResponseBase(context, 'handoff-required'), url: context.url,
    error: typeof error === 'string' ? error : 'The page requires human verification.',
    challengeDiscoveryService: context.options.challengeDiscoveryService,
    existingChallengeDiscoveryId: context.options.challengeDiscoveryId,
    verificationHandoff: context.options.verificationHandoff });
}

function missingBrowserWorkerRenderer(): HtmlRenderer {
  return {
    render: async () => {
      throw new Error('Browser Worker renderer is required for Playwright adapter functions.');
    },
    dispose: async () => undefined,
  };
}

async function runWithAdapterFunctionLock<T>(
  adapter: object, action: () => Promise<T>, signal?: AbortSignal
): Promise<T> {
  const previous = adapterFunctionLocks.get(adapter) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  adapterFunctionLocks.set(adapter, tail);
  try {
    await waitForPreviousAdapterRun(previous, signal);
    return await action();
  } finally {
    release();
    if (adapterFunctionLocks.get(adapter) === tail) adapterFunctionLocks.delete(adapter);
  }
}

async function waitForPreviousAdapterRun(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return previous.catch(() => undefined);
  signal.throwIfAborted();
  await Promise.race([previous.catch(() => undefined), abortedPromise(signal)]);
}

interface VerificationResponseInput {
  adapterId: string;
  functionId: AdapterFunctionId;
  durationMs: number;
  timings?: AdapterFunctionTiming[];
  url: string;
  error: string;
  challengeDiscoveryService?: ChallengeDiscoveryService;
  existingChallengeDiscoveryId?: string;
  verificationHandoff?: {
    ownerUserId: string;
    browserTarget?: BrowserTarget;
    claimBrowserLease?: BrowserLeaseClaim;
  };
}

export async function createVerificationRequiredResponse(
  input: VerificationResponseInput
): Promise<AdapterFunctionTestResponse> {
  const job = await getVerificationJob(input);
  const errorCode = input.functionId === 'extractChapterImageUrls'
    ? 'CHAPTER_IMAGES_VERIFICATION_REQUIRED' as const
    : 'ADAPTER_FUNCTION_VERIFICATION_REQUIRED' as const;
  const retryableAfterVerification = Boolean(job && job.status !== 'failed' && job.status !== 'cancelled');
  return {
    ...createVerificationResponseBase(input), errorCode, retryableAfterVerification,
    challengeDiscoveryId: job?.id, challengeStatus: job?.status,
    challenge: job ? createChallengeSummary(job, retryableAfterVerification) : undefined,
    verificationMessage: verificationMessage(Boolean(job)),
  };
}

async function getVerificationJob(input: VerificationResponseInput) {
  if (input.existingChallengeDiscoveryId)
    return input.challengeDiscoveryService?.get(input.existingChallengeDiscoveryId);
  const service = input.challengeDiscoveryService;
  if (!service) return undefined;
  const browserLease = input.verificationHandoff?.claimBrowserLease?.();
  try {
    return await service.createDeferred({ url: input.url, browserLease,
      ownerUserId: input.verificationHandoff?.ownerUserId,
      browserTarget: input.verificationHandoff?.browserTarget });
  } catch (error) {
    await browserLease?.release().catch(() => undefined);
    throw error;
  }
}

function createVerificationResponseBase(input: VerificationResponseInput) {
  return { ok: false as const, status: 'verification_required' as const, adapterId: input.adapterId,
    functionId: input.functionId, durationMs: input.durationMs, timings: input.timings,
    domSource: 'handoff-required' as const, readiness: { status: 'human_verification_required' as const,
      target: readinessTargetForFunction(input.functionId), confidence: 0, reasons: [input.error],
      recommendedAction: 'human_verification_handoff' as const },
    recommendedAction: 'human_verification_handoff' as const, error: input.error,
    requiresVerification: true as const };
}

function createChallengeSummary(job: ChallengeDiscoveryJob, retryableAfterVerification: boolean) {
  return { id: job.id, status: job.status, normalizedUrl: job.normalizedUrl,
    retryableAfterVerification, ownerUserId: job.ownerUserId, browserTarget: job.browserTarget };
}

function verificationMessage(hasJob: boolean): string {
  return hasJob
    ? 'Human verification is required. Open the verification browser, complete the check, then continue this adapter function test.'
    : 'Human verification is required, but the handoff service is not available in this backend instance.';
}

export async function withTimeout<T>(
  operation: () => Promise<T>, timeoutMs: number, signal?: AbortSignal
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Adapter function test timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
      ...(signal ? [abortedPromise(signal)] : []),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function abortedPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
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

export function defaultCrawlerModeForAdapter(_adapter: NonNullable<ReturnType<AdapterRegistry['get']>>): AdapterCrawlerMode {
  return 'playwright';
}

export function adapterFunctionTimeoutMs(_crawlerMode: AdapterCrawlerMode): number {
  return PLAYWRIGHT_ADAPTER_FUNCTION_TIMEOUT_MS;
}

export async function runWithCrawlerMode<T>(
  _adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  _crawlerMode: AdapterCrawlerMode,
  operation: () => Promise<T>
): Promise<T> {
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
  const service = requireChallengeService(challengeDiscoveryService);
  await requireReadyChallengeJob(service, challengeDiscoveryId);
  const snapshot = await service.readRemotePageSnapshot(challengeDiscoveryId, {
    settle: options.settle,
    allowNavigate: options.allowNavigate,
  });
  if (!sameDocumentPath(snapshot.page.url, url))
    throw new Error(`Verified browser page does not match the test URL. Browser page: ${snapshot.page.url}`);
  return { document: cheerio.load(snapshot.page.html), page: snapshot.page };
}

function requireChallengeService(service?: ChallengeDiscoveryService): ChallengeDiscoveryService {
  if (!service) throw new Error('Human verification is required, but the handoff service is not available.');
  return service;
}

async function requireReadyChallengeJob(service: ChallengeDiscoveryService, id: string): Promise<ChallengeDiscoveryJob> {
  const job = await service.get(id);
  if (!job) throw new Error(`Challenge discovery job "${id}" was not found.`);
  if (job.status !== 'ready') throw new Error(createChallengeNotReadyMessage(job));
  return job;
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
  if (!maybeCheerioAdapter.asCheerio)
    return { available: false, reason: 'Adapter does not expose a Cheerio document helper.' };
  const $ = maybeCheerioAdapter.asCheerio(document);
  const sourceSlug = extractPathSegment(sourceUrl, ['manga', 'mangaread']);
  const allMangareadLinks = collectLinks($, sourceUrl, 'a[href*="/mangaread/"]');
  const sameSlugLinks = filterChapterLinks(allMangareadLinks, sourceSlug);
  const notReturnedSample = findMissingChapterLinks(sameSlugLinks, chapters);
  return { available: true, sourceSlug, allMangareadLinkCount: allMangareadLinks.length,
    sameSlugLinkCount: sameSlugLinks.length, returnedChapterCount: chapters.length, notReturnedSample };
}

function filterChapterLinks(links: ReturnType<typeof collectLinks>, slug?: string) {
  return slug ? links.filter((link) => link.pathname.includes(`/mangaread/${slug}/`)) : [];
}

function findMissingChapterLinks(links: ReturnType<typeof collectLinks>, chapters: Array<{ url: string }>) {
  const returnedUrls = new Set(chapters.map((chapter) => chapter.url));
  return links.filter((link) => !returnedUrls.has(link.url)).slice(0, 10)
    .map(({ text, url }) => ({ text, url }));
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
  if (!/^https?:\/\//i.test(urlOrHtml)) return createDetectionResult(
    await detect(urlOrHtml), 'input', crawlerMode);
  const maybeFetcher = adapter as unknown as { fetchHtml?: (url: string) => Promise<string> };
  if (!maybeFetcher.fetchHtml) return { ...createDetectionResult(
    await detect(urlOrHtml), 'url-only', crawlerMode),
    warning: 'Adapter does not expose the internal HTML fetcher, so only the URL text was inspected.' };
  return detectFromFetchedHtml(maybeFetcher.fetchHtml.bind(adapter), urlOrHtml, crawlerMode);
}

async function detectFromFetchedHtml(
  fetchHtml: (url: string) => Promise<string>, url: string, crawlerMode: AdapterCrawlerMode
): Promise<Record<string, unknown>> {
  try {
    const html = await fetchHtml(url);
    return { ...createDetectionResult(looksLikeAntiBotChallenge(html), 'fetched-html', crawlerMode),
      htmlLength: html.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...createDetectionResult(looksLikeVerificationRequired(message), 'fetch-error', crawlerMode),
      error: message };
  }
}

function createDetectionResult(required: boolean, source: string, crawlerMode: AdapterCrawlerMode) {
  return { verificationRequired: required, source, domSource: domSourceForCrawlerMode(crawlerMode) };
}

export function domSourceForCrawlerMode(_crawlerMode: AdapterCrawlerMode): AdapterDomSource {
  return 'rendered';
}

export function readinessTargetForFunction(functionId: AdapterFunctionId): DomReadinessTarget {
  if (isMetadataFunction(functionId)) return 'metadata';
  if (functionId === 'extractChapterImageUrls') return 'chapterImages';
  if (functionId === 'detectVerificationRequired') return 'verification';
  return 'common';
}

export function readinessForResult(input: {
  target: DomReadinessTarget;
  functionId: AdapterFunctionId;
  resultSummary: Record<string, unknown>;
}): DomReadinessReport {
  if (input.target === 'common' || input.target === 'verification') return nonExtractionReadiness(input.target);
  const empty = isEmptyResultForFunction(input.functionId, input.resultSummary);
  return {
    status: empty ? 'needs_fixture_or_manual_review' : 'ready', target: input.target,
    confidence: empty ? 0.35 : 0.8, reasons: [empty
      ? 'Extraction returned an empty or low-signal result.' : 'Extraction returned a non-empty result.'],
    recommendedAction: empty ? 'capture_verified_fixture' : 'continue',
  };
}

function nonExtractionReadiness(target: DomReadinessTarget): DomReadinessReport {
  return { status: 'ready', target, confidence: 0.9,
    reasons: ['Function does not require DOM extraction readiness.'], recommendedAction: 'continue' };
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

const RESULT_KEY_BY_FUNCTION: Partial<Record<AdapterFunctionId, string>> = {
  extractTitle: 'title', extractAuthor: 'author', extractDescription: 'description', extractCoverUrl: 'coverUrl',
  extractTags: 'tags', extractStatus: 'status', extractChapterList: 'chapterCount',
  extractChapterImageUrls: 'imageUrlCount', getReaderContainerSelector: 'selector',
  getReaderPageSelector: 'selector', getReaderEndSelector: 'selector',
};

export function isEmptyResultForFunction(functionId: AdapterFunctionId, result: Record<string, unknown>): boolean {
  const key = RESULT_KEY_BY_FUNCTION[functionId];
  if (!key) return false;
  const value = result[key];
  if (typeof value === 'number') return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return value === undefined || value === null;
}
