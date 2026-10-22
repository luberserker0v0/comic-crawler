import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../../src/events/bus';
import { JsonFileStore } from '../../../src/storage/json-store';
import { TaskManager } from '../../../src/task/manager';
import { createEmptyCheckpoint } from '../../../src/task/checkpoint';

const TEST_ROOT = join(__dirname, '__tmp__', 'manager');

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function rmRetry(target: string, attempts = 5): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      // Windows often reports ENOTEMPTY/EPERM while a just-closed handle
      // drains; a short backoff is cheaper than a flaky suite.
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

async function waitForPersistedRecord(
  storage: JsonFileStore,
  taskId: string,
  predicate: (record: any) => boolean,
  attempts = 100
): Promise<any> {
  // Generous window on purpose: the persisted state is produced by
  // fire-and-forget EventBus handlers (read index + queued write + timer +
  // flush), and on Windows a flush can stall tens of ms behind AV scanning
  // or a busy disk. A tight (20 x setTimeout 0) window turns scheduling
  // jitter into suite flakes; ~1s worst case only delays genuine failures.
  for (let index = 0; index < attempts; index++) {
    const record = await storage.read<any>(`tasks/${taskId}`);
    if (record && predicate(record)) {
      return record;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return storage.read<any>(`tasks/${taskId}`);
}

let storage: JsonFileStore;

let eventBus: EventBus;

const managers: TaskManager[] = [];

const extraStores: JsonFileStore[] = [];

describe('TaskManager persistence', () => {
  TaskManagerPersistenceTestGroup1();
});

function TaskManagerPersistenceTestGroup1(): void {
  beforeEach(TaskManagerPersistenceTestScenario1);
  afterEach(TaskManagerPersistenceTestScenario2);
  it('should persist created task records', TaskManagerPersistenceTestShouldPersistCreatedTaskRecords);
  it('persists the stable browser worker target instead of a transient session', TaskManagerPersistenceTestPersistsTheStableBrowserWorkerTargetInsteadOfATransientSession);
  it('should persist progress snapshots and completion result', TaskManagerPersistenceTestShouldPersistProgressSnapshotsAndCompletionResult);
  it('should convert unfinished tasks to interrupted on restart', TaskManagerPersistenceTestShouldConvertUnfinishedTasksToInterruptedOnRestart);
  it('should requeue unfinished resumable tasks from checkpoint on restart', TaskManagerPersistenceTestShouldRequeueUnfinishedResumableTasksFromCheckpointOnRestart);
  it('should allow interrupted tasks to be resumed', TaskManagerPersistenceTestShouldAllowInterruptedTasksToBeResumed);
  it('should allow completed tasks with resumable checkpoints to be resumed', TaskManagerPersistenceTestShouldAllowCompletedTasksWithResumableCheckpointsToBeResumed);
}

async function TaskManagerPersistenceTestScenario1() {
    await rmRetry(TEST_ROOT);
    await fs.mkdir(TEST_ROOT, { recursive: true });
    eventBus = new EventBus();
    storage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
    await storage.initialize();
}

async function TaskManagerPersistenceTestScenario2() {
    // Sequential dispose: managers may still persist via their store while
    // shutting down, so the stores must outlive them. Concurrent dispose
    // lets a late write land after the data dir was removed, flaking the
    // next test (ENOTEMPTY / ghost files on Windows).
    for (const manager of managers.splice(0)) {
        await manager.dispose().catch(() => undefined);
    }
    for (const store of extraStores.splice(0)) {
        await store.dispose().catch(() => undefined);
    }
    await storage.dispose().catch(() => undefined);
    await rmRetry(TEST_ROOT);
}

async function TaskManagerPersistenceTestShouldPersistCreatedTaskRecords() {
    let releaseExecutor!: () => void;
    const executorBlocked = new Promise<void>((resolve) => {
        releaseExecutor = resolve;
    });
    const manager = new TaskManager(async () => executorBlocked, { eventBus, storage });
    managers.push(manager);
    await manager.initialize();
    await manager.createTask({
        id: 'task-1',
        url: 'https://example.com/comic/1',
        adapterId: 'kuronavi',
        priority: 1,
    });
    const persisted = await storage.read<any>('tasks/task-1');
    expect(persisted.task.id).toBe('task-1');
    expect(persisted.result.status).toBe('pending');
    releaseExecutor();
    await flushAsyncWork();
}

async function TaskManagerPersistenceTestPersistsTheStableBrowserWorkerTargetInsteadOfATransientSession() {
    const blocked = await createBlockedManager();
    const manager = blocked.manager;
    await manager.createTask({
        id: 'task-affinity',
        url: 'https://example.com/comic/affinity',
        adapterId: 'kuronavi',
        ownerUserId: 'alice',
        browserTarget: { mode: 'managed-profile', workerId: 'worker-a' },
    });
    expect(manager.getTask('task-affinity')?.data.browserTarget).toEqual({ mode: 'managed-profile', workerId: 'worker-a' });
    const persisted = await storage.read<any>('tasks/task-affinity');
    expect(persisted.task.data).toMatchObject({
        ownerUserId: 'alice',
        browserTarget: { mode: 'managed-profile', workerId: 'worker-a' },
    });
    blocked.release();
}

async function TaskManagerPersistenceTestShouldPersistProgressSnapshotsAndCompletionResult() {
    const manager = await createManager();
    await manager.createTask(taskInput('task-2'));
    eventBus.emit('task:started', { taskId: 'task-2' });
    emitProgressAndCompletion();
    await flushAsyncWork();
    const persisted = await waitForPersistedRecord(storage, 'task-2', (record) => Boolean(record.progress && record.result?.status === 'completed'));
    expectPersistedProgress(persisted);
}

async function createManager(executor: () => Promise<void> = async () => {}): Promise<TaskManager> {
  const manager = new TaskManager(executor, { eventBus, storage });
  managers.push(manager);
  await manager.initialize();
  return manager;
}

async function createBlockedManager() {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  return { manager: await createManager(async () => blocked), release };
}

function taskInput(id: string) {
  return { id, url: `https://example.com/comic/${id}`, adapterId: 'kuronavi' };
}

function emitProgressAndCompletion(): void {
  eventBus.emit('task:progress', { taskId: 'task-2', progress: {
    totalImages: 12, completedImages: 4, failedImages: 1, stage: 'downloading',
    stageDetail: 'downloading chapter-1: 4/12 images', currentChapter: 'chapter-1',
    metadata: { title: 'Example Live' }, chapterListSummary: { totalChapters: 1,
      chapters: [{ id: 'chapter-1', title: 'Chapter 1', url: 'https://example.com/chapter-1' }] },
  } });
  eventBus.emit('task:completed', { taskId: 'task-2', result: { metadata: { title: 'Example' },
    downloadedImages: 11, failedImages: 1, totalImages: 12, outputPath: './downloads' } });
}

function expectPersistedProgress(persisted: any): void {
  expect(persisted.progress).toMatchObject({ totalItems: 12, completedItems: 4,
    stage: 'downloading', stageDetail: 'downloading chapter-1: 4/12 images',
    metadata: { title: 'Example Live' }, chapterListSummary: { totalChapters: 1 } });
  expect(persisted.result).toMatchObject({ status: 'completed', metadata: { title: 'Example' },
    outputPath: './downloads' });
}

async function TaskManagerPersistenceTestShouldConvertUnfinishedTasksToInterruptedOnRestart() {
    // Block the executor so the task stays 'running' (unfinished) long
    // enough for the intermediate state to reach disk. With an immediately
    // resolving executor the task races to its terminal state and the poll
    // below may only ever observe the final record.
    let releaseExecutor!: () => void;
    const executorBlocked = new Promise<void>((resolve) => {
        releaseExecutor = resolve;
    });
    const firstManager = await createManager(async () => executorBlocked);
    await firstManager.createTask(taskInput('task-3'));
    eventBus.emit('task:started', { taskId: 'task-3' });
    await flushAsyncWork();
    let persistedBeforeRestart: any;
    try {
        persistedBeforeRestart = await waitForPersistedRecord(storage, 'task-3', (record) => record?.task?.status === 'running');
        expect(persistedBeforeRestart?.task?.status).toBe('running');
        const secondManager = await reloadManager();
        expectInterrupted(secondManager, 'task-3');
    }
    finally {
        releaseExecutor();
    }
}

function expectInterrupted(manager: TaskManager, id: string): void {
  expect([manager.getTask(id)?.status, manager.getTaskResult(id)?.status])
    .toEqual(['interrupted', 'interrupted']);
}

async function reloadManager(): Promise<TaskManager> {
  const reloadedStorage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
  extraStores.push(reloadedStorage);
  await reloadedStorage.initialize();
  const manager = new TaskManager(async () => {}, { eventBus: new EventBus(), storage: reloadedStorage });
  managers.push(manager);
  await manager.initialize();
  return manager;
}

async function TaskManagerPersistenceTestShouldRequeueUnfinishedResumableTasksFromCheckpointOnRestart() {
    const firstManager = await createManager();
    await firstManager.createTask(taskInput('task-resumable'));
    const checkpoint = resumableCheckpoint('task-resumable', 3, 1, 0);
    await firstManager.updateCheckpoint('task-resumable', checkpoint);
    eventBus.emit('task:started', { taskId: 'task-resumable' });
    await flushAsyncWork();
    const secondManager = await reloadManager();
    expect(secondManager.getTask('task-resumable')?.status).not.toBe('interrupted');
    expect(secondManager.getTaskResult('task-resumable')?.status).not.toBe('interrupted');
    expect(secondManager.getTaskResult('task-resumable')?.downloadedImages).toBe(1);
    expect(secondManager.getTaskResult('task-resumable')?.totalImages).toBe(3);
}

function resumableCheckpoint(id: string, total: number, completed: number, failed: number) {
  const checkpoint = createEmptyCheckpoint(id);
  Object.assign(checkpoint, { resumable: true, totalImages: total,
    completedImages: completed, failedImages: failed, outputPath: './downloads/example' });
  return checkpoint;
}

async function TaskManagerPersistenceTestShouldAllowInterruptedTasksToBeResumed() {
    const manager = new TaskManager(async () => { }, { eventBus, storage });
    managers.push(manager);
    await manager.initialize();
    await manager.createTask({
        id: 'task-4',
        url: 'https://example.com/comic/4',
        adapterId: 'kuronavi',
    });
    markInterrupted(manager, 'task-4');
    const resumed = await manager.resumeTask('task-4');
    expect(resumed).toBe(true);
    expect(manager.getTask('task-4')?.status).not.toBe('interrupted');
    expect(manager.getTaskResult('task-4')?.status).not.toBe('interrupted');
    expect(manager.getTaskResult('task-4')?.error).toBeUndefined();
}

function markInterrupted(manager: TaskManager, id: string): void {
  const record = (manager as any).records.get(id);
  if (!record) return;
  record.task.status = 'interrupted';
  record.result.status = 'interrupted';
  record.result.error = 'Task interrupted by server restart';
}

async function TaskManagerPersistenceTestShouldAllowCompletedTasksWithResumableCheckpointsToBeResumed() {
    const restartable = await createRestartableManager();
    const manager = restartable.manager;
    await manager.createTask({
        id: 'task-completed-partial',
        url: 'https://example.com/comic/partial',
        adapterId: 'kuronavi',
    });
    await flushAsyncWork();
    const checkpoint = resumableCheckpoint('task-completed-partial', 2, 1, 1);
    await manager.updateCheckpoint('task-completed-partial', checkpoint);
    markCompletedPartial(manager);
    const resumed = await manager.resumeTask('task-completed-partial');
    try {
        expectResumedPartial(manager, resumed);
    }
    finally {
        restartable.release();
    }
}

async function createRestartableManager() {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let runCount = 0;
  const manager = await createManager(async () => {
    runCount += 1;
    if (runCount > 1) await blocked;
  });
  return { manager, release };
}

function expectResumedPartial(manager: TaskManager, resumed: boolean): void {
  expect(resumed).toBe(true);
  expect(['pending', 'running']).toContain(manager.getTask('task-completed-partial')?.status);
  expect(manager.getTaskResult('task-completed-partial')).toMatchObject({
    status: 'pending', downloadedImages: 1, failedImages: 1,
  });
}

function markCompletedPartial(manager: TaskManager): void {
  const record = (manager as any).records.get('task-completed-partial');
  if (!record) return;
  record.task.status = 'completed';
  Object.assign(record.result, { status: 'completed', completedAt: new Date(),
    downloadedImages: 1, failedImages: 1, totalImages: 2 });
}
