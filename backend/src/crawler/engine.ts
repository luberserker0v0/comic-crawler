import type { BrowserConfig, ComicMetadata, CrawlStage, ImageInfo, NetworkConfig, SearchOptions, SearchResult } from '@comiccrawler/shared';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AdapterBase } from '../adapter/base';
import { composeChapterImages, composeMetadata } from '../adapter/runtime-composer';
import type { EventBus } from '../events/bus';
import { HtmlParser } from './html-parser';
import { ChapterFetcher } from './chapter-fetcher';
import { ImageDownloader, type DownloadOptions } from './image-downloader';
import { SearchEngine } from './search';
import { selectChapters } from './chapter-selection';
import { ComicError, ErrorType, errorToLogObject } from '../error/types';
import { logger } from '../utils/logger';
import { GatewayHtmlRenderer, type HtmlRenderer } from './html-renderer';
import type { BrowserRenderService } from '../browser/browser-render-service';
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
  browserRenderService?: BrowserRenderService;
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
  browserSessionId?: string;
}

interface CrawlBrowserContext {
  sessionId?: string;
}

interface CrawlExecutionContext {
  adapter: AdapterBase; url: string; options?: CrawlOptions; taskId: string;
  checkpoint: CrawlCheckpoint; saveCheckpoint(): Promise<void>; direct: boolean;
  metadata: ComicMetadata; outputRoot: string; chapters: ComicMetadata['chapters'];
  prepared: PreparedChapterDownload[]; totalImages: number; downloadedImages: number; failedImages: number;
}

export class CrawlerEngine {
  private parser: HtmlParser;
  private chapterFetcher: ChapterFetcher;
  private imageDownloader: ImageDownloader;
  private searchEngine: SearchEngine;
  private htmlRenderer?: HtmlRenderer;
  private browserConfig: BrowserConfig;
  private eventBus?: EventBus;
  private downloadDir!: string;
  private concurrency!: number;
  private readonly browserContext = new AsyncLocalStorage<CrawlBrowserContext>();

  constructor(options: CrawlerEngineOptions) {
    this.parser = new HtmlParser();
    this.chapterFetcher = new ChapterFetcher(this.parser);
    this.imageDownloader = new ImageDownloader();
    this.searchEngine = new SearchEngine(this.parser);
    Object.assign(this, { eventBus: options.eventBus, downloadDir: options.downloadDir,
      concurrency: options.concurrency ?? 5 });
    this.browserConfig = options.browser ?? {
      timeout: 30000, workerWaitTimeoutMs: 30 * 60 * 1000, postLoadDelayMs: 0,
    };
    this.htmlRenderer = options.browserRenderService ? new GatewayHtmlRenderer(
      options.browserRenderService, () => this.browserContext.getStore()?.sessionId, this.browserConfig)
      : missingHtmlRenderer();
  }

  async crawl(adapter: AdapterBase, url: string, options?: CrawlOptions): Promise<CrawlResult> {
    return this.browserContext.run(
      { sessionId: options?.browserSessionId },
      () => this.crawlWithBrowserContext(adapter, url, options)
    );
  }

  private async crawlWithBrowserContext(adapter: AdapterBase, url: string, options?: CrawlOptions): Promise<CrawlResult> {
    const context = await this.initializeCrawl(adapter, url, options);
    for (const chapter of context.chapters) await this.prepareChapter(context, chapter);
    this.emitDownloadReady(context);
    assertPreparedChapters(context);
    for (const item of context.prepared) await this.downloadChapter(context, item);
    return this.finishCrawl(context);
  }

  private async initializeCrawl(
    adapter: AdapterBase, url: string, options?: CrawlOptions
  ): Promise<CrawlExecutionContext> {
    const taskId = options?.taskId ?? url;
    const checkpoint = options?.checkpoint ?? createEmptyCheckpoint(taskId);
    const saveCheckpoint = createCheckpointSaver(checkpoint, options);
    this.startCrawl(taskId, adapter);
    const direct = Boolean(options?.chapterUrls?.length);
    const metadata = await this.prepareMetadata(adapter, url, options, checkpoint, taskId, direct);
    const outputRoot = getOutputRoot(this.downloadDir, url, metadata.title);
    Object.assign(checkpoint, { metadata, outputPath: outputRoot, resumable: true });
    await saveCheckpoint();
    this.emitMetadataReady(taskId, metadata, outputRoot, direct);
    const chapters = selectCrawlChapters(metadata, options, direct);
    const counts = recountCheckpoint(checkpoint, chapters);
    return { adapter, url, options, taskId, checkpoint, saveCheckpoint, direct, metadata,
      outputRoot, chapters, prepared: [], totalImages: counts.totalImages,
      downloadedImages: counts.completedImages, failedImages: counts.failedImages };
  }

  private startCrawl(taskId: string, adapter: AdapterBase): void {
    this.eventBus?.emit('task:started', { taskId });
    this.emitProgressStage(taskId, 'adapter', 'initializing crawler');
    this.attachRenderer(adapter);
  }

  private async prepareMetadata(
    adapter: AdapterBase, url: string, options: CrawlOptions | undefined,
    checkpoint: CrawlCheckpoint, taskId: string, direct: boolean
  ): Promise<ComicMetadata> {
    this.emitProgressStage(taskId, direct ? 'chapter_images' : 'metadata',
      direct ? 'building direct chapter task' : 'fetching manga metadata and chapter list');
    if (checkpoint.metadata) return checkpoint.metadata;
    return direct ? createDirectChapterMetadata(url, options!.chapterUrls!)
      : this.composeMetadata(adapter, url);
  }

  private emitMetadataReady(taskId: string, metadata: ComicMetadata, outputPath: string, direct: boolean): void {
    const chapterListSummary = createChapterListSummary(metadata);
    const detail = direct ? 'direct chapter task prepared' : 'metadata extracted';
    this.eventBus?.emit('task:progress', { taskId, progress: { totalImages: 0,
      completedImages: 0, failedImages: 0, stage: direct ? 'chapter_images' : 'metadata',
      stageDetail: detail, currentChapter: detail, metadata: metadata as unknown as Record<string, unknown>,
      chapterListSummary, outputPath } });
    this.eventBus?.emit('task:metadata_extracted', { taskId,
      metadata: metadata as unknown as Record<string, unknown>, chapterListSummary });
    this.eventBus?.emit('task:chapter_list_extracted', { taskId, chapterListSummary });
  }

  private async prepareChapter(
    context: CrawlExecutionContext, chapter: ComicMetadata['chapters'][number]
  ): Promise<void> {
    const checkpoint = ensureChapterCheckpoint(context.checkpoint, chapter);
    if (checkpoint.completed) {
      context.prepared.push({ chapter, images: checkpoint.images ?? [], checkpoint });
      return;
    }
    this.emitCrawlProgress(context, 'chapter_images', `extracting images: ${chapter.title}`,
      `rendering chapter page and extracting images: ${chapter.title}`);
    try {
      const images = checkpoint.images?.length ? checkpoint.images
        : await this.composeChapterImages(context.adapter, chapter.url);
      requireChapterImages(context.adapter, chapter, images);
      await this.completeChapterPreparation(context, chapter, checkpoint, images);
    } catch (error) { await this.failChapterPreparation(context, chapter, checkpoint, error); }
  }

  private async completeChapterPreparation(
    context: CrawlExecutionContext, chapter: ComicMetadata['chapters'][number],
    checkpoint: ChapterCheckpoint, images: ImageInfo[]
  ): Promise<void> {
    checkpoint.images = images;
    checkpoint.lastError = undefined;
    setCurrentChapter(context.checkpoint, chapter);
    this.updateCounts(context);
    context.checkpoint.lastError = undefined;
    await context.saveCheckpoint();
    context.prepared.push({ chapter, images, checkpoint });
    this.emitCrawlProgress(context, 'chapter_images', `prepared ${chapter.title}`, `prepared ${chapter.title}`);
  }

  private async failChapterPreparation(
    context: CrawlExecutionContext, chapter: ComicMetadata['chapters'][number],
    checkpoint: ChapterCheckpoint, error: unknown
  ): Promise<void> {
    if (isHumanVerificationRequiredError(error)) return this.persistVerificationError(context, chapter, error);
    checkpoint.lastError = errorToLogObject(error).message as string;
    context.checkpoint.lastError = checkpoint.lastError;
    this.updateCounts(context, 1);
    await context.saveCheckpoint();
    logger.error({ chapter: chapter.title, error: errorToLogObject(error) }, 'Failed to prepare chapter images');
    this.emitCrawlProgress(context, 'chapter_images', `failed to prepare ${chapter.title}`,
      `failed to prepare ${chapter.title}`);
  }

  private emitDownloadReady(context: CrawlExecutionContext): void {
    const title = context.prepared[0]?.chapter.title;
    this.emitCrawlProgress(context, 'downloading', title ? `ready to download ${title}` : 'ready', title ?? 'ready');
  }

  private async downloadChapter(context: CrawlExecutionContext, item: PreparedChapterDownload): Promise<void> {
    const remaining = remainingChapterImages(item);
    if (remaining.length === 0) return this.completeSkippedChapter(context, item);
    this.emitCrawlProgress(context, 'downloading', `downloading ${item.chapter.title}`, item.chapter.title);
    const previews: Array<Promise<void>> = [];
    try {
      const options = this.createDownloadOptions(context, item, remaining, previews);
      await this.imageDownloader.downloadBatch(remaining, options);
      await Promise.allSettled(previews);
      await this.completeDownloadedChapter(context, item);
    } catch (error) { await this.failChapterDownload(context, item, error); }
  }

  private createDownloadOptions(
    context: CrawlExecutionContext, item: PreparedChapterDownload, remaining: ImageInfo[],
    previews: Array<Promise<void>>
  ): DownloadOptions {
    return { outputDir: join(context.outputRoot, item.chapter.title), concurrency: this.concurrency,
      onProgress: (completed, _total, result, image) => this.handleDownloadProgress(
        context, item, image ?? remaining[completed - 1], result, previews) };
  }

  private handleDownloadProgress(
    context: CrawlExecutionContext, item: PreparedChapterDownload, image: ImageInfo | undefined,
    result: Parameters<NonNullable<DownloadOptions['onProgress']>>[2], previews: Array<Promise<void>>
  ): void {
    if (!image) return;
    updateImageIndexes(item.checkpoint, image.index, result !== null, item.images.length);
    setCurrentChapter(context.checkpoint, item.chapter);
    this.updateCounts(context);
    if (result === null) context.checkpoint.lastError =
      `Failed to download image ${image.index} from ${item.chapter.title}`;
    void context.saveCheckpoint();
    this.emitCrawlProgress(context, 'downloading',
      `downloading ${item.chapter.title}: ${context.downloadedImages}/${context.totalImages} images`, item.chapter.title);
    this.emitImageResult(context, item, image, result, previews);
  }

  private emitImageResult(
    context: CrawlExecutionContext, item: PreparedChapterDownload, image: ImageInfo,
    result: Parameters<NonNullable<DownloadOptions['onProgress']>>[2], previews: Array<Promise<void>>
  ): void {
    if (result) {
      previews.push(createPreviewFile(context.taskId, context.outputRoot, result.path).then((previewFile) =>
        this.eventBus?.emit('image:downloaded', { taskId: context.taskId, imageUrl: image.url,
          path: result.path, ...(previewFile ? { previewFile } : {}) })));
    } else this.eventBus?.emit('image:failed', { taskId: context.taskId, imageUrl: image.url,
      error: new Error(`Failed to download image ${image.index} from ${item.chapter.title}`) });
  }

  private async completeSkippedChapter(
    context: CrawlExecutionContext, item: PreparedChapterDownload
  ): Promise<void> {
    item.checkpoint.completed = item.images.length > 0;
    this.updateCounts(context);
    await context.saveCheckpoint();
    this.eventBus?.emit('chapter:completed', { taskId: context.taskId, chapterId: item.chapter.id });
  }

  private async completeDownloadedChapter(
    context: CrawlExecutionContext, item: PreparedChapterDownload
  ): Promise<void> {
    this.updateCounts(context);
    item.checkpoint.completed = item.images.length > 0
      && item.checkpoint.completedImageIndexes.length >= item.images.length;
    context.checkpoint.lastError = undefined;
    await context.saveCheckpoint();
    this.emitCrawlProgress(context, 'downloading', `downloaded ${item.chapter.title}`, item.chapter.title);
    this.eventBus?.emit('chapter:completed', { taskId: context.taskId, chapterId: item.chapter.id });
  }

  private async failChapterDownload(
    context: CrawlExecutionContext, item: PreparedChapterDownload, error: unknown
  ): Promise<void> {
    if (isHumanVerificationRequiredError(error)) return this.persistVerificationError(context, item.chapter, error);
    item.checkpoint.lastError = errorToLogObject(error).message as string;
    context.checkpoint.lastError = item.checkpoint.lastError;
    context.failedImages += 1;
    context.checkpoint.failedImages = context.failedImages;
    await context.saveCheckpoint();
    logger.error({ chapter: item.chapter.title, error: errorToLogObject(error) }, 'Failed to download chapter');
    this.emitCrawlProgress(context, 'failed', `failed ${item.chapter.title}`, `failed ${item.chapter.title}`);
  }

  private async persistVerificationError(
    context: CrawlExecutionContext, chapter: ComicMetadata['chapters'][number], error: unknown
  ): Promise<never> {
    setCurrentChapter(context.checkpoint, chapter);
    context.checkpoint.lastError = errorToLogObject(error).message as string;
    await context.saveCheckpoint();
    throw error;
  }

  private updateCounts(context: CrawlExecutionContext, failedOffset = 0): void {
    const counts = recountCheckpoint(context.checkpoint, context.chapters);
    context.totalImages = counts.totalImages;
    context.downloadedImages = counts.completedImages;
    context.failedImages = counts.failedImages + failedOffset;
    Object.assign(context.checkpoint, { totalImages: context.totalImages,
      completedImages: context.downloadedImages, failedImages: context.failedImages });
  }

  private emitCrawlProgress(
    context: CrawlExecutionContext, stage: CrawlStage, stageDetail: string, currentChapter: string
  ): void {
    this.eventBus?.emit('task:progress', { taskId: context.taskId, progress: {
      totalImages: context.totalImages, completedImages: context.downloadedImages,
      failedImages: context.failedImages, stage, stageDetail, currentChapter } });
  }

  private async finishCrawl(context: CrawlExecutionContext): Promise<CrawlResult> {
    Object.assign(context.checkpoint, { resumable: context.failedImages > 0, lastError: undefined,
      totalImages: context.totalImages, completedImages: context.downloadedImages,
      failedImages: context.failedImages });
    await context.saveCheckpoint();
    this.emitCrawlProgress(context, 'completed', 'crawl completed', 'completed');
    const result = { metadata: context.metadata, downloadedImages: context.downloadedImages,
      failedImages: context.failedImages, totalImages: context.totalImages, outputPath: context.outputRoot };
    this.eventBus?.emit('task:completed', { taskId: context.taskId, result });
    return result;
  }

  async search(adapter: AdapterBase, query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this.searchEngine.search(adapter, query, options);
  }

  async dispose(): Promise<void> {
    await this.imageDownloader.dispose();
    if (this.htmlRenderer) {
      await this.htmlRenderer.dispose();
    }
  }

  private attachRenderer(adapter: AdapterBase): void {
    const renderer = this.htmlRenderer;
    if (!renderer) return;
    const rendererAttachableAdapter = adapter as AdapterBase & {
      setHtmlRenderer?: (renderer: HtmlRenderer | undefined) => void;
    };
    if (typeof rendererAttachableAdapter.setHtmlRenderer !== 'function') return;
    rendererAttachableAdapter.setHtmlRenderer({
      render: (url) => this.renderAdapterPage(adapter, renderer, url),
      dispose: async () => undefined,
    });
  }

  private async renderAdapterPage(adapter: AdapterBase, renderer: HtmlRenderer, url: string): Promise<string> {
    const html = await renderer.render(url);
    if (adapter.verification && await adapter.verification.detectVerificationRequired(html))
      throw new ComicError(`Adapter "${adapter.id}" detected that human verification is required for ${url}.`,
        ErrorType.AUTH_ERROR, false, { adapterId: adapter.id, url, antiBotChallenge: true,
          challengeType: 'adapter_verification_required' });
    return html;
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

function missingHtmlRenderer(): HtmlRenderer {
  return { render: async () => { throw new ComicError(
    'Browser Worker renderer is required for rendered DOM.', ErrorType.CONFIG_ERROR, false); },
  dispose: async () => undefined };
}

function createCheckpointSaver(checkpoint: CrawlCheckpoint, options?: CrawlOptions) {
  return async () => {
    checkpoint.updatedAt = new Date().toISOString();
    await options?.onCheckpoint?.(checkpoint);
  };
}

function selectCrawlChapters(
  metadata: ComicMetadata, options: CrawlOptions | undefined, direct: boolean
): ComicMetadata['chapters'] {
  const selection = direct ? { chapters: metadata.chapters, unmatched: [] }
    : selectChapters(metadata.chapters, options?.chapters);
  if (selection.unmatched.length > 0) logger.warn({ requestedChapters: selection.unmatched,
    availableChapters: metadata.chapters.map((chapter) => ({ id: chapter.id,
      title: chapter.title, url: chapter.url })) },
  'Some requested chapters did not match extracted metadata');
  return selection.chapters;
}

function requireChapterImages(
  adapter: AdapterBase, chapter: ComicMetadata['chapters'][number], images: ImageInfo[]
): void {
  if (images.length > 0) return;
  throw new ComicError(`No images were extracted for chapter "${chapter.title}".`,
    ErrorType.PARSING_ERROR, true, { chapterId: chapter.id, chapterTitle: chapter.title,
      chapterUrl: chapter.url, adapterId: adapter.id });
}

function assertPreparedChapters(context: CrawlExecutionContext): void {
  if (context.chapters.length === 0 || context.prepared.length > 0) return;
  throw new ComicError(
    `Failed to prepare images for all requested chapters (${context.failedImages}/${context.chapters.length}).`,
    ErrorType.PARSING_ERROR, true, { failedImages: context.failedImages,
      requestedChapters: context.chapters.map((chapter) => ({ id: chapter.id,
        title: chapter.title, url: chapter.url })) });
}

function remainingChapterImages(item: PreparedChapterDownload): ImageInfo[] {
  const completed = new Set(item.checkpoint.completedImageIndexes);
  return item.images.filter((image) => !completed.has(image.index));
}

function updateImageIndexes(
  checkpoint: ChapterCheckpoint, index: number, completed: boolean, imageCount: number
): void {
  const failed = new Set(checkpoint.failedImageIndexes);
  const done = new Set(checkpoint.completedImageIndexes);
  if (completed) { done.add(index); failed.delete(index); } else failed.add(index);
  checkpoint.completedImageIndexes = Array.from(done).sort((left, right) => left - right);
  checkpoint.failedImageIndexes = Array.from(failed).sort((left, right) => left - right);
  checkpoint.completed = imageCount > 0 && checkpoint.completedImageIndexes.length >= imageCount;
}

function setCurrentChapter(
  checkpoint: CrawlCheckpoint, chapter: ComicMetadata['chapters'][number]
): void {
  checkpoint.currentChapterId = chapter.id;
  checkpoint.currentChapterTitle = chapter.title;
}
