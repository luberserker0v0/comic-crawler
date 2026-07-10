import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../src/events/bus';
import { JsonFileStore } from '../../src/storage/json-store';
import { AdapterRegistry } from '../../src/adapter/registry';
import { UrlResolver } from '../../src/adapter/url-resolver';
import { HtmlParser } from '../../src/crawler/html-parser';
import { ChapterFetcher } from '../../src/crawler/chapter-fetcher';
import { ImageDownloader } from '../../src/crawler/image-downloader';
import { DedupChecker } from '../../src/image/dedup';
import { TaskQueue } from '../../src/task/queue';
import { ProgressTracker } from '../../src/task/progress';
import { AdapterBase } from '../../src/adapter/base';
import type { ComicMetadata } from '../../../shared/types';

const TEST_DIR = join(__dirname, '__tmp__');

class MockAdapter extends AdapterBase {
  readonly id = 'mock';
  readonly name = 'Mock Adapter';
  readonly domains = ['mock.example.com'];
  readonly parseMode = 'static' as const;

  matchUrl(url: string): boolean {
    return url.includes('mock.example.com');
  }

  async loadDocument(url: string): Promise<unknown> {
    return url;
  }

  extractTitle(): string {
    return 'Mock Comic';
  }

  extractAuthor(): string {
    return 'Mock Author';
  }

  extractChapterList(): ComicMetadata['chapters'] {
    return [
      { id: 'ch-1', title: 'Chapter 1', url: 'https://mock.example.com/chapter/1' },
      { id: 'ch-2', title: 'Chapter 2', url: 'https://mock.example.com/chapter/2' },
    ];
  }

  extractChapterImageUrls(): string[] {
    return [
      'https://mock.example.com/img/1.jpg',
      'https://mock.example.com/img/2.jpg',
    ];
  }
}

describe('Integration: Download Flow', () => {
  let eventBus: EventBus;
  let storage: JsonFileStore;
  let registry: AdapterRegistry;
  let urlResolver: UrlResolver;
  let parser: HtmlParser;
  let dedup: DedupChecker;
  let progress: ProgressTracker;
  let taskQueue: TaskQueue<{ url: string }>;

  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });

    eventBus = new EventBus();
    storage = new JsonFileStore({ basePath: TEST_DIR, flushInterval: 50 });
    await storage.initialize();

    registry = new AdapterRegistry(eventBus);
    urlResolver = new UrlResolver();
    parser = new HtmlParser();
    dedup = new DedupChecker();
    progress = new ProgressTracker(eventBus);
    taskQueue = new TaskQueue<{ url: string }>(
      async () => {},
      { concurrency: 2, autoStart: true }
    );

    registry.register(new MockAdapter());
  });

  afterEach(async () => {
    await storage.dispose();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should register adapter and find by URL', () => {
    const adapter = registry.findByUrl('https://mock.example.com/comic/1');
    expect(adapter).toBeDefined();
    expect(adapter?.id).toBe('mock');
  });
});
