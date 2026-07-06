import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fetch } from 'undici';
import { chromium } from 'playwright';
import type { BrowserConfig, NetworkConfig } from '@comiccrawler/shared';
import { assertNotAntiBotChallenge, looksLikeAntiBotChallenge } from '../crawler/anti-bot';
import { BrowserChallengeHandler } from '../challenge/browser-challenge-handler';
import { getGlobalVerifiedBrowserSessionRegistry } from '../challenge/verified-browser-sessions';

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
}

export async function fetchSafeHtml(
  url: string,
  optionsOrTimeout: SafeHtmlFetchOptions | number = {}
): Promise<SafeHtmlFetchResult> {
  const options = typeof optionsOrTimeout === 'number' ? { timeoutMs: optionsOrTimeout } : optionsOrTimeout;
  const timeoutMs = options.timeoutMs ?? options.browser?.timeout ?? options.network?.timeout ?? 30000;
  let currentUrl = normalizeAndValidateUrl(url);
  const redirectChain: string[] = [];

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    await validateResolvedAddresses(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'ComicCrawler/1.0.0 selector-discovery',
          Accept: 'text/html,application/xhtml+xml',
          ...(options.network?.userAgent ? { 'User-Agent': options.network.userAgent } : {}),
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect response from ${currentUrl} did not include a Location header.`);
        }
        redirectChain.push(currentUrl);
        currentUrl = normalizeAndValidateUrl(new URL(location, currentUrl).href);
        continue;
      }

      if (!response.ok && shouldFallbackToHeadless(response.status)) {
        const html = await fetchHeadlessHtml(currentUrl, { ...options, timeoutMs });
        assertNotAntiBotChallenge(html, currentUrl);
        return { url, finalUrl: currentUrl, redirectChain, html, contentType: 'text/html; rendered=playwright' };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while fetching ${currentUrl}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error(`Expected HTML content but received "${contentType}".`);
      }

      const html = await readLimitedText(response as any, MAX_HTML_BYTES);
      if (looksLikeAntiBotChallenge(html) && options.browser?.mode !== 'static') {
        const renderedHtml = await fetchHeadlessHtml(currentUrl, { ...options, timeoutMs });
        assertNotAntiBotChallenge(renderedHtml, currentUrl);
        return { url, finalUrl: currentUrl, redirectChain, html: renderedHtml, contentType: 'text/html; rendered=playwright' };
      }
      assertNotAntiBotChallenge(html, currentUrl);
      return { url, finalUrl: currentUrl, redirectChain, html, contentType };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Too many redirects while fetching ${url}.`);
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

  const [a = 0, b = 0] = normalized.split('.').map(Number);
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

async function fetchHeadlessHtml(url: string, options: SafeHtmlFetchOptions & { timeoutMs: number }): Promise<string> {
  const verifiedSession = getGlobalVerifiedBrowserSessionRegistry().getByUrl(url);
  const browserOptions = {
    ...(options.browser ?? {}),
    ...(verifiedSession ? { userDataDir: verifiedSession.userDataDir } : {}),
  };
  const launchOptions = {
    headless: verifiedSession?.userDataDir ? false : browserOptions.headless ?? true,
    channel: browserOptions.channel,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      ...(verifiedSession?.chromiumProfileDirectory ? [`--profile-directory=${verifiedSession.chromiumProfileDirectory}`] : []),
    ],
  };
  const contextOptions = {
    userAgent: options.network?.userAgent,
    proxy: options.network?.proxy ? { server: options.network.proxy } : undefined,
    storageState: browserOptions.storageStatePath,
    viewport: { width: 1920, height: 1080 },
  };
  const browser = browserOptions.userDataDir ? undefined : await chromium.launch(launchOptions);
  const context = browserOptions.userDataDir
    ? await chromium.launchPersistentContext(browserOptions.userDataDir, {
        ...launchOptions,
        ...contextOptions,
      })
    : await browser!.newContext(contextOptions);
  try {
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: browserOptions.waitUntil ?? 'domcontentloaded',
      timeout: options.timeoutMs,
    });
    if (browserOptions.waitForSelector?.trim()) {
      await page.waitForSelector(browserOptions.waitForSelector.trim(), {
        state: 'attached',
        timeout: options.timeoutMs,
      });
    }
    if (browserOptions.postLoadDelayMs && browserOptions.postLoadDelayMs > 0) {
      await page.waitForTimeout(browserOptions.postLoadDelayMs);
    }
    return (await new BrowserChallengeHandler().ensureReady(page, url, {
      challengeAutoAttempt: browserOptions.challengeAutoAttempt,
      challengeWaitMs: browserOptions.challengeWaitMs,
    })).html;
  } finally {
    await context.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
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
    if (total > maxBytes) {
      throw new Error(`HTML response exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
