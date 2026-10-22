import { promises as fs } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import * as undici from 'undici';
import type { ImageInfo } from '@comiccrawler/shared';
import { ComicError, ErrorType, errorToLogObject } from '../error/types';
import { logger } from '../utils/logger';

export interface DownloadOptions {
  outputDir: string;
  concurrency?: number;
  namingTemplate?: string;
  headers?: Record<string, string>;
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
    if (existingFile) return { path: outputPath, size: existingFile.size, url: image.url, skipped: true };
    const partialFile = await this.getExistingFile(partialPath);
    const rangeStart = partialFile?.size ?? 0;
    const response = await this.requestImage(image.url, headers, rangeStart);
    validateDownloadResponse(response, image.url);
    const buffer = await readResponse(response);
    const appendMode = rangeStart > 0 && response.statusCode === 206;
    const completedFile = await persistDownload(partialPath, outputPath, buffer, appendMode, image.url);
    return { path: outputPath, size: completedFile.size, url: image.url, resumed: appendMode };
  }

  private async requestImage(url: string, headers: Record<string, string>, rangeStart: number) {
    return this.client.request({
      method: 'GET',
      origin: new URL(url).origin,
      path: new URL(url).pathname + new URL(url).search,
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': headers['User-Agent'] ?? 'ComicCrawler/1.0.0',
        Referer: headers['Referer'] ?? new URL(url).origin,
        ...(rangeStart > 0 ? { Range: `bytes=${rangeStart}-` } : {}),
        ...headers,
      },
    });
  }

  async downloadBatch(images: ImageInfo[], options: DownloadOptions): Promise<DownloadResult[]> {
    const concurrency = options.concurrency ?? 5;
    const results: DownloadResult[] = [];
    const state = { completed: 0 };
    for (let i = 0; i < images.length; i += concurrency) {
      const batch = images.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map((image) => this.downloadWithProgress(image, images.length, options, state)));
      results.push(...batchResults.filter(Boolean) as DownloadResult[]);
    }
    return results;
  }

  private async downloadWithProgress(image: ImageInfo, total: number, options: DownloadOptions,
    state: { completed: number }): Promise<DownloadResult | null> {
    try {
      const result = await this.download(image, options);
      state.completed += 1;
      options.onProgress?.(state.completed, total, result, image);
      return result;
    } catch (error) {
      state.completed += 1;
      options.onProgress?.(state.completed, total, null, image);
      logger.warn({ url: image.url, error: errorToLogObject(error) }, 'Failed to download image');
      return null;
    }
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

  async dispose(): Promise<void> {
    await this.client.close();
  }
}

function validateDownloadResponse(response: undici.Dispatcher.ResponseData, url: string): void {
  if (response.statusCode < 400) return;
  throw new ComicError(`Failed to download image: HTTP ${response.statusCode}`,
    ErrorType.DOWNLOAD_FAILED, true, { url, statusCode: response.statusCode });
}

async function readResponse(response: undici.Dispatcher.ResponseData): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function persistDownload(partialPath: string, outputPath: string, buffer: Buffer,
  appendMode: boolean, url: string): Promise<{ size: number }> {
  await fs.writeFile(partialPath, buffer, { flag: appendMode ? 'a' : 'w' });
  const stats = await fs.stat(partialPath).catch(() => undefined);
  if (!stats?.isFile()) throw new ComicError(
    'Failed to persist partial download', ErrorType.STORAGE_ERROR, true, { path: partialPath, url }
  );
  await fs.rename(partialPath, outputPath);
  return { size: stats.size };
}
