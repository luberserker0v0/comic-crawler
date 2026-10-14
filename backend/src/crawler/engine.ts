import type { BrowserConfig, ComicMetadata, CrawlStage, ImageInfo, NetworkConfig, SearchOptions, SearchResult } from '@comiccrawler/shared';
import { join } from 'node:path';
import type { AdapterBase } from '../adapter/base';
import { composeChapterImages, composeMetadata } from '../adapter/runtime-composer';
import type { EventBus } from '../events/bus';
import { HtmlParser } from './html-parser';
import type { BrowserPool } from './browser-pool';
import type { RemoteBrowserConfigResolver } from './types';
import { ChapterFetcher } from './chapter-fetcher';
import { ImageDownloader, type DownloadOptions } from './image-downloader';
import { SearchEngine } from './search';
import { selectChapters } from './chapter-selection';
import { ComicError, ErrorType, errorToLogObject } from '../error/types';
import { logger } from '../utils/logger';
import { PlaywrightHtmlRenderer, type HtmlRenderer } from './html-renderer';
import { getGlobalVerifiedBrowserSessionRegistry } from '../challenge/verified-browser-sessions';
import { createEmptyCheckpoint, type ChapterCheckpoint, type CrawlCheckpoint } from '../task/checkpoint';
import {
  createChapterListSummary,
  createDirectChapterMetadata,
  createPreviewFile,
  ensureChapterCheckpoint,
  getOutputRoot,
  isHumanVerificationRequiredError,
  recountCheckpoint,
} from './crawl-helpers';

export interface CrawlerEngineOptions {
  downloadDir: string;
  concurrency?: number;
  eventBus?: EventBus;
  browser?: BrowserConfig;
  network?: NetworkConfig;
  resolveRemoteBrowser?: RemoteBrowserConfigResolver;
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
      mode: 'remote',
      maxInstances: 2,
      timeout: 30000,
      waitUntil: 'domcontentloaded',
      postLoadDelayMs: 0,
    };
    this.htmlRenderer = new PlaywrightHtmlRenderer(this.browserConfig, options.network, options.resolveRemoteBrowser);
  }

  async crawl(adapter: AdapterBase, url: string, options?: CrawlOptions): Promise<CrawlResult> {
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
      ? checkpoint.metadata ?? createDirectChapterMetadata(url, options.chapterUrls)
      : checkpoint.metadata ?? await this.composeMetadata(adapter, url);
    const outputRoot = getOutputRoot(this.downloadDir, url, metadata.title);
    const chapterListSummary = createChapterListSummary(metadata);
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
    let totalImages = recountCheckpoint(checkpoint, chaptersToDownload).totalImages;
    let downloadedImages = recountCheckpoint(checkpoint, chaptersToDownload).completedImages;
    let failedImages = recountCheckpoint(checkpoint, chaptersToDownload).failedImages;

    for (const chapter of chaptersToDownload) {
      const chapterCheckpoint = ensureChapterCheckpoint(checkpoint, chapter);
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
          : await this.composeChapterImages(adapter, chapter.url);
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
        const counts = recountCheckpoint(checkpoint, chaptersToDownload);
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
        const counts = recountCheckpoint(checkpoint, chaptersToDownload);
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
        const counts = recountCheckpoint(checkpoint, chaptersToDownload);
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
        const previewEventPromises: Array<Promise<void>> = [];
        const downloadOptions: DownloadOptions = {
          outputDir: chapterDir,
          concurrency: this.concurrency,
          ...(verifiedSession
            ? { verifiedBrowser: { context: verifiedSession.context, pageUrl: chapter.url } }
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
            const counts = recountCheckpoint(checkpoint, chaptersToDownload);
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
              const previewEventPromise = createPreviewFile(taskId, outputRoot, result.path).then((previewFile) => {
                this.eventBus?.emit('image:downloaded', {
                  taskId,
                  imageUrl: progressImage.url,
                  path: result.path,
                  ...(previewFile ? { previewFile } : {}),
                });
              });
              previewEventPromises.push(previewEventPromise);
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
        await Promise.allSettled(previewEventPromises);
        const counts = recountCheckpoint(checkpoint, chaptersToDownload);
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

    checkpoint.resumable = failedImages > 0;
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

  async search(adapter: AdapterBase, query: string, options?: SearchOptions): Promise<SearchResult[]> {
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

  private attachRenderer(adapter: AdapterBase): void {
    const renderer = this.htmlRenderer;
    if (!renderer) {
      throw new ComicError('Remote HTML renderer is not configured.', ErrorType.CONFIG_ERROR, false, {
        adapterId: adapter.id,
      });
    }
    const rendererAttachableAdapter = adapter as AdapterBase & {
      setHtmlRenderer?: (renderer: HtmlRenderer | undefined) => void;
    };
    if (typeof rendererAttachableAdapter.setHtmlRenderer !== 'function') {
      return;
    }
    rendererAttachableAdapter.setHtmlRenderer({
      render: async (url) => {
        const html = await renderer.render(url);
        if (adapter.verification && await adapter.verification.detectVerificationRequired(html)) {
          throw new ComicError(
            `Adapter "${adapter.id}" detected that human verification is required for ${url}.`,
            ErrorType.AUTH_ERROR,
            false,
            {
              adapterId: adapter.id,
              url,
              antiBotChallenge: true,
              challengeType: 'adapter_verification_required',
            }
          );
        }
        return html;
      },
      dispose: async () => undefined,
    });
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

  private async composeMetadata(adapter: AdapterBase, url: string): Promise<ComicMetadata> {
    return composeMetadata(adapter, url);
  }

  private async composeChapterImages(adapter: AdapterBase, chapterUrl: string): Promise<ImageInfo[]> {
    return composeChapterImages(adapter, chapterUrl);
  }
}
