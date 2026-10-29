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
import { AdapterBase } from '../../src/adapter/base';
import { createEmptyCheckpoint } from '../../src/task/checkpoint';
import { ComicError, ErrorType } from '../../src/error/types';
import type { ComicMetadata } from '../../../shared/types';
import { BrowserRenderService } from '../../src/browser/browser-render-service';
import type { BrowserCommand } from '@comiccrawler/browser-client-sdk';

const TEST_ROOT = join(__dirname, '__tmp__', 'rest-only-flow');

class RestOnlyAdapter extends AdapterBase {
  readonly id = 'rest-only';
  readonly name = 'REST Only Adapter';
  readonly domains = ['rest-only.example'];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = { verification: true, metadata: true, chapterImages: true };

  matchUrl(url: string): boolean {
    return url.includes('rest-only.example');
  }

  async loadDocument(url: string): Promise<unknown> {
    return url.includes('/chapter-') ? 'chapter' : url;
  }

  extractTitle(): string {
    return 'REST Only Comic';
  }

  extractChapterList(document: unknown): ComicMetadata['chapters'] {
    const url = String(document);
    return [
      {
        id: 'chapter-1',
        title: 'Chapter 1',
        url: `${new URL(url).origin}/chapter-1`,
      },
    ];
  }

  extractChapterImageUrls(): string[] {
    return [
      'https://rest-only.example/images/001.jpg',
      'https://rest-only.example/images/002.jpg',
    ];
  }
}

let server: ComicCrawlerServer;

let storage: JsonFileStore;

let taskManager: TaskManager;

let crawlerEngine: CrawlerEngine;

let eventBus: EventBus;

let adapterRegistry: AdapterRegistry;

let challengeJobs: Map<string, any>;

let verificationReady = false;

describe('Integration: REST-only crawl flow', () => {
  IntegrationRESTOnlyCrawlFlowTestGroup1();
});

function chapterUrlForCommand(command: unknown): string {
  return typeof command === 'object' && command && 'url' in command
    ? String((command as { url?: string }).url ?? 'https://rest-only.example/')
    : 'https://rest-only.example/';
}

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

function IntegrationRESTOnlyCrawlFlowTestGroup1(): void {
  beforeEach(IntegrationRESTOnlyCrawlFlowTestScenario1);
  afterEach(IntegrationRESTOnlyCrawlFlowTestScenario2);
  it('creates and completes a chapter-only crawl through REST APIs without frontend involvement', IntegrationRESTOnlyCrawlFlowTestCreatesAndCompletesAChapterOnlyCrawlThroughRESTAPIsWithoutFrontendInvolvement);
  it('drives the human verification handoff and resume path through REST APIs', IntegrationRESTOnlyCrawlFlowTestDrivesTheHumanVerificationHandoffAndResumePathThroughRESTAPIs);
  it('queues selector discovery for unsupported URLs through the task creation API', IntegrationRESTOnlyCrawlFlowTestQueuesSelectorDiscoveryForUnsupportedURLsThroughTheTaskCreationAPI);
}

async function IntegrationRESTOnlyCrawlFlowTestScenario1() {
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
    taskManager = new TaskManager(executeRestTask, { eventBus, storage, concurrency: 1 });
    await taskManager.initialize();
    crawlerEngine = createCrawlerEngine();
    server = createRestServer(configManager);
}

async function executeRestTask(task: Parameters<ConstructorParameters<typeof TaskManager>[0]>[0]): Promise<void> {
  eventBus.emit('task:started', { taskId: task.id });
  if (task.data.url.includes('/challenge') && !verificationReady) throwVerification(task.data.url);
  const checkpoint = createEmptyCheckpoint(task.id);
  Object.assign(checkpoint, { resumable: true, currentChapterTitle: 'Chapter 1',
    totalImages: 2, completedImages: 2, failedImages: 0,
    metadata: { title: 'REST Only Comic' },
    outputPath: join(TEST_ROOT, 'downloads', 'rest-only.example', 'REST Only Comic') });
  await taskManager.updateCheckpoint(task.id, checkpoint);
  emitRestProgress(task.id, checkpoint.outputPath!);
}

function throwVerification(url: string): never {
  challengeJobs.set('handoff-rest-only', challengeJob(url));
  throw new ComicError('Human verification is required before crawling can continue. Challenge discovery job: handoff-rest-only',
    ErrorType.AUTH_ERROR, true, { antiBotChallenge: true,
      challengeDiscoveryId: 'handoff-rest-only', challengeStatus: 'challenge_required' });
}

function emitRestProgress(taskId: string, outputPath: string): void {
  eventBus.emit('task:progress', { taskId, progress: { totalImages: 2,
    completedImages: 2, failedImages: 0, stage: 'downloading',
    stageDetail: 'downloading Chapter 1: 2/2 images', currentChapter: 'Chapter 1',
    metadata: { title: 'REST Only Comic' }, outputPath } });
}

function createCrawlerEngine(): CrawlerEngine {
  return new CrawlerEngine({ downloadDir: join(TEST_ROOT, 'downloads'), concurrency: 1, eventBus,
    browser: { timeout: 1000, workerWaitTimeoutMs: 1000, postLoadDelayMs: 0 } });
}

function createRestServer(configManager: ConfigManager): ComicCrawlerServer {
  return new ComicCrawlerServer({
        port: 0,
        host: '127.0.0.1',
        configManager,
        taskManager,
        adapterRegistry,
        crawlerEngine,
        eventBus,
        browserRenderService: new BrowserRenderService({ execute: executeBrowserCommand } as any),
        browserLeaseCoordinator: browserLeaseCoordinator() as any,
        selectorDiscoveryService: selectorDiscoveryStub() as any,
        challengeDiscoveryService: challengeDiscoveryStub() as any,
    });
}

async function executeBrowserCommand(_sessionId: string, command: BrowserCommand) {
  if (command.type === 'page.navigate') return { type: 'page.navigate', url: command.url };
  if (command.type === 'page.wait-for-ready') return { type: 'page.wait-for-ready', url: chapterUrlForCommand(command) };
  if (command.type === 'page.prepare.start') return { type: 'page.prepare.start',
    operationId: command.operationId, progress: progressingPreparation() };
  if (command.type === 'page.prepare.step') return { type: 'page.prepare.step',
    operationId: command.operationId, progress: completedPreparation() };
  if (command.type === 'page.prepare.finish') return { type: 'page.prepare.finish',
    operationId: command.operationId, url: chapterUrlForCommand(command) };
  if (command.type === 'page.get-content') return { type: 'page.get-content', url: 'https://rest-only.example/', html: '<html></html>' };
  if (command.type === 'page.get-url') return { type: 'page.get-url', url: 'https://rest-only.example/' };
  return { type: 'page.focus' };
}

function progressingPreparation() {
  return { status: 'progressing' as const, phase: 'candidates' as const,
    discoveredCandidates: 1, processedCandidates: 0, capturedImages: 0, fallbackSteps: 0 };
}

function completedPreparation() {
  return { ...progressingPreparation(), status: 'completed' as const,
    phase: 'completed' as const, processedCandidates: 1, capturedImages: 1 };
}

function browserLeaseCoordinator() {
  return { acquire: async () => ({ sessionId: 'test-session', release: async () => undefined }),
    validateTarget: () => undefined, dispose: async () => undefined };
}

function selectorDiscoveryStub() {
  return { create: async (input: any) => ({ id: 'disc-rest-only', url: input.url,
    normalizedUrl: input.url, hostname: new URL(input.url).hostname, status: 'queued',
    target: input.target, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }) };
}

function challengeJob(url: string) {
  return { id: 'handoff-rest-only', url, normalizedUrl: url, hostname: new URL(url).hostname,
    status: 'challenge_required', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

function challengeDiscoveryStub() {
  return { probe: async () => ({ status: 'ready' }), create: async (input: { url: string }) => {
    const job = challengeJob(input.url); challengeJobs.set(job.id, job); return job;
  }, get: async (id: string) => challengeJobs.get(id) ?? null,
  openBrowser: async (id: string) => updateChallenge(id, 'browser_open'),
  completeHumanVerification: async (id: string) => {
    verificationReady = true; return updateChallenge(id, 'ready');
  } };
}

function updateChallenge(id: string, status: string) {
  const job = challengeJobs.get(id);
  if (!job) throw new Error(`Challenge discovery job "${id}" was not found.`);
  job.status = status;
  job.updatedAt = new Date().toISOString();
  return job;
}

async function IntegrationRESTOnlyCrawlFlowTestScenario2() {
    await server.stop().catch(() => undefined);
    await storage.dispose();
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
}

async function IntegrationRESTOnlyCrawlFlowTestCreatesAndCompletesAChapterOnlyCrawlThroughRESTAPIsWithoutFrontendInvolvement() {
    const chapterUrl = 'https://rest-only.example/comic/demo/chapter-1';
    await expectAdapterEndpoints(chapterUrl);
    const taskId = await createRestTask(chapterUrl);
    await waitForTaskStatus(taskManager, taskId, 'completed');
    await expectCompletedTaskDetail(taskId);
}

async function expectAdapterEndpoints(chapterUrl: string): Promise<void> {
    const resolveResponse = await server.getApp().inject({
        method: 'POST',
        url: '/api/adapters/resolve',
        payload: { url: chapterUrl, mode: 'chapters' },
    });
    expect(resolveResponse.statusCode).toBe(200);
    expect(resolveResponse.json().data.status).toBe('matched');
    await expectChapterImagesEndpoint(chapterUrl);
}

async function expectChapterImagesEndpoint(chapterUrl: string): Promise<void> {
    const imagesResponse = await server.getApp().inject({
        method: 'POST',
        url: '/api/adapters/chapter-images',
        payload: { url: chapterUrl },
    });
    expect(imagesResponse.statusCode).toBe(200);
    expect(imagesResponse.json().data).toMatchObject({
        adapterId: 'rest-only',
        chapterUrl,
        imageUrlCount: 2,
        imageUrls: [
            'https://rest-only.example/images/001.jpg',
            'https://rest-only.example/images/002.jpg',
        ],
    });
}

async function createRestTask(chapterUrl: string): Promise<string> {
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
    return createResponse.json().data.taskId as string;
}

async function expectCompletedTaskDetail(taskId: string): Promise<void> {
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
}

async function IntegrationRESTOnlyCrawlFlowTestDrivesTheHumanVerificationHandoffAndResumePathThroughRESTAPIs() {
    const chapterUrl = 'https://rest-only.example/comic/demo/challenge/chapter-1';
    const taskId = await createRestTask(chapterUrl);
    await waitForTaskStatus(taskManager, taskId, 'waiting_verification');
    await expectWaitingVerification(taskId);
    await completeVerificationHandoff();
    await expectResumedTask(taskId);
}

async function expectWaitingVerification(taskId: string): Promise<void> {
    const waitingDetail = await server.getApp().inject({
        method: 'GET',
        url: `/api/tasks/${taskId}`,
    });
    expect(waitingDetail.statusCode).toBe(200);
    expect(waitingDetail.json().data.result.challengeDiscoveryId).toBe('handoff-rest-only');
}

async function completeVerificationHandoff(): Promise<void> {
    const openResponse = await server.getApp().inject({
        method: 'POST',
        url: '/api/challenge-discovery/handoff-rest-only/open-browser',
        payload: {},
    });
    expect(openResponse.statusCode).toBe(200);
    expect(openResponse.json().data.status).toBe('browser_open');
    const completeResponse = await server.getApp().inject({
        method: 'POST',
        url: '/api/challenge-discovery/handoff-rest-only/complete-human-verification',
    });
    expect(completeResponse.statusCode).toBe(202);
    expect(completeResponse.json().data.status).toBe('ready');
}

async function expectResumedTask(taskId: string): Promise<void> {
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
}

async function IntegrationRESTOnlyCrawlFlowTestQueuesSelectorDiscoveryForUnsupportedURLsThroughTheTaskCreationAPI() {
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
}
