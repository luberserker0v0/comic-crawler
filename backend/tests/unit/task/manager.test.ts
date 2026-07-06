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

async function waitForPersistedRecord(
  storage: JsonFileStore,
  taskId: string,
  predicate: (record: any) => boolean,
  attempts = 20
): Promise<any> {
  for (let index = 0; index < attempts; index++) {
    const record = await storage.read<any>(`tasks/${taskId}`);
    if (record && predicate(record)) {
      return record;
    }

    await flushAsyncWork();
  }

  return storage.read<any>(`tasks/${taskId}`);
}

describe('TaskManager persistence', () => {
  let storage: JsonFileStore;
  let eventBus: EventBus;
  const managers: TaskManager[] = [];
  const extraStores: JsonFileStore[] = [];

  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });
    eventBus = new EventBus();
    storage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
    await storage.initialize();
  });

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.dispose().catch(() => undefined)));
    await Promise.all(extraStores.splice(0).map((store) => store.dispose().catch(() => undefined)));
    await storage.dispose().catch(() => undefined);
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('should persist created task records', async () => {
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
  });

  it('should persist progress snapshots and completion result', async () => {
    const manager = new TaskManager(async () => {}, { eventBus, storage });
    managers.push(manager);
    await manager.initialize();

    await manager.createTask({
      id: 'task-2',
      url: 'https://example.com/comic/2',
      adapterId: 'kuronavi',
    });

    eventBus.emit('task:started', { taskId: 'task-2' });
    eventBus.emit('task:progress', {
      taskId: 'task-2',
      progress: {
        totalImages: 12,
        completedImages: 4,
        failedImages: 1,
        currentChapter: 'chapter-1',
      },
    });
    eventBus.emit('task:completed', {
      taskId: 'task-2',
      result: {
        metadata: { title: 'Example' },
        downloadedImages: 11,
        failedImages: 1,
        totalImages: 12,
        outputPath: './downloads',
      },
    });
    await flushAsyncWork();
    const persisted = await waitForPersistedRecord(storage, 'task-2', (record) =>
      Boolean(record.progress && record.result?.status === 'completed')
    );
    expect(persisted.progress.totalItems).toBe(12);
    expect(persisted.progress.completedItems).toBe(4);
    expect(persisted.result.status).toBe('completed');
    expect(persisted.result.outputPath).toBe('./downloads');
  });

  it('should convert unfinished tasks to interrupted on restart', async () => {
    const firstManager = new TaskManager(async () => {}, { eventBus, storage });
    managers.push(firstManager);
    await firstManager.initialize();

    await firstManager.createTask({
      id: 'task-3',
      url: 'https://example.com/comic/3',
      adapterId: 'kuronavi',
    });

    eventBus.emit('task:started', { taskId: 'task-3' });
    await flushAsyncWork();
    const persistedBeforeRestart = await waitForPersistedRecord(storage, 'task-3', (record) =>
      record?.task?.status === 'running'
    );
    expect(persistedBeforeRestart?.task?.status).toBe('running');

    const reloadedStorage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
    extraStores.push(reloadedStorage);
    await reloadedStorage.initialize();
    const secondManager = new TaskManager(async () => {}, { eventBus: new EventBus(), storage: reloadedStorage });
    managers.push(secondManager);
    await secondManager.initialize();

    expect(secondManager.getTask('task-3')?.status).toBe('interrupted');
    expect(secondManager.getTaskResult('task-3')?.status).toBe('interrupted');
  });

  it('should requeue unfinished resumable tasks from checkpoint on restart', async () => {
    const firstManager = new TaskManager(async () => {}, { eventBus, storage });
    managers.push(firstManager);
    await firstManager.initialize();

    await firstManager.createTask({
      id: 'task-resumable',
      url: 'https://example.com/comic/resumable',
      adapterId: 'kuronavi',
    });

    const checkpoint = createEmptyCheckpoint('task-resumable');
    checkpoint.resumable = true;
    checkpoint.totalImages = 3;
    checkpoint.completedImages = 1;
    checkpoint.failedImages = 0;
    checkpoint.outputPath = './downloads/example';
    await firstManager.updateCheckpoint('task-resumable', checkpoint);
    eventBus.emit('task:started', { taskId: 'task-resumable' });
    await flushAsyncWork();
    const reloadedStorage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
    extraStores.push(reloadedStorage);
    await reloadedStorage.initialize();
    const secondManager = new TaskManager(async () => {}, { eventBus: new EventBus(), storage: reloadedStorage });
    managers.push(secondManager);
    await secondManager.initialize();

    expect(secondManager.getTask('task-resumable')?.status).not.toBe('interrupted');
    expect(secondManager.getTaskResult('task-resumable')?.status).not.toBe('interrupted');
    expect(secondManager.getTaskResult('task-resumable')?.downloadedImages).toBe(1);
    expect(secondManager.getTaskResult('task-resumable')?.totalImages).toBe(3);
  });

  it('should allow interrupted tasks to be resumed', async () => {
    const manager = new TaskManager(async () => {}, { eventBus, storage });
    managers.push(manager);
    await manager.initialize();

    await manager.createTask({
      id: 'task-4',
      url: 'https://example.com/comic/4',
      adapterId: 'kuronavi',
    });

    const internalRecord = (manager as any).records.get('task-4');
    if (internalRecord) {
      internalRecord.task.status = 'interrupted';
      internalRecord.result.status = 'interrupted';
      internalRecord.result.error = 'Task interrupted by server restart';
    }

    const resumed = await manager.resumeTask('task-4');

    expect(resumed).toBe(true);
    expect(manager.getTask('task-4')?.status).not.toBe('interrupted');
    expect(manager.getTaskResult('task-4')?.status).not.toBe('interrupted');
    expect(manager.getTaskResult('task-4')?.error).toBeUndefined();
  });
});
