import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../../src/events/bus';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { ComicCrawlerServer } from '../../../src/server/app';
import { JsonFileStore } from '../../../src/storage/json-store';
import { ConfigManager } from '../../../src/config/manager';
import { TaskManager } from '../../../src/task/manager';
import { createEmptyCheckpoint } from '../../../src/task/checkpoint';
import { CrawlerEngine } from '../../../src/crawler/engine';
import { DynamicSiteAdapter } from '../../../src/adapter/dynamic-site-adapter';

const TEST_ROOT = join(__dirname, '__tmp__', 'task-routes');

describe('Task routes persistence', () => {
  let server: ComicCrawlerServer;
  let storage: JsonFileStore;
  let taskManager: TaskManager;
  let crawlerEngine: CrawlerEngine;
  let adapterRegistry: AdapterRegistry;
  let challengeJobs: Map<string, any>;

  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });

    const eventBus = new EventBus();
    storage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
    await storage.initialize();
    const configManager = new ConfigManager(storage, eventBus);
    await configManager.load();
    adapterRegistry = new AdapterRegistry(eventBus);
    adapterRegistry.register({
      id: 'kuronavi',
      name: 'Kuronavi',
      domains: ['kuronavi.one'],
      parseMode: 'static',
      capabilities: { verification: false, metadata: true, chapterImages: true },
      matchUrl: (url: string) => url.includes('kuronavi.one'),
      loadDocument: async () => ({}),
      extractTitle: async () => 'Demo',
      extractChapterList: async () => [],
      extractChapterImageUrls: async () => [],
    } as any);
    taskManager = new TaskManager(async () => {}, { eventBus, storage });
    await taskManager.initialize();
    challengeJobs = new Map();
    crawlerEngine = new CrawlerEngine({
      downloadDir: join(TEST_ROOT, 'downloads'),
      concurrency: 1,
      eventBus,
    });

    await taskManager.createTask({
      id: 'task-1',
      url: 'https://example.com/comic/1',
      adapterId: 'kuronavi',
    });
    eventBus.emit('task:started', { taskId: 'task-1' });
    eventBus.emit('task:completed', {
      taskId: 'task-1',
      result: {
        downloadedImages: 5,
        failedImages: 0,
        totalImages: 5,
        outputPath: './downloads',
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
        create: async (input: { url: string; target?: 'full' | 'chapter-only' }) => {
          const id = `disc-${Date.now()}`;
          const domainAdapter = adapterRegistry.findByUrl(input.url) ?? adapterRegistry.findByUrlDomain(input.url);
          const capabilities = domainAdapter?.capabilities;
          const promotionMode = input.target === 'full' && domainAdapter && capabilities?.chapterImages && !capabilities.metadata
            ? 'augment'
            : 'create';
          const job = {
            id,
            url: input.url,
            normalizedUrl: input.url,
            hostname: new URL(input.url).hostname,
            status: 'queued',
            target: input.target,
            promotionMode,
            baseAdapterId: promotionMode === 'augment' ? domainAdapter?.id : undefined,
            createdAt: '2026-06-25T00:00:00.000Z',
            updatedAt: '2026-06-25T00:00:00.000Z',
          };
          await storage.write(`selector-discovery-job-${id}`, job);
          return job;
        },
      } as any,
      challengeDiscoveryService: {
        probe: async () => ({ status: 'ready' }),
        create: async (input: { url: string }) => {
          const id = `chal-${Date.now()}`;
          const job = {
            id,
            url: input.url,
            normalizedUrl: input.url,
            hostname: new URL(input.url).hostname,
            status: 'challenge_required',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          challengeJobs.set(id, job);
          return job;
        },
        get: async (id: string) => challengeJobs.get(id) ?? null,
        completeHumanVerification: async (id: string) => {
          const job = challengeJobs.get(id);
          if (!job) throw new Error(`Challenge discovery job "${id}" was not found.`);
          return job;
        },
      } as any,
    });
  });

  afterEach(async () => {
    await server.stop().catch(() => undefined);
    await storage.dispose();
  });

  it('should return persisted tasks from /api/tasks', async () => {
    const response = await server.getApp().inject({
      method: 'GET',
      url: '/api/tasks',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { data: { tasks: Array<{ id: string; status: string }> } };
    expect(payload.data.tasks).toHaveLength(1);
    expect(payload.data.tasks[0]?.status).toBe('completed');
  });

  it('should return persisted result and progress from /api/tasks/:id', async () => {
    const response = await server.getApp().inject({
      method: 'GET',
      url: '/api/tasks/task-1',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { data: { result: { outputPath: string; status: string } } };
    expect(payload.data.result.status).toBe('completed');
    expect(payload.data.result.outputPath).toBe('./downloads');
  });

  it('should return checkpoint summary from /api/tasks/:id', async () => {
    const checkpoint = createEmptyCheckpoint('task-1');
    checkpoint.resumable = true;
    checkpoint.currentChapterTitle = 'Chapter 7';
    checkpoint.completedImages = 3;
    checkpoint.failedImages = 1;
    await taskManager.updateCheckpoint('task-1', checkpoint);

    const response = await server.getApp().inject({
      method: 'GET',
      url: '/api/tasks/task-1',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { data: { checkpoint: { currentChapter: string; completedImages: number; failedImages: number; resumable: boolean } } };
    expect(payload.data.checkpoint).toMatchObject({
      currentChapter: 'Chapter 7',
      completedImages: 3,
      failedImages: 1,
      resumable: true,
    });
  });

  it('should delete terminal tasks through /api/tasks/:id', async () => {
    const response = await server.getApp().inject({
      method: 'DELETE',
      url: '/api/tasks/task-1',
    });

    expect(response.statusCode).toBe(200);
    expect(taskManager.getTask('task-1')).toBeUndefined();
  });

  it('should delete waiting verification tasks through /api/tasks/:id', async () => {
    await taskManager.createTask({
      id: 'task-waiting',
      url: 'https://kuronavi.one/manga/demo/chapter-1',
      adapterId: 'kuronavi',
      mode: 'chapters',
      chapterUrls: ['https://kuronavi.one/manga/demo/chapter-1'],
    });
    await flushAsyncWork();
    setTaskWaitingVerification(taskManager, 'task-waiting', 'chal-waiting');

    const response = await server.getApp().inject({
      method: 'DELETE',
      url: '/api/tasks/task-waiting',
    });

    expect(response.statusCode).toBe(200);
    expect(taskManager.getTask('task-waiting')).toBeUndefined();
  });

  it('should reject deleting active tasks through /api/tasks/:id', async () => {
    await taskManager.createTask({
      id: 'task-2',
      url: 'https://example.com/comic/2',
      adapterId: 'kuronavi',
    });
    const activeTask = taskManager.getTask('task-2');
    if (activeTask) {
      activeTask.status = 'running';
      activeTask.startedAt = new Date();
      activeTask.completedAt = undefined;
    }

    const response = await server.getApp().inject({
      method: 'DELETE',
      url: '/api/tasks/task-2',
    });

    expect(response.statusCode).toBe(400);
  });

  it('should create an all-chapters task from a manga URL', async () => {
    const response = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        mode: 'all',
        url: 'https://kuronavi.one/manga/an-haxing-jian-guo-jia-noe-de-ling-zhu/',
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = response.json() as { data: { taskId: string } };
    const task = taskManager.getTask(payload.data.taskId);
    expect(task?.data.mode).toBe('all');
    expect(task?.data.url).toBe('https://kuronavi.one/manga/an-haxing-jian-guo-jia-noe-de-ling-zhu/');
    expect(task?.data.chapterUrls).toEqual([]);
  });

  it('should create a specific-chapters task from chapter URLs', async () => {
    const chapterUrl = 'https://kuronavi.one/manga/an-haxing-jian-guo-jia-noe-de-ling-zhu/chapter-51.2';
    const response = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        mode: 'chapters',
        url: chapterUrl,
        chapterUrls: [chapterUrl],
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = response.json() as { data: { taskId: string } };
    const task = taskManager.getTask(payload.data.taskId);
    expect(task?.data.mode).toBe('chapters');
    expect(task?.data.url).toBe(chapterUrl);
    expect(task?.data.chapterUrls).toEqual([chapterUrl]);
  });

  it('should reject a specific-chapters task without chapter URLs', async () => {
    const response = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        mode: 'chapters',
        url: 'https://kuronavi.one/manga/an-haxing-jian-guo-jia-noe-de-ling-zhu/chapter-51.2',
        chapterUrls: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'At least one chapter URL is required' });
  });

  it('should queue full discovery when a matched adapter only supports chapter images', async () => {
    adapterRegistry.register(new DynamicSiteAdapter({
      adapterId: 'chapter-only-example',
      name: 'Chapter Only Example',
      domains: ['chapter-only.example'],
      urlPatterns: ['https://chapter-only.example/mangaread/*/*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: {
        images: {
          item: '.reader img',
          srcAttr: 'src',
        },
      },
      sourceDiscoveryId: 'disc-existing',
      promotedAt: '2026-06-25T00:00:00.000Z',
    }));
    const response = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        mode: 'all',
        url: 'https://chapter-only.example/manga/demo',
      },
    });

    expect(response.statusCode).toBe(202);
    const payload = response.json() as { data: { kind: string; reason: string; discoveryId: string; adapterId: string; capabilities: { metadata: boolean; chapterImages: boolean } } };
    expect(payload.data.kind).toBe('discoveryQueued');
    expect(payload.data.reason).toBe('adapter_capability_mismatch');
    expect(payload.data.adapterId).toBe('chapter-only-example');
    expect(payload.data.capabilities).toEqual({ verification: true, metadata: false, chapterImages: true });
    const job = await storage.read<any>(`selector-discovery-job-${payload.data.discoveryId}`);
    expect(job.target).toBe('full');
    expect(job.promotionMode).toBe('augment');
    expect(job.baseAdapterId).toBe('chapter-only-example');
  });

  it('should allow specific-chapters tasks for chapter-only adapters', async () => {
    adapterRegistry.register(new DynamicSiteAdapter({
      adapterId: 'chapter-only-example',
      name: 'Chapter Only Example',
      domains: ['chapter-only.example'],
      urlPatterns: [],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: {
        images: {
          item: '.reader img',
          srcAttr: 'src',
        },
      },
      sourceDiscoveryId: 'disc-existing',
      promotedAt: '2026-06-25T00:00:00.000Z',
    }));
    const chapterUrl = 'https://chapter-only.example/manga/demo/chapter-1';

    const response = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        mode: 'chapters',
        url: chapterUrl,
        chapterUrls: [chapterUrl],
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = response.json() as { data: { taskId: string; kind: string } };
    expect(payload.data.kind).toBe('taskCreated');
    expect(taskManager.getTask(payload.data.taskId)?.data.adapterId).toBe('chapter-only-example');
  });

  it('should return 409 when resuming waiting verification before challenge is ready', async () => {
    await taskManager.createTask({
      id: 'task-waiting-resume',
      url: 'https://kuronavi.one/manga/demo/chapter-1',
      adapterId: 'kuronavi',
      mode: 'chapters',
      chapterUrls: ['https://kuronavi.one/manga/demo/chapter-1'],
    });
    await flushAsyncWork();
    challengeJobs.set('chal-not-ready', {
      id: 'chal-not-ready',
      normalizedUrl: 'https://kuronavi.one/manga/demo/chapter-1',
      hostname: 'kuronavi.one',
      status: 'challenge_required',
      error: 'Human verification is not ready yet.',
    });
    setTaskWaitingVerification(taskManager, 'task-waiting-resume', 'chal-not-ready');

    const response = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks/task-waiting-resume/resume',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().data.challenge.status).toBe('challenge_required');
    expect(taskManager.getTask('task-waiting-resume')?.status).toBe('waiting_verification');
  });

  it('should resume a waiting verification task when challenge is ready and keep checkpoint counts', async () => {
    await taskManager.createTask({
      id: 'task-waiting-ready',
      url: 'https://kuronavi.one/manga/demo/chapter-1',
      adapterId: 'kuronavi',
      mode: 'chapters',
      chapterUrls: ['https://kuronavi.one/manga/demo/chapter-1'],
    });
    await flushAsyncWork();
    const checkpoint = createEmptyCheckpoint('task-waiting-ready');
    checkpoint.resumable = true;
    checkpoint.completedImages = 2;
    checkpoint.failedImages = 1;
    checkpoint.totalImages = 5;
    await taskManager.updateCheckpoint('task-waiting-ready', checkpoint);
    challengeJobs.set('chal-ready', {
      id: 'chal-ready',
      normalizedUrl: 'https://kuronavi.one/manga/demo/chapter-1',
      hostname: 'kuronavi.one',
      status: 'ready',
    });
    setTaskWaitingVerification(taskManager, 'task-waiting-ready', 'chal-ready');

    const response = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks/task-waiting-ready/resume',
    });

    expect(response.statusCode).toBe(200);
    expect(taskManager.getTask('task-waiting-ready')?.status).not.toBe('waiting_verification');
    expect(taskManager.getTaskResult('task-waiting-ready')?.downloadedImages).toBe(2);
    expect(taskManager.getTaskResult('task-waiting-ready')?.failedImages).toBe(1);
    expect(taskManager.getTaskResult('task-waiting-ready')?.totalImages).toBe(5);
  });

  it('should queue chapter-only discovery for unsupported chapter URLs', async () => {
    const chapterUrl = 'https://unknown.example/manga/demo/chapter-1';

    const response = await server.getApp().inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        mode: 'chapters',
        url: chapterUrl,
        chapterUrls: [chapterUrl],
      },
    });

    expect(response.statusCode).toBe(202);
    const payload = response.json() as { data: { kind: string; discoveryId: string } };
    expect(payload.data.kind).toBe('discoveryQueued');
    const job = await storage.read<any>(`selector-discovery-job-${payload.data.discoveryId}`);
    expect(job.target).toBe('chapter-only');
  });
});

function setTaskWaitingVerification(taskManager: TaskManager, taskId: string, challengeDiscoveryId: string): void {
  const record = (taskManager as any).records.get(taskId);
  record.task.status = 'waiting_verification';
  record.task.error = `Human verification is required before crawling can continue. Challenge discovery job: ${challengeDiscoveryId}`;
  record.result.status = 'waiting_verification';
  record.result.error = record.task.error;
  record.result.challengeDiscoveryId = challengeDiscoveryId;
  record.result.challengeStatus = 'challenge_required';
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
