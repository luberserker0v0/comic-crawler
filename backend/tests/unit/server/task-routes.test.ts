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

let server: ComicCrawlerServer;

let storage: JsonFileStore;

let taskManager: TaskManager;

let crawlerEngine: CrawlerEngine;

let adapterRegistry: AdapterRegistry;

let challengeJobs: Map<string, any>;

let recoveryResources: Map<string, { workerId: string; ownerUserId: string; url: string; online?: boolean }>;

describe('Task routes persistence', () => {
  TaskRoutesPersistenceTestGroup1();
  TaskRoutesPersistenceTestGroup2();
  TaskRoutesPersistenceTestGroup3();
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

function existingTarget(workerId: string, resourceId: string) {
  return { mode: 'existing-tab' as const, workerId, resourceId };
}

async function createRecoveryTask(
  taskManager: TaskManager,
  id: string,
  url: string,
  ownerUserId: string,
  status: 'waiting_for_browser_worker' | 'waiting_verification' | 'interrupted' | 'running' | 'failed'
): Promise<void> {
  await taskManager.createTask({ id, url, adapterId: 'kuronavi', mode: 'chapters',
    chapterUrls: [url], ownerUserId,
    browserTarget: existingTarget('worker-old', 'resource-old') });
  await flushAsyncWork();
  const record = (taskManager as any).records.get(id);
  record.task.status = status;
  record.result.status = status;
  if (status === 'interrupted') setRecordError(record, 'Task interrupted by server restart');
}

function setRecordError(record: any, error: string): void {
  record.task.error = error;
  record.result.error = error;
}

function TaskRoutesPersistenceTestGroup1(): void {
  beforeEach(TaskRoutesPersistenceTestScenario1);
  afterEach(TaskRoutesPersistenceTestScenario2);
  it('should return persisted tasks from /api/tasks', TaskRoutesPersistenceTestShouldReturnPersistedTasksFromApiTasks);
  it('should return persisted result and progress from /api/tasks/:id', TaskRoutesPersistenceTestShouldReturnPersistedResultAndProgressFromApiTasksId);
  it('should return checkpoint summary from /api/tasks/:id', TaskRoutesPersistenceTestShouldReturnCheckpointSummaryFromApiTasksId);
  it('should delete terminal tasks through /api/tasks/:id', TaskRoutesPersistenceTestShouldDeleteTerminalTasksThroughApiTasksId);
  it('should delete waiting verification tasks through /api/tasks/:id', TaskRoutesPersistenceTestShouldDeleteWaitingVerificationTasksThroughApiTasksId);
  it('should reject deleting active tasks through /api/tasks/:id', TaskRoutesPersistenceTestShouldRejectDeletingActiveTasksThroughApiTasksId);
  it('should create an all-chapters task from a manga URL', TaskRoutesPersistenceTestShouldCreateAnAllChaptersTaskFromAMangaURL);
  it('explicitly rebinds a recoverable existing-tab task and persists an idempotent event', TaskRoutesPersistenceTestExplicitlyRebindsARecoverableExistingTabTaskAndPersistsAnIdempotentEvent);
}

function TaskRoutesPersistenceTestGroup2(): void {
  it('rejects stale, wrong-owner, URL-mismatched, and running task recovery', TaskRoutesPersistenceTestRejectsStaleWrongOwnerURLMismatchedAndRunningTaskRecovery);
  it('rebinds the existing human-verification handoff without replacing its history', TaskRoutesPersistenceTestRebindsTheExistingHumanVerificationHandoffWithoutReplacingItsHistory);
  it('only recovers failed tasks classified as browser-target loss', TaskRoutesPersistenceTestOnlyRecoversFailedTasksClassifiedAsBrowserTargetLoss);
  it('should create a specific-chapters task from chapter URLs', TaskRoutesPersistenceTestShouldCreateASpecificChaptersTaskFromChapterURLs);
  it('persists the default worker selection and rejects the removed session input', TaskRoutesPersistenceTestPersistsTheDefaultWorkerSelectionAndRejectsTheRemovedSessionInput);
  it('persists an exact existing-tab Worker and resource target', TaskRoutesPersistenceTestPersistsAnExactExistingTabWorkerAndResourceTarget);
  it('rejects removed Browser Target modes and incomplete existing-tab targets', TaskRoutesPersistenceTestRejectsRemovedBrowserTargetModesAndIncompleteExistingTabTargets);
  it('should reject a specific-chapters task without chapter URLs', TaskRoutesPersistenceTestShouldRejectASpecificChaptersTaskWithoutChapterURLs);
  it('should queue full discovery when a matched adapter only supports chapter images', TaskRoutesPersistenceTestShouldQueueFullDiscoveryWhenAMatchedAdapterOnlySupportsChapterImages);
  it('should allow specific-chapters tasks for chapter-only adapters', TaskRoutesPersistenceTestShouldAllowSpecificChaptersTasksForChapterOnlyAdapters);
}

function TaskRoutesPersistenceTestGroup3(): void {
  it('should return 409 when resuming waiting verification before challenge is ready', TaskRoutesPersistenceTestShouldReturn409WhenResumingWaitingVerificationBeforeChallengeIsReady);
  it('should resume a waiting verification task when challenge is ready and keep checkpoint counts', TaskRoutesPersistenceTestShouldResumeAWaitingVerificationTaskWhenChallengeIsReadyAndKeepCheckpointCounts);
  it('should queue chapter-only discovery for unsupported chapter URLs', TaskRoutesPersistenceTestShouldQueueChapterOnlyDiscoveryForUnsupportedChapterURLs);
}

async function TaskRoutesPersistenceTestScenario1() {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });
    const eventBus = new EventBus();
    storage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
    await storage.initialize();
    const configManager = new ConfigManager(storage, eventBus);
    await configManager.load();
    adapterRegistry = new AdapterRegistry(eventBus);
    adapterRegistry.register(kuronaviStub());
    taskManager = new TaskManager(async () => { }, { eventBus, storage });
    await taskManager.initialize();
    challengeJobs = new Map(); recoveryResources = new Map();
    crawlerEngine = new CrawlerEngine({ downloadDir: join(TEST_ROOT, 'downloads'), concurrency: 1, eventBus });
    await seedCompletedTask(eventBus);
    server = createTaskServer(configManager, eventBus);
}

function chapterTaskPayload(url: string, overrides: Record<string, unknown> = {}) {
  return { mode: 'chapters', url, chapterUrls: [url], ...overrides };
}

function injectTask(payload: Record<string, unknown>) {
  return server.getApp().inject({ method: 'POST', url: '/api/tasks', payload });
}

function rebindTask(id: string, payload: Record<string, unknown>) {
  return server.getApp().inject({ method: 'POST', url: `/api/tasks/${id}/rebind-browser-target`, payload });
}

function registerChapterOnlyAdapter(urlPatterns: string[]): void {
  adapterRegistry.register(new DynamicSiteAdapter({ adapterId: 'chapter-only-example',
    name: 'Chapter Only Example', domains: ['chapter-only.example'], urlPatterns,
    capabilities: { verification: true, metadata: false, chapterImages: true },
    selectors: { images: { item: '.reader img', srcAttr: 'src' } },
    sourceDiscoveryId: 'disc-existing', promotedAt: '2026-06-25T00:00:00.000Z' }));
}

function kuronaviStub() {
  return { id: 'kuronavi', name: 'Kuronavi', domains: ['kuronavi.one'], parseMode: 'playwright',
    capabilities: { verification: false, metadata: true, chapterImages: true },
    matchUrl: (url: string) => url.includes('kuronavi.one'), loadDocument: async () => ({}),
    extractTitle: async () => 'Demo', extractChapterList: async () => [],
    extractChapterImageUrls: async () => [] } as any;
}

async function seedCompletedTask(eventBus: EventBus): Promise<void> {
  await taskManager.createTask({ id: 'task-1', url: 'https://example.com/comic/1', adapterId: 'kuronavi' });
  eventBus.emit('task:started', { taskId: 'task-1' });
  eventBus.emit('task:completed', { taskId: 'task-1', result: {
    downloadedImages: 5, failedImages: 0, totalImages: 5, outputPath: './downloads',
  } });
}

function createTaskServer(configManager: ConfigManager, eventBus: EventBus): ComicCrawlerServer {
  return new ComicCrawlerServer({
        port: 0,
        host: '127.0.0.1',
        configManager,
        taskManager,
        adapterRegistry,
        crawlerEngine,
        eventBus,
        selectorDiscoveryService: { create: createSelectorDiscovery } as any,
        challengeDiscoveryService: challengeDiscoveryStub() as any,
        browserLeaseCoordinator: browserLeaseStub() as any,
    });
}

async function createSelectorDiscovery(input: { url: string; target?: 'full' | 'chapter-only' }) {
  const id = `disc-${Date.now()}`;
  const domainAdapter = adapterRegistry.findByUrl(input.url) ?? adapterRegistry.findByUrlDomain(input.url);
  const capabilities = domainAdapter?.capabilities;
  const promotionMode = input.target === 'full' && domainAdapter && capabilities?.chapterImages && !capabilities.metadata
    ? 'augment' : 'create';
  const job = { id, url: input.url, normalizedUrl: input.url, hostname: new URL(input.url).hostname,
    status: 'queued', target: input.target, promotionMode,
    baseAdapterId: promotionMode === 'augment' ? domainAdapter?.id : undefined,
    createdAt: '2026-06-25T00:00:00.000Z', updatedAt: '2026-06-25T00:00:00.000Z' };
  await storage.write(`selector-discovery-job-${id}`, job);
  return job;
}

function challengeDiscoveryStub() {
  return { probe: async () => ({ status: 'ready' }), create: createChallengeJob,
    get: async (id: string) => challengeJobs.get(id) ?? null,
    completeHumanVerification: async (id: string) => requiredChallengeJob(id),
    rebindBrowserTarget: async (id: string, browserTarget: any) => {
      const updated = { ...requiredChallengeJob(id), browserTarget, status: 'challenge_required' };
      challengeJobs.set(id, updated); return updated;
    } };
}

async function createChallengeJob(input: { url: string }) {
  const id = `chal-${Date.now()}`;
  const job = { id, url: input.url, normalizedUrl: input.url, hostname: new URL(input.url).hostname,
    status: 'challenge_required', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  challengeJobs.set(id, job);
  return job;
}

function requiredChallengeJob(id: string) {
  const job = challengeJobs.get(id);
  if (!job) throw new Error(`Challenge discovery job "${id}" was not found.`);
  return job;
}

function browserLeaseStub() {
  return { validateTarget: () => undefined,
    validateExistingTabRecoveryTarget: validateRecoveryTarget,
    releaseTask: async () => undefined, dispose: async () => undefined };
}

function validateRecoveryTarget(input: any) {
  const resource = recoveryResources.get(input.target.resourceId);
  if (!resource || resource.workerId !== input.target.workerId || resource.ownerUserId !== input.ownerUserId)
    throw new Error(`Browser resource "${input.target.resourceId}" was not found for this Worker.`);
  if (resource.online === false) throw new Error(`Browser Worker "${resource.workerId}" is offline.`);
  if (new URL(resource.url).toString() !== new URL(input.expectedUrl).toString())
    throw new Error(`Browser resource "${input.target.resourceId}" is not on the task target URL.`);
  return { resourceUrl: resource.url };
}

async function TaskRoutesPersistenceTestScenario2() {
    await server.stop().catch(() => undefined);
    await storage.dispose();
}

async function TaskRoutesPersistenceTestShouldReturnPersistedTasksFromApiTasks() {
    const response = await server.getApp().inject({
        method: 'GET',
        url: '/api/tasks',
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
        data: {
            tasks: Array<{
                id: string;
                status: string;
            }>;
        };
    };
    expect(payload.data.tasks).toHaveLength(1);
    expect(payload.data.tasks[0]?.status).toBe('completed');
}

async function TaskRoutesPersistenceTestShouldReturnPersistedResultAndProgressFromApiTasksId() {
    const response = await server.getApp().inject({
        method: 'GET',
        url: '/api/tasks/task-1',
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
        data: {
            result: {
                outputPath: string;
                status: string;
            };
        };
    };
    expect(payload.data.result.status).toBe('completed');
    expect(payload.data.result.outputPath).toBe('./downloads');
}

async function TaskRoutesPersistenceTestShouldReturnCheckpointSummaryFromApiTasksId() {
    const checkpoint = createEmptyCheckpoint('task-1');
    Object.assign(checkpoint, { resumable: true, currentChapterTitle: 'Chapter 7',
      completedImages: 3, failedImages: 1 });
    await taskManager.updateCheckpoint('task-1', checkpoint);
    const response = await server.getApp().inject({
        method: 'GET',
        url: '/api/tasks/task-1',
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.data.checkpoint).toMatchObject({
        currentChapter: 'Chapter 7',
        completedImages: 3,
        failedImages: 1,
        resumable: true,
    });
}

async function TaskRoutesPersistenceTestShouldDeleteTerminalTasksThroughApiTasksId() {
    const response = await server.getApp().inject({
        method: 'DELETE',
        url: '/api/tasks/task-1',
    });
    expect(response.statusCode).toBe(200);
    expect(taskManager.getTask('task-1')).toBeUndefined();
}

async function TaskRoutesPersistenceTestShouldDeleteWaitingVerificationTasksThroughApiTasksId() {
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
}

async function TaskRoutesPersistenceTestShouldRejectDeletingActiveTasksThroughApiTasksId() {
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
}

async function TaskRoutesPersistenceTestShouldCreateAnAllChaptersTaskFromAMangaURL() {
    const response = await server.getApp().inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
            mode: 'all',
            url: 'https://kuronavi.one/manga/an-haxing-jian-guo-jia-noe-de-ling-zhu/',
        },
    });
    expect(response.statusCode).toBe(201);
    const payload = response.json() as {
        data: {
            taskId: string;
        };
    };
    const task = taskManager.getTask(payload.data.taskId);
    expect(task?.data.mode).toBe('all');
    expect(task?.data.url).toBe('https://kuronavi.one/manga/an-haxing-jian-guo-jia-noe-de-ling-zhu/');
    expect(task?.data.chapterUrls).toEqual([]);
}

async function TaskRoutesPersistenceTestExplicitlyRebindsARecoverableExistingTabTaskAndPersistsAnIdempotentEvent() {
    const url = 'https://kuronavi.one/manga/demo/chapter-1';
    await createRecoveryTask(taskManager, 'task-rebind', url, 'public', 'waiting_for_browser_worker');
    recoveryResources.set('resource-new', { workerId: 'worker-new', ownerUserId: 'public', url });
    const payload = recoveryPayload();
    const first = await rebindTask('task-rebind', payload);
    const repeated = await rebindTask('task-rebind', payload);
    await expectIdempotentRebind(first, repeated, payload);
}

function recoveryPayload() {
  return { expectedBrowserTarget: existingTarget('worker-old', 'resource-old'),
    browserTarget: existingTarget('worker-new', 'resource-new') };
}

async function expectIdempotentRebind(first: any, repeated: any, payload: ReturnType<typeof recoveryPayload>) {
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({
        task: { id: 'task-rebind', browserTarget: payload.browserTarget },
        previousBrowserTarget: payload.expectedBrowserTarget,
        recovery: { reason: 'browser_client_process_restarted', idempotent: false },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.recovery).toMatchObject({
        reboundAt: first.json().data.recovery.reboundAt,
        idempotent: true,
    });
    expect(taskManager.getEvents('task-rebind')).toHaveLength(1);
    const detail = await server.getApp().inject({ method: 'GET', url: '/api/tasks/task-rebind' });
    expect(detail.json().data.events).toHaveLength(1);
}

async function TaskRoutesPersistenceTestRejectsStaleWrongOwnerURLMismatchedAndRunningTaskRecovery() {
    const url = 'https://kuronavi.one/manga/demo/chapter-1';
    recoveryResources.set('resource-new', {
        workerId: 'worker-new',
        ownerUserId: 'public',
        url: 'https://kuronavi.one/manga/demo/chapter-2',
    });
    await createRecoveryTask(taskManager, 'task-stale', url, 'public', 'interrupted');
    await createRecoveryTask(taskManager, 'task-owner', url, 'alice', 'interrupted');
    await createRecoveryTask(taskManager, 'task-running', url, 'public', 'running');
    const target = existingTarget('worker-new', 'resource-new');
    const stale = await rebindTask('task-stale', { expectedBrowserTarget: existingTarget('worker-other', 'resource-other'), browserTarget: target });
    const wrongOwner = await rebindTask('task-owner', { ...recoveryPayload(), browserTarget: target });
    const mismatch = await rebindTask('task-stale', { ...recoveryPayload(), browserTarget: target });
    recoveryResources.set('resource-new', { workerId: 'worker-new', ownerUserId: 'public', url });
    const running = await rebindTask('task-running', { ...recoveryPayload(), browserTarget: target });
    expectRejectedRecoveries(stale, wrongOwner, mismatch, running);
}

function expectRejectedRecoveries(stale: any, wrongOwner: any, mismatch: any, running: any): void {
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('STALE_TARGET');
    expect(wrongOwner.statusCode).toBe(403);
    expect(mismatch.statusCode).toBe(400);
    expect(running.statusCode).toBe(409);
    expect(running.json().code).toBe('INVALID_STATE');
}

async function TaskRoutesPersistenceTestRebindsTheExistingHumanVerificationHandoffWithoutReplacingItsHistory() {
    const url = 'https://kuronavi.one/manga/demo/chapter-1';
    await createRecoveryTask(taskManager, 'task-handoff-rebind', url, 'public', 'waiting_verification');
    setTaskWaitingVerification(taskManager, 'task-handoff-rebind', 'chal-rebind');
    challengeJobs.set('chal-rebind', handoffJob(url));
    recoveryResources.set('resource-new', { workerId: 'worker-new', ownerUserId: 'public', url });
    const response = await rebindTask('task-handoff-rebind', recoveryPayload());
    expect(response.statusCode).toBe(200);
    expect(response.json().data.challenge).toMatchObject({
        id: 'chal-rebind',
        status: 'challenge_required',
        browserTarget: existingTarget('worker-new', 'resource-new'),
    });
    expect(taskManager.getTask('task-handoff-rebind')?.status).toBe('waiting_verification');
    expect(taskManager.getTaskResult('task-handoff-rebind')?.challengeDiscoveryId).toBe('chal-rebind');
}

function handoffJob(url: string) {
  return { id: 'chal-rebind', url, normalizedUrl: url, hostname: 'kuronavi.one',
    status: 'challenge_required', browserTarget: existingTarget('worker-old', 'resource-old'),
    createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' };
}

async function TaskRoutesPersistenceTestOnlyRecoversFailedTasksClassifiedAsBrowserTargetLoss() {
    const url = 'https://kuronavi.one/manga/demo/chapter-1';
    await createRecoveryTask(taskManager, 'task-browser-failed', url, 'public', 'failed');
    await createRecoveryTask(taskManager, 'task-adapter-failed', url, 'public', 'failed');
    const browserFailure = (taskManager as any).records.get('task-browser-failed');
    browserFailure.task.error = 'Browser resource was not found after process restart.';
    browserFailure.result.error = browserFailure.task.error;
    const adapterFailure = (taskManager as any).records.get('task-adapter-failed');
    adapterFailure.task.error = 'Adapter selector did not match.';
    adapterFailure.result.error = adapterFailure.task.error;
    recoveryResources.set('resource-new', { workerId: 'worker-new', ownerUserId: 'public', url });
    const recoverable = await rebindTask('task-browser-failed', recoveryPayload());
    const unrelated = await rebindTask('task-adapter-failed', recoveryPayload());
    expect(recoverable.statusCode).toBe(200);
    expect(unrelated.statusCode).toBe(409);
    expect(unrelated.json().code).toBe('INVALID_STATE');
}

async function TaskRoutesPersistenceTestShouldCreateASpecificChaptersTaskFromChapterURLs() {
    const chapterUrl = 'https://kuronavi.one/manga/an-haxing-jian-guo-jia-noe-de-ling-zhu/chapter-51.2';
    const response = await injectTask(chapterTaskPayload(chapterUrl));
    expect(response.statusCode).toBe(201);
    const payload = response.json() as {
        data: {
            taskId: string;
        };
    };
    const task = taskManager.getTask(payload.data.taskId);
    expect(task?.data.mode).toBe('chapters');
    expect(task?.data.url).toBe(chapterUrl);
    expect(task?.data.chapterUrls).toEqual([chapterUrl]);
}

async function TaskRoutesPersistenceTestPersistsTheDefaultWorkerSelectionAndRejectsTheRemovedSessionInput() {
    const chapterUrl = 'https://kuronavi.one/manga/demo/chapter-1';
    const response = await injectTask(chapterTaskPayload(chapterUrl,
      { browserTarget: { mode: 'managed-profile' } }));
    expect(response.statusCode).toBe(201);
    expect(response.json().data.browserTarget).toEqual({ mode: 'managed-profile' });
    expect(taskManager.getTask(response.json().data.taskId)?.data).toMatchObject({
        ownerUserId: 'public',
        browserTarget: { mode: 'managed-profile' },
    });
    const unknownField = await injectTask(chapterTaskPayload(chapterUrl, { unexpected: true }));
    expect(unknownField.statusCode).toBe(400);
    expect(unknownField.json()).toEqual({ error: 'Unknown task field "unexpected".' });
}

async function TaskRoutesPersistenceTestPersistsAnExactExistingTabWorkerAndResourceTarget() {
    const chapterUrl = 'https://kuronavi.one/manga/demo/chapter-1';
    const browserTarget = existingTarget('worker-extension', 'resource-current-tab');
    const response = await injectTask(chapterTaskPayload(chapterUrl, { browserTarget }));
    expect(response.statusCode).toBe(201);
    expect(response.json().data.browserTarget).toEqual({
        mode: 'existing-tab',
        workerId: 'worker-extension',
        resourceId: 'resource-current-tab',
    });
}

async function TaskRoutesPersistenceTestRejectsRemovedBrowserTargetModesAndIncompleteExistingTabTargets() {
    const chapterUrl = 'https://kuronavi.one/manga/demo/chapter-1';
    for (const browserTarget of [
        { mode: 'any' },
        { mode: 'specific', workerId: 'worker-old' },
        { mode: 'existing-tab', workerId: 'worker-extension' },
    ]) {
        const response = await server.getApp().inject({
            method: 'POST',
            url: '/api/tasks',
            payload: {
                mode: 'chapters',
                url: chapterUrl,
                chapterUrls: [chapterUrl],
                browserTarget,
            },
        });
        expect(response.statusCode).toBe(400);
    }
}

async function TaskRoutesPersistenceTestShouldRejectASpecificChaptersTaskWithoutChapterURLs() {
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
}

async function TaskRoutesPersistenceTestShouldQueueFullDiscoveryWhenAMatchedAdapterOnlySupportsChapterImages() {
    registerChapterOnlyAdapter(['https://chapter-only.example/mangaread/*/*']);
    const response = await server.getApp().inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
            mode: 'all',
            url: 'https://chapter-only.example/manga/demo',
        },
    });
    expect(response.statusCode).toBe(202);
    const payload = response.json();
    expect(payload.data).toMatchObject({ kind: 'discoveryQueued',
      reason: 'adapter_capability_mismatch', adapterId: 'chapter-only-example',
      capabilities: { verification: true, metadata: false, chapterImages: true } });
    const job = await storage.read<any>(`selector-discovery-job-${payload.data.discoveryId}`);
    expect(job).toMatchObject({ target: 'full', promotionMode: 'augment',
      baseAdapterId: 'chapter-only-example' });
}

async function TaskRoutesPersistenceTestShouldAllowSpecificChaptersTasksForChapterOnlyAdapters() {
    registerChapterOnlyAdapter([]);
    const chapterUrl = 'https://chapter-only.example/manga/demo/chapter-1';
    const response = await injectTask(chapterTaskPayload(chapterUrl));
    expect(response.statusCode).toBe(201);
    const payload = response.json() as {
        data: {
            taskId: string;
            kind: string;
        };
    };
    expect(payload.data.kind).toBe('taskCreated');
    expect(taskManager.getTask(payload.data.taskId)?.data.adapterId).toBe('chapter-only-example');
}

async function TaskRoutesPersistenceTestShouldReturn409WhenResumingWaitingVerificationBeforeChallengeIsReady() {
    await seedWaitingTask('task-waiting-resume', 'chal-not-ready', 'challenge_required');
    const response = await server.getApp().inject({
        method: 'POST',
        url: '/api/tasks/task-waiting-resume/resume',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().data.challenge.status).toBe('challenge_required');
    expect(taskManager.getTask('task-waiting-resume')?.status).toBe('waiting_verification');
}

async function TaskRoutesPersistenceTestShouldResumeAWaitingVerificationTaskWhenChallengeIsReadyAndKeepCheckpointCounts() {
    await seedWaitingTask('task-waiting-ready', 'chal-ready', 'ready', true);
    const response = await server.getApp().inject({
        method: 'POST',
        url: '/api/tasks/task-waiting-ready/resume',
    });
    expect(response.statusCode).toBe(200);
    expect(taskManager.getTask('task-waiting-ready')?.status).not.toBe('waiting_verification');
    expect(taskManager.getTaskResult('task-waiting-ready')).toMatchObject({
      downloadedImages: 2, failedImages: 1, totalImages: 5,
    });
}

async function seedWaitingTask(id: string, challengeId: string, status: string,
  withCheckpoint = false): Promise<void> {
  const url = 'https://kuronavi.one/manga/demo/chapter-1';
  await taskManager.createTask({ id, url, adapterId: 'kuronavi', mode: 'chapters', chapterUrls: [url] });
  await flushAsyncWork();
  if (withCheckpoint) {
    const checkpoint = createEmptyCheckpoint(id);
    Object.assign(checkpoint, { resumable: true, completedImages: 2, failedImages: 1, totalImages: 5 });
    await taskManager.updateCheckpoint(id, checkpoint);
  }
  challengeJobs.set(challengeId, { id: challengeId, normalizedUrl: url,
    hostname: 'kuronavi.one', status, error: status === 'ready' ? undefined : 'Human verification is not ready yet.' });
  setTaskWaitingVerification(taskManager, id, challengeId);
}

async function TaskRoutesPersistenceTestShouldQueueChapterOnlyDiscoveryForUnsupportedChapterURLs() {
    const chapterUrl = 'https://unknown.example/manga/demo/chapter-1';
    const response = await injectTask(chapterTaskPayload(chapterUrl));
    expect(response.statusCode).toBe(202);
    const payload = response.json() as {
        data: {
            kind: string;
            discoveryId: string;
        };
    };
    expect(payload.data.kind).toBe('discoveryQueued');
    const job = await storage.read<any>(`selector-discovery-job-${payload.data.discoveryId}`);
    expect(job.target).toBe('chapter-only');
}
