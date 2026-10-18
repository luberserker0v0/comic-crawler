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

    const response: undici.Dispatcher.ResponseData = await this.client.request({
      method: 'GET',
      origin: new URL(image.url).origin,
      path: new URL(image.url).pathname + new URL(image.url).search,
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': headers['User-Agent'] ?? 'ComicCrawler/1.0.0',
        Referer: headers['Referer'] ?? new URL(image.url).origin,
        ...(rangeStart > 0 ? { Range: `bytes=${rangeStart}-` } : {}),
        ...headers,
      },
    });

    if (response.statusCode >= 400) {
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
    await fs.writeFile(partialPath, buffer, { flag: appendMode ? 'a' : 'w' });

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
    const concurrency = options.concurrency ?? 5;
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

  async dispose(): Promise<void> {
    await this.client.close();
  }
}
