import type { BrowserConfig, ChapterListSummary, ComicMetadata, CrawlStage, ImageInfo, NetworkConfig, SearchOptions, SearchResult, TaskPreviewFile } from '@comiccrawler/shared';
import { promises as fs } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { BaseAdapter } from '../adapter/base';
import type { EventBus } from '../events/bus';
import { HtmlParser } from './html-parser';
import type { BrowserPool } from './browser-pool';
import { ChapterFetcher } from './chapter-fetcher';
import { ImageDownloader, type DownloadOptions } from './image-downloader';
import { SearchEngine } from './search';
import { selectChapters } from './chapter-selection';
import { ComicError, ErrorType, errorToLogObject } from '../error/types';
import { logger } from '../utils/logger';
import { PlaywrightHtmlRenderer, type HtmlRenderer } from './html-renderer';
import { getGlobalVerifiedBrowserSessionRegistry } from '../challenge/verified-browser-sessions';
import { createEmptyCheckpoint, type ChapterCheckpoint, type CrawlCheckpoint } from '../task/checkpoint';

export interface CrawlerEngineOptions {
  downloadDir: string;
  concurrency?: number;
  eventBus?: EventBus;
  browser?: BrowserConfig;
  network?: NetworkConfig;
}

export interface CrawlResult {
  metadata: ComicMetadata;
  downloadedImages: number;
  failedImages: number;
  totalImages: number;
  outputPath: string;
}

interface PreparedChapterDownload {
  chapter: ComicMetadata['chapters'][number];
  images: ImageInfo[];
  checkpoint: ChapterCheckpoint;
}

interface CrawlOptions {
  chapters?: string[];
  chapterUrls?: string[];
  taskId?: string;
  checkpoint?: CrawlCheckpoint;
  onCheckpoint?: (checkpoint: CrawlCheckpoint) => Promise<void> | void;
}

export class CrawlerEngine {
  private parser: HtmlParser;
  private chapterFetcher: ChapterFetcher;
  private imageDownloader: ImageDownloader;
  private searchEngine: SearchEngine;
  private browserPool?: BrowserPool;
  private htmlRenderer?: HtmlRenderer;
  private browserConfig: BrowserConfig;
  private eventBus?: EventBus;
  private downloadDir: string;
  private concurrency: number;

  constructor(options: CrawlerEngineOptions) {
    this.parser = new HtmlParser();
    this.chapterFetcher = new ChapterFetcher(this.parser);
    this.imageDownloader = new ImageDownloader();
    this.searchEngine = new SearchEngine(this.parser);
    this.eventBus = options.eventBus;
    this.downloadDir = options.downloadDir;
    this.concurrency = options.concurrency ?? 5;
    this.browserConfig = options.browser ?? {
      mode: 'auto',
      headless: true,
      maxInstances: 2,
      timeout: 30000,
      waitUntil: 'domcontentloaded',
      postLoadDelayMs: 0,
    };
    if (this.browserConfig.mode !== 'static') {
      this.htmlRenderer = new PlaywrightHtmlRenderer(this.browserConfig, options.network);
    }
  }

  async crawl(adapter: BaseAdapter, url: string, options?: CrawlOptions): Promise<CrawlResult> {
    const taskId = options?.taskId ?? url;
    const checkpoint = options?.checkpoint ?? createEmptyCheckpoint(taskId);
    const saveCheckpoint = async () => {
      checkpoint.updatedAt = new Date().toISOString();
      await options?.onCheckpoint?.(checkpoint);
    };

    this.eventBus?.emit('task:started', { taskId });
    this.emitProgressStage(taskId, 'adapter', 'initializing crawler');

    this.attachRenderer(adapter);

    const isDirectChapterTask = Boolean(options?.chapterUrls && options.chapterUrls.length > 0);
    this.emitProgressStage(
      taskId,
      isDirectChapterTask ? 'chapter_images' : 'metadata',
      isDirectChapterTask ? 'building direct chapter task' : 'fetching manga metadata and chapter list'
    );
    const metadata = options?.chapterUrls && options.chapterUrls.length > 0
      ? checkpoint.metadata ?? this.createDirectChapterMetadata(url, options.chapterUrls)
      : checkpoint.metadata ?? await this.fetchMetadata(adapter, url);
    const outputRoot = this.getOutputRoot(url, metadata.title);
    const chapterListSummary = this.createChapterListSummary(metadata);
    checkpoint.metadata = metadata;
    checkpoint.outputPath = outputRoot;
    checkpoint.resumable = true;
    await saveCheckpoint();
    this.eventBus?.emit('task:progress', {
      taskId,
      progress: {
        totalImages: 0,
        completedImages: 0,
        failedImages: 0,
        stage: isDirectChapterTask ? 'chapter_images' : 'metadata',
        stageDetail: isDirectChapterTask ? 'direct chapter task prepared' : 'metadata extracted',
        currentChapter: isDirectChapterTask ? 'direct chapter task prepared' : 'metadata extracted',
        metadata: metadata as unknown as Record<string, unknown>,
        chapterListSummary,
        outputPath: outputRoot,
      },
    });
    this.eventBus?.emit('task:metadata_extracted', {
      taskId,
      metadata: metadata as unknown as Record<string, unknown>,
      chapterListSummary,
    });
    this.eventBus?.emit('task:chapter_list_extracted', {
      taskId,
      chapterListSummary,
    });

    const chapterSelection = options?.chapterUrls && options.chapterUrls.length > 0
      ? { chapters: metadata.chapters, unmatched: [] }
      : selectChapters(metadata.chapters, options?.chapters);
    const chaptersToDownload = chapterSelection.chapters;

    if (chapterSelection.unmatched.length > 0) {
      logger.warn(
        { requestedChapters: chapterSelection.unmatched, availableChapters: metadata.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, url: chapter.url })) },
        'Some requested chapters did not match extracted metadata'
      );
    }

    const preparedChapters: PreparedChapterDownload[] = [];
    let totalImages = this.recountCheckpoint(checkpoint, chaptersToDownload).totalImages;
    let downloadedImages = this.recountCheckpoint(checkpoint, chaptersToDownload).completedImages;
    let failedImages = this.recountCheckpoint(checkpoint, chaptersToDownload).failedImages;

    for (const chapter of chaptersToDownload) {
      const chapterCheckpoint = this.ensureChapterCheckpoint(checkpoint, chapter);
      if (chapterCheckpoint.completed) {
        preparedChapters.push({ chapter, images: chapterCheckpoint.images ?? [], checkpoint: chapterCheckpoint });
        continue;
      }

      this.eventBus?.emit('task:progress', {
        taskId,
        progress: {
          totalImages,
          completedImages: downloadedImages,
          failedImages,
          stage: 'chapter_images',
          stageDetail: `extracting images: ${chapter.title}`,
          currentChapter: `rendering chapter page and extracting images: ${chapter.title}`,
        },
      });

      try {
        const images = chapterCheckpoint.images?.length
          ? chapterCheckpoint.images
          : await this.fetchChapterImages(adapter, chapter.url);
        if (images.length === 0) {
          throw new ComicError(
            `No images were extracted for chapter "${chapter.title}".`,
            ErrorType.PARSING_ERROR,
            true,
            {
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              chapterUrl: chapter.url,
              adapterId: adapter.id,
            }
          );
        }
        chapterCheckpoint.images = images;
        chapterCheckpoint.lastError = undefined;
        checkpoint.currentChapterId = chapter.id;
        checkpoint.currentChapterTitle = chapter.title;
        const counts = this.recountCheckpoint(checkpoint, chaptersToDownload);
        totalImages = counts.totalImages;
        downloadedImages = counts.completedImages;
        failedImages = counts.failedImages;
        checkpoint.totalImages = totalImages;
        checkpoint.completedImages = downloadedImages;
        checkpoint.failedImages = failedImages;
        checkpoint.lastError = undefined;
        await saveCheckpoint();
        preparedChapters.push({ chapter, images, checkpoint: chapterCheckpoint });
        this.eventBus?.emit('task:progress', {
          taskId,
          progress: {
            totalImages,
            completedImages: downloadedImages,
            failedImages,
            stage: 'chapter_images',
            stageDetail: `prepared ${chapter.title}`,
            currentChapter: `prepared ${chapter.title}`,
          },
        });
      } catch (error) {
        if (isHumanVerificationRequiredError(error)) {
          checkpoint.currentChapterId = chapter.id;
          checkpoint.currentChapterTitle = chapter.title;
          checkpoint.lastError = errorToLogObject(error).message as string;
          await saveCheckpoint();
          throw error;
        }
        chapterCheckpoint.lastError = errorToLogObject(error).message as string;
        checkpoint.lastError = chapterCheckpoint.lastError;
        const counts = this.recountCheckpoint(checkpoint, chaptersToDownload);
        totalImages = counts.totalImages;
        downloadedImages = counts.completedImages;
        failedImages = counts.failedImages + 1;
        checkpoint.totalImages = totalImages;
        checkpoint.completedImages = downloadedImages;
        checkpoint.failedImages = failedImages;
        await saveCheckpoint();
        logger.error({ chapter: chapter.title, error: errorToLogObject(error) }, 'Failed to prepare chapter images');
        this.eventBus?.emit('task:progress', {
          taskId,
          progress: {
            totalImages,
            completedImages: downloadedImages,
            failedImages,
            stage: 'chapter_images',
            stageDetail: `failed to prepare ${chapter.title}`,
            currentChapter: `failed to prepare ${chapter.title}`,
          },
        });
      }
    }

    this.eventBus?.emit('task:progress', {
      taskId,
      progress: {
        totalImages,
        completedImages: downloadedImages,
        failedImages,
        stage: 'downloading',
        stageDetail: preparedChapters[0]?.chapter.title ? `ready to download ${preparedChapters[0].chapter.title}` : 'ready',
        currentChapter: preparedChapters[0]?.chapter.title ?? 'ready',
      },
    });

    if (chaptersToDownload.length > 0 && preparedChapters.length === 0) {
      throw new ComicError(
        `Failed to prepare images for all requested chapters (${failedImages}/${chaptersToDownload.length}).`,
        ErrorType.PARSING_ERROR,
        true,
        {
          failedImages,
          requestedChapters: chaptersToDownload.map((chapter) => ({
            id: chapter.id,
            title: chapter.title,
            url: chapter.url,
          })),
        }
      );
    }

    for (const { chapter, images, checkpoint: chapterCheckpoint } of preparedChapters) {
      const completedSet = new Set(chapterCheckpoint.completedImageIndexes);
      const remainingImages = images.filter((image) => !completedSet.has(image.index));
      if (remainingImages.length === 0) {
        chapterCheckpoint.completed = images.length > 0;
        const counts = this.recountCheckpoint(checkpoint, chaptersToDownload);
        totalImages = counts.totalImages;
        downloadedImages = counts.completedImages;
        failedImages = counts.failedImages;
        checkpoint.totalImages = totalImages;
        checkpoint.completedImages = downloadedImages;
        checkpoint.failedImages = failedImages;
        await saveCheckpoint();
        this.eventBus?.emit('chapter:completed', { taskId, chapterId: chapter.id });
        continue;
      }

      this.eventBus?.emit('task:progress', {
        taskId,
        progress: {
          totalImages,
          completedImages: downloadedImages,
          failedImages,
          stage: 'downloading',
          stageDetail: `downloading ${chapter.title}`,
          currentChapter: chapter.title,
        },
      });

      try {

        const chapterDir = join(outputRoot, chapter.title);
        const verifiedSession = getGlobalVerifiedBrowserSessionRegistry().getByUrl(chapter.url);
        const downloadOptions: DownloadOptions = {
          outputDir: chapterDir,
          concurrency: this.concurrency,
          ...(verifiedSession?.cdpUrl
            ? { verifiedBrowser: { cdpUrl: verifiedSession.cdpUrl, pageUrl: chapter.url } }
            : {}),
          onProgress: (completed, _total, result, image) => {
            const progressImage = image ?? remainingImages[completed - 1];
            if (!progressImage) {
              return;
            }
            const failedSet = new Set(chapterCheckpoint.failedImageIndexes);
            const completedImagesSet = new Set(chapterCheckpoint.completedImageIndexes);
            if (result !== null) {
              completedImagesSet.add(progressImage.index);
              failedSet.delete(progressImage.index);
            } else {
              failedSet.add(progressImage.index);
            }
            chapterCheckpoint.completedImageIndexes = Array.from(completedImagesSet).sort((a, b) => a - b);
            chapterCheckpoint.failedImageIndexes = Array.from(failedSet).sort((a, b) => a - b);
            chapterCheckpoint.completed = images.length > 0 && chapterCheckpoint.completedImageIndexes.length >= images.length;
            checkpoint.currentChapterId = chapter.id;
            checkpoint.currentChapterTitle = chapter.title;
            const counts = this.recountCheckpoint(checkpoint, chaptersToDownload);
            totalImages = counts.totalImages;
            downloadedImages = counts.completedImages;
            failedImages = counts.failedImages;
            checkpoint.totalImages = totalImages;
            checkpoint.completedImages = downloadedImages;
            checkpoint.failedImages = failedImages;
            checkpoint.lastError = result !== null ? checkpoint.lastError : `Failed to download image ${progressImage.index} from ${chapter.title}`;
            void saveCheckpoint();
            this.eventBus?.emit('task:progress', {
              taskId,
              progress: {
                totalImages,
                completedImages: downloadedImages,
                failedImages,
                stage: 'downloading',
                stageDetail: `downloading ${chapter.title}: ${downloadedImages}/${totalImages} images`,
                currentChapter: chapter.title,
              },
            });
            if (result) {
              void this.createPreviewFile(taskId, outputRoot, result.path).then((previewFile) => {
                this.eventBus?.emit('image:downloaded', {
                  taskId,
                  imageUrl: progressImage.url,
                  path: result.path,
                  ...(previewFile ? { previewFile } : {}),
                });
              });
            } else if (result === null) {
              this.eventBus?.emit('image:failed', {
                taskId,
                imageUrl: progressImage.url,
                error: new Error(`Failed to download image ${progressImage.index} from ${chapter.title}`),
              });
            }
          },
        };

        await this.imageDownloader.downloadBatch(remainingImages, downloadOptions);
        const counts = this.recountCheckpoint(checkpoint, chaptersToDownload);
        totalImages = counts.totalImages;
        downloadedImages = counts.completedImages;
        failedImages = counts.failedImages;
        checkpoint.totalImages = totalImages;
        checkpoint.completedImages = downloadedImages;
        checkpoint.failedImages = failedImages;
        chapterCheckpoint.completed = images.length > 0 && chapterCheckpoint.completedImageIndexes.length >= images.length;
        checkpoint.lastError = undefined;
        await saveCheckpoint();
        this.eventBus?.emit('task:progress', {
          taskId,
          progress: {
            totalImages,
            completedImages: downloadedImages,
            failedImages,
            stage: 'downloading',
            stageDetail: `downloaded ${chapter.title}`,
            currentChapter: chapter.title,
          },
        });

        this.eventBus?.emit('chapter:completed', { taskId, chapterId: chapter.id });
      } catch (error) {
        if (isHumanVerificationRequiredError(error)) {
          checkpoint.currentChapterId = chapter.id;
          checkpoint.currentChapterTitle = chapter.title;
          checkpoint.lastError = errorToLogObject(error).message as string;
          await saveCheckpoint();
          throw error;
        }
        chapterCheckpoint.lastError = errorToLogObject(error).message as string;
        checkpoint.lastError = chapterCheckpoint.lastError;
        failedImages++;
        checkpoint.failedImages = failedImages;
        await saveCheckpoint();
        logger.error({ chapter: chapter.title, error: errorToLogObject(error) }, 'Failed to download chapter');
        this.eventBus?.emit('task:progress', {
          taskId,
          progress: {
            totalImages,
            completedImages: downloadedImages,
            failedImages,
            stage: 'failed',
            stageDetail: `failed ${chapter.title}`,
            currentChapter: `failed ${chapter.title}`,
          },
        });
      }
    }

    checkpoint.resumable = false;
    checkpoint.lastError = undefined;
    checkpoint.totalImages = totalImages;
    checkpoint.completedImages = downloadedImages;
    checkpoint.failedImages = failedImages;
    await saveCheckpoint();

    this.eventBus?.emit('task:progress', {
      taskId,
      progress: {
        totalImages,
        completedImages: downloadedImages,
        failedImages,
        stage: 'completed',
        stageDetail: 'crawl completed',
        currentChapter: 'completed',
      },
    });

    this.eventBus?.emit('task:completed', {
      taskId,
      result: {
        metadata,
        downloadedImages,
        failedImages,
        totalImages,
        outputPath: outputRoot,
      },
    });

    return {
      metadata,
      downloadedImages,
      failedImages,
      totalImages,
      outputPath: outputRoot,
    };
  }

  private createChapterListSummary(metadata: ComicMetadata): ChapterListSummary {
    return {
      totalChapters: metadata.chapters.length,
      chapters: metadata.chapters.slice(0, 50).map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        url: chapter.url,
      })),
    };
  }

  private async createPreviewFile(taskId: string, rootDir: string, filePath: string): Promise<TaskPreviewFile | undefined> {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return undefined;
      }
      const relativePath = relative(rootDir, filePath);
      const isImage = this.isPreviewImage(filePath);
      return {
        name: filePath.split(/[\\/]/).pop() ?? relativePath,
        relativePath,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        isImage,
        url: isImage ? `/api/tasks/${encodeURIComponent(taskId)}/preview-file?path=${encodeURIComponent(relativePath)}` : undefined,
      };
    } catch {
      return undefined;
    }
  }

  private isPreviewImage(path: string): boolean {
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'].includes(extname(path).toLowerCase());
  }

  private ensureChapterCheckpoint(checkpoint: CrawlCheckpoint, chapter: ComicMetadata['chapters'][number]): ChapterCheckpoint {
    const existing = checkpoint.chapters[chapter.id];
    if (existing) {
      return existing;
    }

    const created: ChapterCheckpoint = {
      id: chapter.id,
      title: chapter.title,
      url: chapter.url,
      completedImageIndexes: [],
      failedImageIndexes: [],
      completed: false,
    };
    checkpoint.chapters[chapter.id] = created;
    return created;
  }

  private recountCheckpoint(
    checkpoint: CrawlCheckpoint,
    chapters: Array<ComicMetadata['chapters'][number]>
  ): { totalImages: number; completedImages: number; failedImages: number } {
    let totalImages = 0;
    let completedImages = 0;
    let failedImages = 0;

    for (const chapter of chapters) {
      const chapterCheckpoint = checkpoint.chapters[chapter.id];
      if (!chapterCheckpoint) {
        continue;
      }

      totalImages += chapterCheckpoint.images?.length ?? 0;
      completedImages += new Set(chapterCheckpoint.completedImageIndexes).size;
      const completedSet = new Set(chapterCheckpoint.completedImageIndexes);
      failedImages += new Set(chapterCheckpoint.failedImageIndexes.filter((index) => !completedSet.has(index))).size;
    }

    return { totalImages, completedImages, failedImages };
  }

  private getOutputRoot(url: string, title: string): string {
    const hostname = this.safePathSegment(new URL(url).hostname.replace(/^www\./i, ''));
    return join(this.downloadDir, hostname, this.safePathSegment(title));
  }

  private createDirectChapterMetadata(url: string, chapterUrls: string[]): ComicMetadata {
    const firstUrl = chapterUrls[0] ?? url;
    const title = this.deriveComicTitle(url);

    return {
      id: this.safeSegment(title || 'direct-chapters'),
      title: title || 'Direct Chapters',
      status: 'unknown',
      chapters: chapterUrls.map((chapterUrl, index) => ({
        id: this.safeSegment(new URL(chapterUrl).pathname.split('/').filter(Boolean).at(-1) ?? `chapter-${index + 1}`),
        title: this.deriveChapterTitle(chapterUrl, index),
        url: chapterUrl,
      })),
      updatedAt: new Date(),
    };
  }

  private deriveComicTitle(url: string): string {
    try {
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      const mangaIndex = segments.indexOf('manga');
      const slug = mangaIndex >= 0 ? segments[mangaIndex + 1] : segments.at(-2) ?? segments.at(-1);
      return slug ?? 'Direct Chapters';
    } catch {
      return 'Direct Chapters';
    }
  }

  private deriveChapterTitle(chapterUrl: string, index: number): string {
    try {
      const segment = new URL(chapterUrl).pathname.split('/').filter(Boolean).at(-1);
      return segment ?? `chapter-${index + 1}`;
    } catch {
      return `chapter-${index + 1}`;
    }
  }

  private safeSegment(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'chapter';
  }

  private safePathSegment(value: string): string {
    return value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-').replace(/\s+/g, ' ').replace(/^-+|-+$/g, '') || 'unknown';
  }

  async search(adapter: BaseAdapter, query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this.searchEngine.search(adapter, query, options);
  }

  async dispose(): Promise<void> {
    await this.imageDownloader.dispose();
    if (this.htmlRenderer) {
      await this.htmlRenderer.dispose();
    }
    if (this.browserPool) {
      await this.browserPool.dispose();
    }
  }

  private attachRenderer(adapter: BaseAdapter): void {
    if (typeof (adapter as any).setHtmlRenderer === 'function') {
      adapter.setHtmlRenderer(this.htmlRenderer);
    }
  }

  private emitProgressStage(taskId: string, stage: CrawlStage, stageDetail: string): void {
    this.eventBus?.emit('task:progress', {
      taskId,
      progress: {
        totalImages: 0,
        completedImages: 0,
        failedImages: 0,
        stage,
        stageDetail,
        currentChapter: stageDetail,
      },
    });
  }

  private async fetchMetadata(adapter: BaseAdapter, url: string): Promise<ComicMetadata> {
    return this.withCrawlerFetchMode(adapter, () => adapter.fetchMetadata(url), {
      adapter,
      url,
      operation: 'fetchMetadata',
    });
  }

  private async fetchChapterImages(adapter: BaseAdapter, chapterUrl: string): Promise<ImageInfo[]> {
    return this.withCrawlerFetchMode(adapter, () => adapter.fetchChapterImages(chapterUrl), {
      adapter,
      url: chapterUrl,
      operation: 'fetchChapterImages',
    });
  }

  private async withCrawlerFetchMode<T>(
    adapter: BaseAdapter,
    operation: () => Promise<T>,
    context: { adapter: BaseAdapter; url: string; operation: string }
  ): Promise<T> {
    const preferredMode = this.getPreferredMode(adapter);
    if (preferredMode === 'static') {
      return this.runAdapterOperation(adapter, 'static', operation);
    }

    if (preferredMode === 'headless') {
      return this.runAdapterOperation(adapter, 'headless', operation);
    }

    try {
      return await this.runAdapterOperation(adapter, 'static', operation);
    } catch (staticError) {
      if (!this.shouldFallbackToHeadless(staticError)) {
        throw staticError;
      }

      logger.warn(
        {
          adapterId: context.adapter.id,
          url: context.url,
          operation: context.operation,
          error: errorToLogObject(staticError),
        },
        'Static extraction failed; retrying with Playwright headless render'
      );

      try {
        return await this.runAdapterOperation(adapter, 'headless', operation);
      } catch (headlessError) {
        throw new ComicError(
          `Static extraction failed and headless fallback also failed for ${context.url}`,
          ErrorType.PARSING_ERROR,
          false,
          {
            adapterId: context.adapter.id,
            operation: context.operation,
            url: context.url,
            staticError: errorToLogObject(staticError),
            headlessError: errorToLogObject(headlessError),
          }
        );
      }
    }
  }

  private getPreferredMode(adapter: BaseAdapter): 'static' | 'headless' | 'auto' {
    if (this.browserConfig.mode !== 'auto') {
      return this.browserConfig.mode;
    }
    if (adapter.parseMode === 'dynamic' || adapter.parseMode === 'interactive') {
      return 'headless';
    }
    return 'auto';
  }

  private async runAdapterOperation<T>(
    adapter: BaseAdapter,
    mode: 'static' | 'headless',
    operation: () => Promise<T>
  ): Promise<T> {
    if (typeof (adapter as any).withHtmlFetchMode === 'function') {
      return adapter.withHtmlFetchMode(mode, operation);
    }
    return operation();
  }

  private shouldFallbackToHeadless(error: unknown): boolean {
    if (error instanceof ComicError) {
      if (error.type === ErrorType.NETWORK_ERROR && isHeadlessFallbackHttpStatus(error.context.statusCode)) {
        return true;
      }
      return error.type === ErrorType.PARSING_ERROR;
    }

    if (error instanceof Error) {
      return /HTTP (401|403|429|503)|forbidden|access denied|captcha|cloudflare|anti-bot|too many requests|no chapters|no images|required selector|parsing|empty html/i.test(error.message);
    }

    return false;
  }
}

function isHeadlessFallbackHttpStatus(statusCode: unknown): boolean {
  return statusCode === 401 || statusCode === 403 || statusCode === 429 || statusCode === 503;
}

function isHumanVerificationRequiredError(error: unknown): boolean {
  if (error instanceof ComicError) {
    return hasHumanVerificationContext(error.context);
  }
  const message = error instanceof Error ? error.message : String(error);
  return /anti-bot|human verification|challenge|cloudflare|sorry, you have been blocked|unable to access/i.test(message);
}

function hasHumanVerificationContext(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  if (
    context.antiBotChallenge === true ||
    context.challengeType === 'access_blocked' ||
    context.humanVerificationProfileUnavailable === true
  ) return true;
  return Object.values(context).some((entry) => hasHumanVerificationContext(entry));
}
