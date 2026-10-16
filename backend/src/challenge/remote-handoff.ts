import {
  connectRemoteBrowser,
  requireRemoteBrowserEndpoint,
  type RemoteBrowserConnectionOptions,
} from '../browser/remote-browser-provider';
import type { BrowserContext } from 'playwright';

export interface RemotePageSummary {
  url: string;
  title: string;
}

export interface RemoteConnectionSummary {
  ok: boolean;
  wsEndpoint: string;
  pageCount: number;
  pages: RemotePageSummary[];
}

export async function inspectRemoteBrowser(input: string | RemoteBrowserConnectionOptions): Promise<RemoteConnectionSummary> {
  const options = typeof input === 'string' ? { wsEndpoint: input } : input;
  const endpoint = requireRemoteBrowserEndpoint(options);
  const browser = await connectRemoteBrowser({ ...options, wsEndpoint: endpoint });
  try {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const summaries = await Promise.all(pages.map(async (page) => ({
      url: page.url(),
      title: await page.title().catch(() => ''),
    })));
    return {
      ok: true,
      wsEndpoint: endpoint.replace(/\/$/, ''),
      pageCount: summaries.length,
      pages: summaries,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function findPageHtmlInContexts(
  contexts: BrowserContext[],
  input: { targetUrl: string; settle?: boolean; allowNavigate?: boolean }
): Promise<{ url: string; title: string; html: string }> {
  const target = new URL(input.targetUrl);
  const allowNavigate = input.allowNavigate ?? true;
  const pages = contexts.flatMap((context) => context.pages());
  const page = pages.find((candidate) => samePage(candidate.url(), target.href))
    ?? (allowNavigate ? pages.find((candidate) => sameHostname(candidate.url(), target.hostname)) : undefined);
  if (!page) {
    throw new Error(`No remote browser page matched ${target.href}. Open the target page through ComicCrawler first.`);
  }
  if (!samePage(page.url(), target.href)) {
    if (!allowNavigate) {
      throw new Error(`No remote browser page matched ${target.href}. Current page is ${page.url()}.`);
    }
    await page.goto(target.href, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  }
  if (input.settle ?? true) {
    await settleLazyLoadedImages(page);
  }
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    html: await page.content(),
  };
}

export async function settleLazyLoadedImages(
  page: import('playwright').Page,
  options: { onlyDetectedTargets?: boolean } = {}
): Promise<void> {
  await page.evaluate(async ({ onlyDetectedTargets }) => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const lazyTargets = Array.from(document.querySelectorAll<HTMLElement>([
      '.rpage-page[data-page]',
      'img[loading="lazy"]',
      'img[data-src]',
      'img[data-lazy-src]',
    ].join(', ')));
    const uniqueTargets = lazyTargets.filter((target, index) => lazyTargets.indexOf(target) === index);
    const originalX = window.scrollX;
    const originalY = window.scrollY;

    if (uniqueTargets.length > 0) {
      for (const target of uniqueTargets.slice(0, 500)) {
        target.scrollIntoView({ block: 'center' });
        await sleep(100);
      }
      window.scrollTo(originalX, originalY);
      return;
    }

    if (onlyDetectedTargets) return;

    const maxScrollTop = () => Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0
    );
    const viewportHeight = window.innerHeight || 800;
    const step = Math.max(300, Math.floor(viewportHeight * 0.8));
    let lastHeight = maxScrollTop();

    for (let y = 0, iteration = 0; y <= lastHeight + step && iteration < 30; y += step, iteration++) {
      window.scrollTo(0, y);
      await sleep(150);
      lastHeight = maxScrollTop();
    }
    window.scrollTo(originalX, originalY);
  }, { onlyDetectedTargets: options.onlyDetectedTargets ?? false }).catch(() => undefined);

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(500).catch(() => undefined);
}

function samePage(candidate: string, target: string): boolean {
  try {
    const left = new URL(candidate);
    const right = new URL(target);
    left.hash = '';
    right.hash = '';
    return left.href === right.href;
  } catch {
    return false;
  }
}

function sameHostname(candidate: string, targetHostname: string): boolean {
  try {
    return new URL(candidate).hostname === targetHostname;
  } catch {
    return false;
  }
}
