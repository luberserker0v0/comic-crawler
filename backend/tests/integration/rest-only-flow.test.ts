import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../src/events/bus';
import { AdapterRegistry } from '../../src/adapter/registry';
import { ComicCrawlerServer } from '../../src/server/app';
import { JsonFileStore } from '../../src/storage/json-store';
import { ConfigManager } from '../../src/config/manager';
import { TaskManager } from '../../src/task/manager';
import { CrawlerEngine } from '../../src/crawler/engine';
import { createEmptyCheckpoint } from '../../src/task/checkpoint';
import { ComicError, ErrorType } from '../../src/error/types';
import type { IComicAdapter, ComicMetadata, ImageInfo } from '../../../shared/types';

const TEST_ROOT = join(__dirname, '__tmp__', 'rest-only-flow');

class RestOnlyAdapter implements IComicAdapter {
  readonly id = 'rest-only';
  readonly name = 'REST Only Adapter';
  readonly domains = ['rest-only.example'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: true, metadata: true, chapterImages: true };

  matchUrl(url: string): boolean {
    return url.includes('rest-only.example');
  }

  async fetchMetadata(url: string): Promise<ComicMetadata> {
    return {
      id: 'rest-only-comic',
      title: 'REST Only Comic',
      chapters: [
        { id: 'chapter-1', title: 'Chapter 1', url: `${new URL(url).origin}/chapter-1` },
      ],
    };
  }

  async fetchChapterImages(): Promise<ImageInfo[]> {
    return [
      { url: 'https://rest-only.example/images/001.jpg', index: 0 },
      { url: 'https://rest-only.example/images/002.jpg', index: 1 },
    ];
  }
}

describe('Integration: REST-only crawl flow', () => {
  let server: ComicCrawlerServer;
  let storage: JsonFileStore;
  let taskManager: TaskManager;
  let crawlerEngine: CrawlerEngine;
  let eventBus: EventBus;
  let adapterRegistry: AdapterRegistry;
  let challengeJobs: Map<string, any>;
  let verificationReady = false;

  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });

    eventBus = new EventBus();
    storage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
    await storage.initialize();
    const configManager = new ConfigManager(storage, eventBus);
    await configManager.load();

    adapterRegistry = new AdapterRegistry(eventBus);
    adapterRegistry.register(new RestOnlyAdapter());
    challengeJobs = new Map();
    verificationReady = false;

    taskManager = new TaskManager(
      async (task) => {
        eventBus.emit('task:started', { taskId: task.id });
        if (task.data.url.includes('/challenge') && !verificationReady) {
          challengeJobs.set('handoff-rest-only', {
            id: 'handoff-rest-only',
            url: task.data.url,
            normalizedUrl: task.data.url,
            hostname: new URL(task.data.url).hostname,
            status: 'challenge_required',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          throw new ComicError(
            'Human verification is required before crawling can continue. Challenge discovery job: handoff-rest-only',
            ErrorType.AUTH_ERROR,
            true,
            {
              antiBotChallenge: true,
              challengeDiscoveryId: 'handoff-rest-only',
              challengeStatus: 'challenge_required',
            }
          );
        }

        const checkpoint = createEmptyCheckpoint(task.id);
        checkpoint.resumable = true;
        checkpoint.currentChapterTitle = 'Chapter 1';
        checkpoint.totalImages = 2;
        checkpoint.completedImages = 2;
        checkpoint.failedImages = 0;
        checkpoint.metadata = { title: 'REST Only Comic' } as any;
        checkpoint.outputPath = join(TEST_ROOT, 'downloads', 'rest-only.example', 'REST Only Comic');
        await taskManager.updateCheckpoint(task.id, checkpoint);
        eventBus.emit('task:progress', {
          taskId: task.id,
          progress: {
            totalImages: 2,
            completedImages: 2,
            failedImages: 0,
            stage: 'downloading',
            stageDetail: 'downloading Chapter 1: 2/2 images',
            currentChapter: 'Chapter 1',
            metadata: checkpoint.metadata as unknown as Record<string, unknown>,
            outputPath: checkpoint.outputPath,
          },
        });
      },
      { eventBus, storage, concurrency: 1 }
    );
    await taskManager.initialize();

    crawlerEngine = new CrawlerEngine({
      downloadDir: join(TEST_ROOT, 'downloads'),
      concurrency: 1,
      eventBus,
      browser: {
        mode: 'static',
        headless: true,
        maxInstances: 1,
        timeout: 1000,
        waitUntil: 'domcontentloaded',
      },
    });

    server = new ComicCrawlerServer({
      port: 0,
      host: '127.0.0.1',
      configManager,
      taskManager,
      adapterRegistry,
      crawlerEngine,
      eventBus,
      selectorDiscoveryService: {
        create: async (input: any) => ({
          id: 'disc-rest-only',
          url: input.url,
          normalizedUrl: input.url,
          hostname: new URL(input.url).hostname,
          status: 'queued',
          target: input.target,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      } as any,
      challengeDiscoveryService: {
        probe: async () => ({ status: 'ready' }),
        create: async (input: { url: string }) => {
          const job = {
            id: 'handoff-rest-only',
            url: input.url,
            normalizedUrl: input.url,
            hostname: new URL(input.url).hostname,
            status: 'challenge_required',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          challengeJobs.set(job.id, job);
          return job;
        },
        get: async (id: string) => challengeJobs.get(id) ?? null,
        openExternalBrowser: async (id: string) => {
          const job = challengeJobs.get(id);
          if (!job) throw new Error(`Challenge discovery job "${id}" was not found.`);
          job.status = 'external_browser_open';
          job.updatedAt = new Date().toISOString();
          return job;
        },
        completeHumanVerification: async (id: string) => {
          const job = challengeJobs.get(id);
          if (!job) throw new Error(`Challenge discovery job "${id}" was not found.`);
          verificationReady = true;
          job.status = 'ready';
          job.updatedAt = new Date().toISOString();
          return job;
        },
      } as any,
    });
  });

  afterEach(async () => {
    await server.stop().catch(() => undefined);
    await storage.dispose();
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('creates and completes a chapter-only crawl through REST APIs without frontend involvement', async () => {
    const chapterUrl = 'https://rest-only.example/comic/demo/chapter-1';

    const resolveResponse = await server.getApp().inject({
      method: 'POST',
      url: '/api/adapters/resolve',
      payload: { url: chapterUrl, mode: 'chapters' },
    });
    expect(resolveResponse.statusCode).toBe(200);
    expect(resolveResponse.json().data.status).toBe('matched');

    const createResponse = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        url: chapterUrl,
        mode: 'chapters',
        chapterUrls: [chapterUrl],
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const taskId = createResponse.json().data.taskId as string;

    await waitForTaskStatus(taskManager, taskId, 'completed');

    const detailResponse = await server.getApp().inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().data.result).toMatchObject({
      status: 'completed',
      totalImages: 2,
      downloadedImages: 2,
      failedImages: 0,
    });
    expect(detailResponse.json().data.checkpoint).toMatchObject({
      currentChapter: 'Chapter 1',
      completedImages: 2,
      resumable: true,
    });
  });

  it('drives the human verification handoff and resume path through REST APIs', async () => {
    const chapterUrl = 'https://rest-only.example/comic/demo/challenge/chapter-1';

    const createResponse = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        url: chapterUrl,
        mode: 'chapters',
        chapterUrls: [chapterUrl],
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const taskId = createResponse.json().data.taskId as string;

    await waitForTaskStatus(taskManager, taskId, 'waiting_verification');

    const waitingDetail = await server.getApp().inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
    });
    expect(waitingDetail.statusCode).toBe(200);
    expect(waitingDetail.json().data.result.challengeDiscoveryId).toBe('handoff-rest-only');

    const openResponse = await server.getApp().inject({
      method: 'POST',
      url: '/api/challenge-discovery/handoff-rest-only/open-external-browser',
      payload: {},
    });
    expect(openResponse.statusCode).toBe(200);
    expect(openResponse.json().data.status).toBe('external_browser_open');

    const completeResponse = await server.getApp().inject({
      method: 'POST',
      url: '/api/challenge-discovery/handoff-rest-only/complete-human-verification',
    });
    expect(completeResponse.statusCode).toBe(202);
    expect(completeResponse.json().data.status).toBe('ready');

    const resumeResponse = await server.getApp().inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/resume`,
    });
    expect(resumeResponse.statusCode).toBe(200);

    await waitForTaskStatus(taskManager, taskId, 'completed');
    expect(taskManager.getTaskResult(taskId)).toMatchObject({
      status: 'completed',
      totalImages: 2,
      downloadedImages: 2,
      failedImages: 0,
    });
  });

  it('queues selector discovery for unsupported URLs through the task creation API', async () => {
    const response = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        url: 'https://unknown-rest.example/comic/demo/chapter-1',
        mode: 'chapters',
        chapterUrls: ['https://unknown-rest.example/comic/demo/chapter-1'],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().data).toMatchObject({
      kind: 'discoveryQueued',
      reason: 'adapter_not_found',
      discoveryId: 'disc-rest-only',
      target: 'chapter-only',
    });
  });
});

async function waitForTaskStatus(taskManager: TaskManager, taskId: string, status: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (taskManager.getTask(taskId)?.status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected task ${taskId} to reach ${status}, got ${taskManager.getTask(taskId)?.status}`);
}
