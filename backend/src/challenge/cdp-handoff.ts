import { chromium } from 'playwright';

export interface CdpPageSummary {
  url: string;
  title: string;
}

export interface CdpConnectionSummary {
  ok: boolean;
  cdpUrl: string;
  pageCount: number;
  pages: CdpPageSummary[];
}

export async function inspectCdpBrowser(cdpUrl: string): Promise<CdpConnectionSummary> {
  const endpoint = validateLocalCdpUrl(cdpUrl);
  const browser = await chromium.connectOverCDP(endpoint.href);
  try {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const summaries = await Promise.all(pages.map(async (page) => ({
      url: page.url(),
      title: await page.title().catch(() => ''),
    })));
    return {
      ok: true,
      cdpUrl: endpoint.href.replace(/\/$/, ''),
      pageCount: summaries.length,
      pages: summaries,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function findCdpPageHtml(input: {
  cdpUrl: string;
  targetUrl: string;
  settle?: boolean;
  allowNavigate?: boolean;
}): Promise<{ url: string; title: string; html: string }> {
  const endpoint = validateLocalCdpUrl(input.cdpUrl);
  const target = new URL(input.targetUrl);
  const allowNavigate = input.allowNavigate ?? true;
  const browser = await chromium.connectOverCDP(endpoint.href);
  try {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((candidate) => samePage(candidate.url(), target.href))
      ?? (allowNavigate ? pages.find((candidate) => sameHostname(candidate.url(), target.hostname)) : undefined);
    if (!page) {
      throw new Error(`No CDP page matched ${target.href}. Open the target page in your browser first.`);
    }
    if (!samePage(page.url(), target.href)) {
      if (!allowNavigate) {
        throw new Error(`No CDP page matched ${target.href}. Current page is ${page.url()}.`);
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
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function settleLazyLoadedImages(page: import('playwright').Page): Promise<void> {
  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const maxScrollTop = () => Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0
    );
    const viewportHeight = window.innerHeight || 800;
    const step = Math.max(300, Math.floor(viewportHeight * 0.8));
    const originalX = window.scrollX;
    const originalY = window.scrollY;
    let lastHeight = maxScrollTop();

    for (let y = 0, iteration = 0; y <= lastHeight + step && iteration < 30; y += step, iteration++) {
      window.scrollTo(0, y);
      await sleep(150);
      lastHeight = maxScrollTop();
    }
    window.scrollTo(originalX, originalY);
  }).catch(() => undefined);

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(500).catch(() => undefined);
}

function validateLocalCdpUrl(value: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'ws:') {
    throw new Error('CDP URL must use http:// or ws://.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1' && hostname !== '[::1]') {
    throw new Error('CDP URL must point to localhost or 127.0.0.1.');
  }
  return parsed;
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
