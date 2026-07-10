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
  readonly parseMode: 'static' | 'dynamic' | 'interactive';

  constructor(
    private readonly handlers: {
      metadata?: (html: string, url: string) => ComicMetadata;
      images?: (html: string, url: string) => ImageInfo[];
    },
    parseMode: 'static' | 'dynamic' | 'interactive' = 'static'
  ) {
    super();
    this.parseMode = parseMode;
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

describe('CrawlerEngine progress tracking', () => {
  it('should emit metadata, chapter list, stage, and websocket preview payloads', async () => {
    const eventBus = { emit: jest.fn() };
    const downloadDir = await fs.mkdtemp(join(tmpdir(), 'comiccrawler-engine-'));
    const engine = new CrawlerEngine({
      downloadDir,
      concurrency: 2,
      eventBus: eventBus as any,
    });
    const metadata = createSingleChapterMetadata();
    const images: ImageInfo[] = [{ url: 'https://img.example.com/1.jpg', index: 1 }];
    const adapter = new FixtureAdapter({
      metadata: () => metadata,
      images: () => images,
    });
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<html></html>');

    await (engine as any).imageDownloader.dispose();
    (engine as any).imageDownloader = {
      downloadBatch: jest.fn(async (batch: ImageInfo[], options: { outputDir: string; onProgress?: (completed: number, total: number, result: { path: string }, image: ImageInfo) => void }) => {
        await fs.mkdir(options.outputDir, { recursive: true });
        const filePath = join(options.outputDir, '001.jpg');
        await fs.writeFile(filePath, 'image');
        options.onProgress?.(1, batch.length, { path: filePath }, batch[0]!);
        return [{ path: filePath, size: 5, url: batch[0]!.url }];
      }),
      dispose: jest.fn(),
    };

    await engine.crawl(adapter, 'https://example.com/manga/demo', { taskId: 'task-live' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const metadataEvent = eventBus.emit.mock.calls.find(([eventName]) => eventName === 'task:metadata_extracted');
    const chapterListEvent = eventBus.emit.mock.calls.find(([eventName]) => eventName === 'task:chapter_list_extracted');
    const previewEvent = eventBus.emit.mock.calls.find(([eventName]) => eventName === 'image:downloaded');
    const stageProgress = eventBus.emit.mock.calls
      .filter(([eventName]) => eventName === 'task:progress')
      .map(([, payload]) => payload as { progress: { stage?: string; stageDetail?: string } });

    expect(metadataEvent?.[1]).toMatchObject({
      taskId: 'task-live',
      metadata: expect.objectContaining({ title: 'Demo' }),
    });
    expect(chapterListEvent?.[1]).toMatchObject({
      taskId: 'task-live',
      chapterListSummary: expect.objectContaining({ totalChapters: 1 }),
    });
    expect(stageProgress.some((payload) => payload.progress.stage === 'metadata')).toBe(true);
    expect(stageProgress.some((payload) => payload.progress.stage === 'downloading')).toBe(true);
    expect(previewEvent?.[1]).toMatchObject({
      taskId: 'task-live',
      imageUrl: images[0]!.url,
      previewFile: expect.objectContaining({
        relativePath: expect.stringContaining('001.jpg'),
        isImage: true,
        url: expect.stringContaining('/api/tasks/task-live/preview-file'),
      }),
    });
    await adapter.dispose();
    await engine.dispose();
    await fs.rm(downloadDir, { recursive: true, force: true });
  });

  it('should determine total images before reporting download progress', async () => {
    const eventBus = { emit: jest.fn() };
    const engine = new CrawlerEngine({
      downloadDir: 'D:/downloads',
      concurrency: 2,
      eventBus: eventBus as any,
    });

    const metadata: ComicMetadata = {
      id: 'comic-1',
      title: 'Demo Comic',
      author: 'Tester',
      coverUrl: '',
      description: '',
      tags: [],
      status: 'ongoing',
      chapters: [
        { id: 'ch-1', title: 'Chapter 1', url: 'https://example.com/ch-1' },
        { id: 'ch-2', title: 'Chapter 2', url: 'https://example.com/ch-2' },
      ],
    };

    const chapterImages = new Map<string, ImageInfo[]>([
      ['https://example.com/ch-1', [
        { url: 'https://img.example.com/1.jpg', index: 1 },
        { url: 'https://img.example.com/2.jpg', index: 2 },
      ]],
      ['https://example.com/ch-2', [
        { url: 'https://img.example.com/3.jpg', index: 1 },
      ]],
    ]);

    const adapter = new FixtureAdapter({
      metadata: jest.fn(() => metadata),
      images: jest.fn((_html: string, chapterUrl: string) => chapterImages.get(chapterUrl) ?? []),
    });
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<html></html>');

    await (engine as any).imageDownloader.dispose();
    (engine as any).imageDownloader = {
      downloadBatch: jest.fn(async (images: ImageInfo[], options: { onProgress?: (completed: number, total: number) => void }) => {
        const results = [];

        for (let index = 0; index < images.length; index += 1) {
          options.onProgress?.(index + 1, images.length);
          results.push({
            path: `D:/downloads/${index + 1}.jpg`,
            size: 128,
            url: images[index]!.url,
          });
        }

        return results;
      }),
      dispose: jest.fn(),
    };

    const result = await engine.crawl(adapter, 'https://example.com/comic/1', { taskId: 'task-1' });
    const progressPayloads = eventBus.emit.mock.calls
      .filter(([eventName]) => eventName === 'task:progress')
      .map(([, payload]) => payload as { progress: { totalImages: number; completedImages: number; failedImages: number; currentChapter?: string } });

    const firstDownloadProgress = progressPayloads.find((payload) => (
      payload.progress.currentChapter === 'Chapter 1' &&
      payload.progress.completedImages === 1
    ));

    expect(result.totalImages).toBe(3);
    expect(firstDownloadProgress).toBeDefined();
    expect(firstDownloadProgress?.progress.totalImages).toBe(3);
    expect(progressPayloads.some((payload) => payload.progress.totalImages === 3 && payload.progress.completedImages === 0)).toBe(true);
    await adapter.dispose();
    await engine.dispose();
  });

  it('should download explicit chapter URLs without fetching manga metadata', async () => {
    const eventBus = { emit: jest.fn() };
    const engine = new CrawlerEngine({
      downloadDir: 'D:/downloads',
      concurrency: 2,
      eventBus: eventBus as any,
    });
    const chapterUrl = 'https://kuronavi.one/manga/demo/chapter-51.2';
    const images: ImageInfo[] = [
      { url: 'https://img.example.com/1.jpg', index: 1 },
      { url: 'https://img.example.com/2.jpg', index: 2 },
    ];
    const adapter = new FixtureAdapter({
      metadata: jest.fn((_html: string, _url: string) => {
        throw new ComicError('metadata should not be fetched for direct chapters', ErrorType.PARSING_ERROR);
      }),
      images: jest.fn((_html, requestedUrl) => requestedUrl === chapterUrl ? images : []),
    });
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<html></html>');

    await (engine as any).imageDownloader.dispose();
    (engine as any).imageDownloader = {
      downloadBatch: jest.fn(async (batch: ImageInfo[], options: { onProgress?: (completed: number, total: number) => void }) => {
        batch.forEach((_, index) => options.onProgress?.(index + 1, batch.length));
        return batch.map((image) => ({ path: image.url, size: 128, url: image.url }));
      }),
      dispose: jest.fn(),
    };

    const result = await engine.crawl(adapter, chapterUrl, {
      taskId: 'task-direct',
      chapterUrls: [chapterUrl],
    });

    expect((adapter as any).handlers.metadata).not.toHaveBeenCalled();
    expect((adapter as any).handlers.images).toHaveBeenCalledWith('<html></html>', chapterUrl);
    expect(result.metadata.title).toBe('demo');
    expect(result.metadata.chapters).toEqual([{ id: 'chapter-51.2', title: 'chapter-51.2', url: chapterUrl }]);
    expect(result.totalImages).toBe(2);
    await adapter.dispose();
    await engine.dispose();
  });

  it('should not use Playwright renderer in static mode', async () => {
    const engine = new CrawlerEngine({
      downloadDir: 'D:/downloads',
      browser: {
        mode: 'static',
        headless: true,
        maxInstances: 1,
        timeout: 30000,
        waitUntil: 'domcontentloaded',
      },
    });
    const metadata = createSingleChapterMetadata();
    const adapter = new FixtureAdapter({
      metadata: () => metadata,
      images: () => [{ url: 'https://img.example.com/1.jpg', index: 0 }],
    });
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<html>static</html>');
    (engine as any).htmlRenderer = { render: jest.fn(), dispose: jest.fn() };
    await stubDownloader(engine);

    await engine.crawl(adapter, 'https://example.com/manga/demo');

    expect((engine as any).htmlRenderer.render).not.toHaveBeenCalled();
    await adapter.dispose();
    await engine.dispose();
  });

  it('should use Playwright-rendered HTML in headless mode', async () => {
    const engine = new CrawlerEngine({
      downloadDir: 'D:/downloads',
      browser: {
        mode: 'headless',
        headless: true,
        maxInstances: 1,
        timeout: 30000,
        waitUntil: 'domcontentloaded',
      },
    });
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
    await adapter.dispose();
    await engine.dispose();
  });

  it('should not fallback in auto mode when static extraction succeeds', async () => {
    const engine = new CrawlerEngine({
      downloadDir: 'D:/downloads',
      browser: {
        mode: 'auto',
        headless: true,
        maxInstances: 1,
        timeout: 30000,
        waitUntil: 'domcontentloaded',
      },
    });
    const render = jest.fn(async () => '<html>rendered</html>');
    (engine as any).htmlRenderer = { render, dispose: jest.fn() };
    const adapter = new FixtureAdapter({
      metadata: () => createSingleChapterMetadata(),
      images: () => [{ url: 'https://img.example.com/1.jpg', index: 0 }],
    });
    jest.spyOn(adapter as any, 'fetchStaticHtml').mockResolvedValue('<html>static</html>');
    await stubDownloader(engine);

    await engine.crawl(adapter, 'https://example.com/manga/demo');

    expect(render).not.toHaveBeenCalled();
    await adapter.dispose();
    await engine.dispose();
  });

  it('should fallback to headless in auto mode when static extraction fails with parsing error', async () => {
    const engine = new CrawlerEngine({
      downloadDir: 'D:/downloads',
      browser: {
        mode: 'auto',
        headless: true,
        maxInstances: 1,
        timeout: 30000,
        waitUntil: 'domcontentloaded',
      },
    });
    const render = jest.fn(async () => '<html>rendered</html>');
    (engine as any).htmlRenderer = { render, dispose: jest.fn() };
    const adapter = new FixtureAdapter({
      metadata: (html) => {
        if (!html.includes('rendered')) {
          throw new ComicError('No chapters found', ErrorType.PARSING_ERROR);
        }
        return createSingleChapterMetadata();
      },
      images: () => [{ url: 'https://img.example.com/1.jpg', index: 0 }],
    });
    jest.spyOn(adapter as any, 'fetchStaticHtml').mockResolvedValue('<html>static</html>');
    await stubDownloader(engine);

    await engine.crawl(adapter, 'https://example.com/manga/demo');

    expect(render).toHaveBeenCalled();
    await adapter.dispose();
    await engine.dispose();
  });

  it('should fallback to headless in auto mode when static fetch is blocked with HTTP 403', async () => {
    const engine = new CrawlerEngine({
      downloadDir: 'D:/downloads',
      browser: {
        mode: 'auto',
        headless: true,
        maxInstances: 1,
        timeout: 30000,
        waitUntil: 'domcontentloaded',
      },
    });
    const render = jest.fn(async () => '<html>rendered</html>');
    (engine as any).htmlRenderer = { render, dispose: jest.fn() };
    const adapter = new FixtureAdapter({
      metadata: (html) => {
        expect(html).toContain('rendered');
        return createSingleChapterMetadata();
      },
      images: () => [{ url: 'https://img.example.com/1.jpg', index: 0 }],
    });
    jest.spyOn(adapter as any, 'fetchStaticHtml').mockImplementation(async (urlValue: unknown) => {
      const url = String(urlValue);
      if (url === 'https://example.com/manga/demo') {
        throw new ComicError('HTTP 403 for https://example.com/manga/demo', ErrorType.NETWORK_ERROR, true, {
          statusCode: 403,
          url,
        });
      }
      return '<html>static chapter</html>';
    });
    await stubDownloader(engine);

    await engine.crawl(adapter, 'https://example.com/manga/demo');

    expect(render).toHaveBeenCalledWith('https://example.com/manga/demo');
    await adapter.dispose();
    await engine.dispose();
  });

  it('should include static and headless errors when fallback also fails', async () => {
    const engine = new CrawlerEngine({
      downloadDir: 'D:/downloads',
      browser: {
        mode: 'auto',
        headless: true,
        maxInstances: 1,
        timeout: 30000,
        waitUntil: 'domcontentloaded',
      },
    });
    (engine as any).htmlRenderer = { render: jest.fn(async () => '<html>rendered</html>'), dispose: jest.fn() };
    const adapter = new FixtureAdapter({
      metadata: () => {
        throw new ComicError('No chapters found', ErrorType.PARSING_ERROR);
      },
    });
    jest.spyOn(adapter as any, 'fetchStaticHtml').mockResolvedValue('<html>static</html>');

    await expect(engine.crawl(adapter, 'https://example.com/manga/demo')).rejects.toMatchObject({
      type: ErrorType.PARSING_ERROR,
      context: expect.objectContaining({
        staticError: expect.any(Object),
        headlessError: expect.any(Object),
      }),
    });
    await adapter.dispose();
    await engine.dispose();
  });
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
