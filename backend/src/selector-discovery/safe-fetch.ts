import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fetch } from 'undici';
import type { BrowserConfig, NetworkConfig } from '@comiccrawler/shared';
import { assertNotAntiBotChallenge, looksLikeAntiBotChallenge } from '../crawler/anti-bot';

export interface SafeHtmlFetchResult {
  url: string;
  finalUrl: string;
  redirectChain: string[];
  html: string;
  contentType: string;
}

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2_000_000;

export interface SafeHtmlFetchOptions {
  timeoutMs?: number;
  browser?: Partial<BrowserConfig>;
  network?: NetworkConfig;
  /**
   * Skip the static fetch and go straight to Playwright-rendered DOM.
   * Selector discovery always renders so AO evidence and runtime use the
   * same mechanism; static stays available for other callers.
   */
  renderFirst?: boolean;
  renderPage?: (url: string, options: { timeoutMs: number }) => Promise<{ url: string; html: string }>;
}

export async function fetchSafeHtml(
  url: string,
  optionsOrTimeout: SafeHtmlFetchOptions | number = {}
): Promise<SafeHtmlFetchResult> {
  const options = typeof optionsOrTimeout === 'number' ? { timeoutMs: optionsOrTimeout } : optionsOrTimeout;
  const timeoutMs = options.timeoutMs ?? options.browser?.timeout ?? options.network?.timeout ?? 30000;
  const currentUrl = normalizeAndValidateUrl(url);
  const redirectChain: string[] = [];
  if (options.renderFirst) return renderedResult(url, currentUrl, redirectChain, options, timeoutMs);
  return fetchStaticHtml(url, currentUrl, redirectChain, options, timeoutMs);
}

async function fetchStaticHtml(originalUrl: string, initialUrl: string, redirectChain: string[],
  options: SafeHtmlFetchOptions, timeoutMs: number): Promise<SafeHtmlFetchResult> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    await validateResolvedAddresses(currentUrl);
    const outcome = await fetchStaticAttempt(originalUrl, currentUrl, redirectChain, options, timeoutMs);
    if (typeof outcome !== 'string') return outcome;
    redirectChain.push(currentUrl);
    currentUrl = outcome;
  }
  throw new Error(`Too many redirects while fetching ${originalUrl}.`);
}

async function fetchStaticAttempt(originalUrl: string, currentUrl: string, redirectChain: string[],
  options: SafeHtmlFetchOptions, timeoutMs: number): Promise<SafeHtmlFetchResult | string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(currentUrl, {
      redirect: 'manual', signal: controller.signal,
      headers: { 'User-Agent': options.network?.userAgent ?? 'ComicCrawler/1.0.0 selector-discovery',
        Accept: 'text/html,application/xhtml+xml' },
    });
    return processStaticResponse(originalUrl, currentUrl, redirectChain, response, options, timeoutMs);
  } finally { clearTimeout(timeout); }
}

async function processStaticResponse(originalUrl: string, currentUrl: string, redirectChain: string[],
  response: Awaited<ReturnType<typeof fetch>>, options: SafeHtmlFetchOptions,
  timeoutMs: number): Promise<SafeHtmlFetchResult | string> {
  if ([301, 302, 303, 307, 308].includes(response.status)) return redirectTarget(response, currentUrl);
  if (!response.ok && shouldFallbackToHeadless(response.status)) {
    return renderedResult(originalUrl, currentUrl, redirectChain, options, timeoutMs);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${currentUrl}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`Expected HTML content but received "${contentType}".`);
  }
  const html = await readLimitedText(response as any, MAX_HTML_BYTES);
  if (looksLikeAntiBotChallenge(html)) return renderedResult(originalUrl, currentUrl, redirectChain, options, timeoutMs);
  assertNotAntiBotChallenge(html, currentUrl);
  return { url: originalUrl, finalUrl: currentUrl, redirectChain, html, contentType };
}

function redirectTarget(response: Awaited<ReturnType<typeof fetch>>, currentUrl: string): string {
  const location = response.headers.get('location');
  if (!location) throw new Error(`Redirect response from ${currentUrl} did not include a Location header.`);
  return normalizeAndValidateUrl(new URL(location, currentUrl).href);
}

async function renderedResult(originalUrl: string, currentUrl: string, redirectChain: string[],
  options: SafeHtmlFetchOptions, timeoutMs: number): Promise<SafeHtmlFetchResult> {
  await validateResolvedAddresses(currentUrl);
  const page = await fetchRenderedPage(currentUrl, { ...options, timeoutMs });
  assertNotAntiBotChallenge(page.html, page.url);
  return { url: originalUrl, finalUrl: page.url, redirectChain, html: page.html,
    contentType: 'text/html; rendered=browser-worker' };
}

export function normalizeAndValidateUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with credentials are not allowed.');
  }
  parsed.hash = '';
  return parsed.href;
}

async function validateResolvedAddresses(url: string): Promise<void> {
  const parsed = new URL(url);
  if (isPrivateOrReservedHost(parsed.hostname)) {
    throw new Error(`Host "${parsed.hostname}" is private or reserved.`);
  }

  const records = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new Error(`No DNS records found for "${parsed.hostname}".`);
  }

  for (const record of records) {
    if (isPrivateOrReservedHost(record.address)) {
      throw new Error(`Host "${parsed.hostname}" resolved to private or reserved address "${record.address}".`);
    }
  }
}

function isPrivateOrReservedHost(host: string): boolean {
  if (process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS === 'true') {
    return false;
  }

  const normalized = host.toLowerCase();
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 0) return false;

  if (ipVersion === 6) {
    return normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return isPrivateIpv4(normalized);
}

function isPrivateIpv4(value: string): boolean {
  const [a = 0, b = 0] = value.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function shouldFallbackToHeadless(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status === 503;
}

async function fetchRenderedPage(
  url: string,
  options: SafeHtmlFetchOptions & { timeoutMs: number }
): Promise<{ url: string; html: string }> {
  if (!options.renderPage) {
    throw new Error('Browser Worker renderer is required for rendered HTML.');
  }
  return options.renderPage(url, { timeoutMs: options.timeoutMs });
}

async function readLimitedText(response: { body?: { getReader?: () => any } }, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader?.();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error(`HTML response exceeded ${maxBytes} bytes.`);
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
