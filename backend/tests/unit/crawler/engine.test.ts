import { describe, it, expect, jest } from '@jest/globals';
import type { ComicMetadata, ImageInfo } from '@comiccrawler/shared';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterBase } from '../../../src/adapter/base';
import { CrawlerEngine } from '../../../src/crawler/engine';
import { ComicError, ErrorType } from '../../../src/error/types';

class FixtureAdapter extends AdapterBase {
  readonly id = 'fixture';
  readonly name = 'Fixture';
  readonly domains = ['example.com'];
  readonly parseMode = 'playwright' as const;

  constructor(
    private readonly handlers: {
      metadata?: (html: string, url: string) => ComicMetadata;
      images?: (html: string, url: string) => ImageInfo[];
    }
  ) {
    super();
  }

  matchUrl(url: string): boolean {
    return url.includes('example.com');
  }

  async loadDocument(url: string): Promise<unknown> {
    return this.fetchHtml(url);
  }

  extractTitle(document: unknown, url: string): string {
    return this.getMetadata(document, url).title;
  }

  extractAuthor(document: unknown, url: string): string | undefined {
    return this.getMetadata(document, url).author;
  }

  extractDescription(document: unknown, url: string): string | undefined {
    return this.getMetadata(document, url).description;
  }

  extractCoverUrl(document: unknown, url: string): string | undefined {
    return this.getMetadata(document, url).coverUrl;
  }

  extractTags(document: unknown, url: string): string[] {
    return this.getMetadata(document, url).tags ?? [];
  }

  extractStatus(document: unknown, url: string): ComicMetadata['status'] {
    return this.getMetadata(document, url).status;
  }

  extractChapterList(document: unknown, url: string): ComicMetadata['chapters'] {
    return this.getMetadata(document, url).chapters;
  }

  extractChapterImageUrls(document: unknown, chapterUrl: string): string[] {
    if (!this.handlers.images) {
      throw new ComicError('images handler missing', ErrorType.PARSING_ERROR);
    }
    return this.handlers.images(String(document), chapterUrl).map((image) => image.url);
  }

  private getMetadata(document: unknown, url: string): ComicMetadata {
    if (!this.handlers.metadata) {
      throw new ComicError('metadata handler missing', ErrorType.PARSING_ERROR);
    }
    return this.handlers.metadata(String(document), url);
  }
}

class VerificationFixtureAdapter extends FixtureAdapter {
  readonly capabilities = {
    verification: true,
    metadata: false,
    chapterImages: true,
  };
  readonly verification = {
    detectVerificationRequired: (input: string) => input.includes('site-specific-verification'),
  };
}

describe('CrawlerEngine progress tracking', () => {
  CrawlerEngineProgressTrackingTestGroup1();
});

function createSingleChapterMetadata(): ComicMetadata {
  return {
    id: 'demo',
    title: 'Demo',
    status: 'ongoing',
    chapters: [{ id: 'chapter-1', title: 'Chapter 1', url: 'https://example.com/manga/demo/chapter-1' }],
  };
}

async function stubDownloader(engine: CrawlerEngine): Promise<void> {
  await (engine as any).imageDownloader.dispose();
  (engine as any).imageDownloader = {
    downloadBatch: jest.fn(async (batch: ImageInfo[]) => batch.map((image) => ({ path: image.url, size: 1, url: image.url }))),
    dispose: jest.fn(),
  };
}

function CrawlerEngineProgressTrackingTestGroup1(): void {
  it('should emit metadata, chapter list, stage, and websocket preview payloads', CrawlerEngineProgressTrackingTestShouldEmitMetadataChapterListStageAndWebsocketPreviewPayloads);
  it('should determine total images before reporting download progress', CrawlerEngineProgressTrackingTestShouldDetermineTotalImagesBeforeReportingDownloadProgress);
  it('should download explicit chapter URLs without fetching manga metadata', CrawlerEngineProgressTrackingTestShouldDownloadExplicitChapterURLsWithoutFetchingMangaMetadata);
  it('should keep checkpoint resumable when crawl completes with failed image downloads', CrawlerEngineProgressTrackingTestShouldKeepCheckpointResumableWhenCrawlCompletesWithFailedImageDownloads);
  it('should always use Playwright-rendered HTML', CrawlerEngineProgressTrackingTestShouldAlwaysUsePlaywrightRenderedHTML);
  it('should honor adapter-specific verification detection in the crawl path', CrawlerEngineProgressTrackingTestShouldHonorAdapterSpecificVerificationDetectionInTheCrawlPath);
}

async function CrawlerEngineProgressTrackingTestShouldEmitMetadataChapterListStageAndWebsocketPreviewPayloads() {
    const eventBus = { emit: jest.fn() };
    const downloadDir = await fs.mkdtemp(join(tmpdir(), 'comiccrawler-engine-'));
    const engine = new CrawlerEngine({ downloadDir, concurrency: 2, eventBus: eventBus as any });
    const metadata = createSingleChapterMetadata();
    const images: ImageInfo[] = [{ url: 'https://img.example.com/1.jpg', index: 1 }];
    const adapter = new FixtureAdapter({ metadata: () => metadata, images: () => images });
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<html></html>');
    await installPreviewDownloader(engine);
    await engine.crawl(adapter, 'https://example.com/manga/demo', { taskId: 'task-live' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectLiveEvents(eventBus.emit, images[0]!.url);
    await Promise.all([adapter.dispose(), engine.dispose()]);
    await fs.rm(downloadDir, { recursive: true, force: true });
}

async function installPreviewDownloader(engine: CrawlerEngine): Promise<void> {
  await (engine as any).imageDownloader.dispose();
  (engine as any).imageDownloader = { downloadBatch: jest.fn(async (batch: ImageInfo[], options: any) => {
    await fs.mkdir(options.outputDir, { recursive: true });
    const filePath = join(options.outputDir, '001.jpg');
    await fs.writeFile(filePath, 'image');
    options.onProgress?.(1, batch.length, { path: filePath }, batch[0]!);
    return [{ path: filePath, size: 5, url: batch[0]!.url }];
  }), dispose: jest.fn() };
}

function expectLiveEvents(emit: jest.Mock, imageUrl: string): void {
    const metadataEvent = emit.mock.calls.find(([eventName]) => eventName === 'task:metadata_extracted');
    const chapterListEvent = emit.mock.calls.find(([eventName]) => eventName === 'task:chapter_list_extracted');
    const previewEvent = emit.mock.calls.find(([eventName]) => eventName === 'image:downloaded');
    const stageProgress = emit.mock.calls.filter(([name]) => name === 'task:progress')
      .map(([, payload]) => payload as { progress: { stage?: string } });
    expect(metadataEvent?.[1]).toMatchObject({
        taskId: 'task-live',
        metadata: expect.objectContaining({ title: 'Demo' }),
    });
    expect(chapterListEvent?.[1]).toMatchObject({
        taskId: 'task-live',
        chapterListSummary: expect.objectContaining({ totalChapters: 1 }),
    });
    expect(stageProgress.map((payload) => payload.progress.stage))
      .toEqual(expect.arrayContaining(['metadata', 'downloading']));
    expectPreviewEvent(previewEvent?.[1], imageUrl);
}

function expectPreviewEvent(payload: unknown, imageUrl: string): void {
  expect(payload).toMatchObject({ taskId: 'task-live', imageUrl,
    previewFile: expect.objectContaining({ relativePath: expect.stringContaining('001.jpg'),
      isImage: true, url: expect.stringContaining('/api/tasks/task-live/preview-file') }) });
}

async function CrawlerEngineProgressTrackingTestShouldDetermineTotalImagesBeforeReportingDownloadProgress() {
    const eventBus = { emit: jest.fn() };
    const engine = new CrawlerEngine({
        downloadDir: 'D:/downloads',
        concurrency: 2,
        eventBus: eventBus as any,
    });
    const metadata = twoChapterMetadata();
    const chapterImages = twoChapterImages();
    const adapter = new FixtureAdapter({
        metadata: jest.fn(() => metadata),
        images: jest.fn((_html: string, chapterUrl: string) => chapterImages.get(chapterUrl) ?? []),
    });
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<html></html>');
    await installProgressDownloader(engine);
    const result = await engine.crawl(adapter, 'https://example.com/comic/1', { taskId: 'task-1' });
    expectTotalProgress(eventBus.emit, result.totalImages);
    await adapter.dispose();
    await engine.dispose();
}

function twoChapterMetadata(): ComicMetadata {
  return { id: 'comic-1', title: 'Demo Comic', author: 'Tester', status: 'ongoing', chapters: [
    { id: 'ch-1', title: 'Chapter 1', url: 'https://example.com/ch-1' },
    { id: 'ch-2', title: 'Chapter 2', url: 'https://example.com/ch-2' },
  ] };
}

function twoChapterImages(): Map<string, ImageInfo[]> {
  return new Map([
    ['https://example.com/ch-1', [{ url: 'https://img.example.com/1.jpg', index: 1 },
      { url: 'https://img.example.com/2.jpg', index: 2 }]],
    ['https://example.com/ch-2', [{ url: 'https://img.example.com/3.jpg', index: 1 }]],
  ]);
}

async function installProgressDownloader(engine: CrawlerEngine): Promise<void> {
  await (engine as any).imageDownloader.dispose();
  (engine as any).imageDownloader = { downloadBatch: jest.fn(async (images: ImageInfo[], options: any) =>
    images.map((image, index) => {
      options.onProgress?.(index + 1, images.length);
      return { path: `D:/downloads/${index + 1}.jpg`, size: 128, url: image.url };
    })), dispose: jest.fn() };
}

function expectTotalProgress(emit: jest.Mock, totalImages: number): void {
  const payloads = emit.mock.calls.filter(([name]) => name === 'task:progress').map(([, value]) => value as any);
  const first = payloads.find(({ progress }) => progress.currentChapter === 'Chapter 1' && progress.completedImages === 1);
  expect(totalImages).toBe(3);
  expect(first?.progress.totalImages).toBe(3);
  expect(payloads.some(({ progress }) => progress.totalImages === 3 && progress.completedImages === 0)).toBe(true);
}

async function CrawlerEngineProgressTrackingTestShouldDownloadExplicitChapterURLsWithoutFetchingMangaMetadata() {
    const eventBus = { emit: jest.fn() };
    const engine = new CrawlerEngine({
        downloadDir: 'D:/downloads',
        concurrency: 2,
        eventBus: eventBus as any,
    });
    const chapterUrl = 'https://kuronavi.one/manga/demo/chapter-51.2';
    const adapter = directChapterAdapter(chapterUrl);
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<html></html>');
    await stubDownloader(engine);
    const result = await engine.crawl(adapter, chapterUrl, {
        taskId: 'task-direct',
        chapterUrls: [chapterUrl],
    });
    expectDirectChapterResult(adapter, result, chapterUrl);
    await adapter.dispose();
    await engine.dispose();
}

function directChapterAdapter(chapterUrl: string): FixtureAdapter {
  const images: ImageInfo[] = [{ url: 'https://img.example.com/1.jpg', index: 1 },
    { url: 'https://img.example.com/2.jpg', index: 2 }];
  return new FixtureAdapter({ metadata: jest.fn(() => {
    throw new ComicError('metadata should not be fetched for direct chapters', ErrorType.PARSING_ERROR);
  }), images: jest.fn((_html, url) => url === chapterUrl ? images : []) });
}

function expectDirectChapterResult(adapter: FixtureAdapter, result: any, chapterUrl: string): void {
  expect((adapter as any).handlers.metadata).not.toHaveBeenCalled();
  expect((adapter as any).handlers.images).toHaveBeenCalledWith('<html></html>', chapterUrl);
  expect(result.metadata.title).toBe('demo');
  expect(result.metadata.chapters).toEqual([
    { id: 'chapter-51.2', title: 'chapter-51.2', url: chapterUrl },
  ]);
  expect(result.totalImages).toBe(2);
}

async function CrawlerEngineProgressTrackingTestShouldKeepCheckpointResumableWhenCrawlCompletesWithFailedImageDownloads() {
    const engine = new CrawlerEngine({
        downloadDir: 'D:/downloads',
        concurrency: 2,
    });
    const adapter = partialDownloadAdapter();
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<html></html>');
    await installPartialDownloader(engine);
    const checkpoint = { latest: undefined as any };
    const result = await engine.crawl(adapter, 'https://example.com/manga/demo', {
        taskId: 'task-partial',
        onCheckpoint: (value) => { checkpoint.latest = structuredClone(value); },
    });
    expect(result.downloadedImages).toBe(1);
    expect(result.failedImages).toBe(1);
    expect(checkpoint.latest.resumable).toBe(true);
    expect(checkpoint.latest.chapters['chapter-1'].failedImageIndexes).toEqual([1]);
    await adapter.dispose();
    await engine.dispose();
}

function partialDownloadAdapter(): FixtureAdapter {
  const images: ImageInfo[] = [{ url: 'https://img.example.com/1.jpg', index: 0 },
    { url: 'https://img.example.com/2.jpg', index: 1 }];
  return new FixtureAdapter({ metadata: createSingleChapterMetadata, images: () => images });
}

async function installPartialDownloader(engine: CrawlerEngine): Promise<void> {
  await (engine as any).imageDownloader.dispose();
  (engine as any).imageDownloader = { downloadBatch: jest.fn(async (batch: ImageInfo[], options: any) => {
    options.onProgress?.(1, batch.length, { path: 'D:/downloads/001.jpg' }, batch[0]!);
    options.onProgress?.(2, batch.length, null, batch[1]!);
    return [{ path: 'D:/downloads/001.jpg', size: 128, url: batch[0]!.url }];
  }), dispose: jest.fn() };
}

async function CrawlerEngineProgressTrackingTestShouldAlwaysUsePlaywrightRenderedHTML() {
    const engine = new CrawlerEngine({ downloadDir: 'D:/downloads', browser: {
        timeout: 30000, workerWaitTimeoutMs: 30 * 60 * 1000, postLoadDelayMs: 0 } });
    const render = jest.fn(async (url: string) => `<html>rendered ${url}</html>`);
    (engine as any).htmlRenderer = { render, dispose: jest.fn() };
    const adapter = new FixtureAdapter({
        metadata: (html) => {
            expect(html).toContain('rendered');
            return createSingleChapterMetadata();
        },
        images: (html) => {
            expect(html).toContain('rendered');
            return [{ url: 'https://img.example.com/1.jpg', index: 0 }];
        },
    });
    await stubDownloader(engine);
    await engine.crawl(adapter, 'https://example.com/manga/demo');
    expect(render).toHaveBeenCalled();
    await Promise.all([adapter.dispose(), engine.dispose()]);
}

async function CrawlerEngineProgressTrackingTestShouldHonorAdapterSpecificVerificationDetectionInTheCrawlPath() {
    const engine = new CrawlerEngine({ downloadDir: 'D:/downloads' });
    (engine as any).htmlRenderer = {
        render: jest.fn(async () => '<html>site-specific-verification</html>'),
        dispose: jest.fn(),
    };
    const chapterUrl = 'https://example.com/title/demo/1-chapter-1';
    const adapter = new VerificationFixtureAdapter({
        images: () => [{ url: 'https://img.example.com/1.jpg', index: 0 }],
    });
    await expect(engine.crawl(adapter, chapterUrl, { chapterUrls: [chapterUrl] })).rejects.toMatchObject({
        type: ErrorType.AUTH_ERROR, context: { adapterId: 'fixture', url: chapterUrl,
          antiBotChallenge: true, challengeType: 'adapter_verification_required' } });
    await adapter.dispose();
    await engine.dispose();
}
