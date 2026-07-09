import { promises as fs } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import * as undici from 'undici';
import { chromium } from 'playwright';
import type { ImageInfo } from '@comiccrawler/shared';
import { ComicError, ErrorType, errorToLogObject } from '../error/types';
import { logger } from '../utils/logger';

export interface DownloadOptions {
  outputDir: string;
  concurrency?: number;
  namingTemplate?: string;
  headers?: Record<string, string>;
  verifiedBrowser?: {
    cdpUrl: string;
    pageUrl: string;
  };
  onProgress?: (completed: number, total: number, result: DownloadResult | null, image: ImageInfo) => void;
}

export interface DownloadResult {
  path: string;
  size: number;
  url: string;
  skipped?: boolean;
  resumed?: boolean;
}

export class ImageDownloader {
  private client: undici.Dispatcher;

  constructor() {
    this.client = new undici.Agent({
      connections: 10,
      keepAliveTimeout: 30000,
    });
  }

  async download(image: ImageInfo, options: DownloadOptions): Promise<DownloadResult> {
    const { outputDir, headers = {} } = options;

    const filename = this.generateFilename(image, options);
    const outputPath = join(outputDir, filename);
    const partialPath = `${outputPath}.part`;

    await fs.mkdir(dirname(outputPath), { recursive: true });

    const existingFile = await this.getExistingFile(outputPath);
    if (existingFile) {
      return {
        path: outputPath,
        size: existingFile.size,
        url: image.url,
        skipped: true,
      };
    }

    const partialFile = await this.getExistingFile(partialPath);
    const rangeStart = partialFile?.size ?? 0;

    let response: undici.Dispatcher.ResponseData;
    try {
      response = await this.client.request({
        method: 'GET',
        origin: new URL(image.url).origin,
        path: new URL(image.url).pathname + new URL(image.url).search,
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent': headers['User-Agent'] ?? 'ComicCrawler/1.0.0',
          Referer: headers['Referer'] ?? options.verifiedBrowser?.pageUrl ?? new URL(image.url).origin,
          ...(rangeStart > 0 ? { Range: `bytes=${rangeStart}-` } : {}),
          ...headers,
        },
      });
    } catch (error) {
      if (options.verifiedBrowser) {
        return this.downloadFromVerifiedBrowserImageElement(image, options, outputPath);
      }
      throw error;
    }

    if (response.statusCode >= 400) {
      if (options.verifiedBrowser) {
        return this.downloadFromVerifiedBrowserImageElement(image, options, outputPath);
      }

      throw new ComicError(
        `Failed to download image: HTTP ${response.statusCode}`,
        ErrorType.DOWNLOAD_FAILED,
        true,
        { url: image.url, statusCode: response.statusCode }
      );
    }

    const body = response.body;
    const chunks: Buffer[] = [];

    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    const appendMode = rangeStart > 0 && response.statusCode === 206;
    const targetPath = appendMode ? partialPath : partialPath;
    await fs.writeFile(targetPath, buffer, { flag: appendMode ? 'a' : 'w' });

    const completedFile = await this.getExistingFile(partialPath);
    if (!completedFile) {
      throw new ComicError(
        'Failed to persist partial download',
        ErrorType.STORAGE_ERROR,
        true,
        { path: partialPath, url: image.url }
      );
    }

    await fs.rename(partialPath, outputPath);

    return {
      path: outputPath,
      size: completedFile.size,
      url: image.url,
      resumed: appendMode,
    };
  }

  async downloadBatch(images: ImageInfo[], options: DownloadOptions): Promise<DownloadResult[]> {
    const concurrency = options.verifiedBrowser ? 1 : options.concurrency ?? 5;
    const results: DownloadResult[] = [];
    let completed = 0;

    const downloadWithProgress = async (image: ImageInfo): Promise<DownloadResult | null> => {
      try {
        const result = await this.download(image, options);
        completed++;
        options.onProgress?.(completed, images.length, result, image);
        return result;
      } catch (error) {
        completed++;
        options.onProgress?.(completed, images.length, null, image);
        logger.warn({ url: image.url, error: errorToLogObject(error) }, 'Failed to download image');
        return null;
      }
    };

    for (let i = 0; i < images.length; i += concurrency) {
      const batch = images.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(downloadWithProgress));
      results.push(...batchResults.filter(Boolean) as DownloadResult[]);
    }

    return results;
  }

  private generateFilename(image: ImageInfo, options: DownloadOptions): string {
    const template = options.namingTemplate ?? '{index}';
    const ext = this.extractExtension(image.url);
    const filename = template
      .replace('{index}', String(image.index).padStart(3, '0'))
      .replace('{url_hash}', Buffer.from(image.url).toString('base64').slice(0, 8))
      .replace('{ext}', ext);

    return extname(filename) ? filename : `${filename}${ext}`;
  }

  private extractExtension(url: string): string {
    try {
      const parsed = new URL(url);
      const ext = parsed.pathname.split('.').pop();
      return ext ? `.${ext}` : '.jpg';
    } catch {
      return '.jpg';
    }
  }

  private async getExistingFile(path: string): Promise<{ size: number } | null> {
    try {
      const stats = await fs.stat(path);
      if (!stats.isFile()) {
        return null;
      }

      return { size: stats.size };
    } catch {
      return null;
    }
  }

  private async downloadFromVerifiedBrowserImageElement(
    image: ImageInfo,
    options: DownloadOptions,
    originalOutputPath: string
  ): Promise<DownloadResult> {
    const verifiedBrowser = options.verifiedBrowser;
    if (!verifiedBrowser) {
      throw new ComicError(
        'Verified browser session is required for browser image fallback',
        ErrorType.DOWNLOAD_FAILED,
        true,
        { url: image.url }
      );
    }

    const screenshotPath = this.withExtension(originalOutputPath, '.png');
    await fs.mkdir(dirname(screenshotPath), { recursive: true });

    const existingFile = await this.getExistingFile(screenshotPath);
    if (existingFile) {
      return {
        path: screenshotPath,
        size: existingFile.size,
        url: image.url,
        skipped: true,
      };
    }

    const browser = await chromium.connectOverCDP(verifiedBrowser.cdpUrl);
    try {
      const pages = browser.contexts().flatMap((context) => context.pages());
      const page = pages.find((candidate) => samePageUrl(candidate.url(), verifiedBrowser.pageUrl))
        ?? pages.find((candidate) => candidate.url().startsWith(verifiedBrowser.pageUrl))
        ?? pages.find((candidate) => sameOrigin(candidate.url(), verifiedBrowser.pageUrl));

      if (!page) {
        throw new ComicError(
          'Verified browser page was not found for image fallback',
          ErrorType.DOWNLOAD_FAILED,
          true,
          { imageUrl: image.url, pageUrl: verifiedBrowser.pageUrl }
        );
      }

      if (!samePageUrl(page.url(), verifiedBrowser.pageUrl)) {
        await page.goto(verifiedBrowser.pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
        await settleLazyImages(page);
      }

      const browserRequestResult = await this.downloadFromBrowserRequest(page, image, originalOutputPath, verifiedBrowser.pageUrl);
      if (browserRequestResult) {
        return browserRequestResult;
      }

      const element = await page.evaluateHandle((targetUrl) => {
        const images = Array.from(document.images);
        return images.find((img) => img.currentSrc === targetUrl || img.src === targetUrl) ?? null;
      }, image.url);

      const asElement = element.asElement();
      if (!asElement) {
        await element.dispose();
        throw new ComicError(
          'Image element was not found on the verified browser page',
          ErrorType.DOWNLOAD_FAILED,
          true,
          { imageUrl: image.url, pageUrl: page.url() }
        );
      }

      await withTimeout(async () => {
        await asElement.scrollIntoViewIfNeeded({ timeout: 15000 });
        await page.waitForFunction((targetUrl) => {
          const images = Array.from(document.images);
          const image = images.find((img) => img.currentSrc === targetUrl || img.src === targetUrl);
          return Boolean(image && image.complete && image.naturalWidth > 1 && image.naturalHeight > 1);
        }, image.url, { timeout: 15000 });
        await page.evaluate(async (targetUrl) => {
          const images = Array.from(document.images);
          const image = images.find((img) => img.currentSrc === targetUrl || img.src === targetUrl);
          if (image && typeof image.decode === 'function') {
            await image.decode().catch(() => undefined);
          }
        }, image.url);
        const box = await asElement.boundingBox();
        if (!box || box.width < 2 || box.height < 2) {
          throw new Error('Image element has no visible bounding box.');
        }
        await page.screenshot({
          path: screenshotPath,
          clip: {
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            width: Math.max(1, box.width),
            height: Math.max(1, box.height),
          },
          timeout: 15000,
        });
      }, 25000, `Timed out capturing browser-rendered image ${image.url}`);
      await asElement.dispose();

      const completedFile = await this.getExistingFile(screenshotPath);
      if (!completedFile) {
        throw new ComicError(
          'Failed to persist browser image fallback screenshot',
          ErrorType.STORAGE_ERROR,
          true,
          { path: screenshotPath, url: image.url }
        );
      }

      return {
        path: screenshotPath,
        size: completedFile.size,
        url: image.url,
      };
    } finally {
      await browser.close();
    }
  }

  private async downloadFromBrowserRequest(
    page: import('playwright').Page,
    image: ImageInfo,
    outputPath: string,
    referer: string
  ): Promise<DownloadResult | null> {
    try {
      const response = await page.context().request.get(image.url, {
        headers: {
          Referer: referer,
        },
        timeout: 15000,
      });
      if (!response.ok()) {
        logger.warn(
          { url: image.url, statusCode: response.status(), pageUrl: referer },
          'Verified browser request failed; falling back to rendered image capture'
        );
        return null;
      }

      const buffer = await response.body();
      await fs.writeFile(outputPath, buffer);
      const completedFile = await this.getExistingFile(outputPath);
      if (!completedFile) {
        throw new ComicError(
          'Failed to persist browser-context image download',
          ErrorType.STORAGE_ERROR,
          true,
          { path: outputPath, url: image.url }
        );
      }

      return {
        path: outputPath,
        size: completedFile.size,
        url: image.url,
      };
    } catch (error) {
      logger.warn(
        { url: image.url, pageUrl: referer, error: errorToLogObject(error) },
        'Verified browser request threw; falling back to rendered image capture'
      );
      return null;
    }
  }

  private withExtension(path: string, extension: string): string {
    const current = extname(path);
    return current ? `${path.slice(0, -current.length)}${extension}` : `${path}${extension}`;
  }

  async dispose(): Promise<void> {
    await this.client.close();
  }
}

async function settleLazyImages(page: import('playwright').Page): Promise<void> {
  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
  }).catch(() => undefined);

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(500).catch(() => undefined);
}

function samePageUrl(left: string, right: string): boolean {
  return normalizePageUrl(left) === normalizePageUrl(right);
}

function normalizePageUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return value.replace(/[#?].*$/, '').replace(/\/$/, '');
  }
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
