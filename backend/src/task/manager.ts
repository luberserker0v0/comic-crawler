import type { TaskStatus, TaskItem } from './types';
import type { TaskProgress } from './progress';
import type { CrawlCheckpoint } from './checkpoint';
import type { EventBus } from '../events/bus';
import type { IStorage } from '../storage/types';
import { TaskQueue } from './queue';
import { ProgressTracker } from './progress';
import { ComicError, errorToLogObject } from '../error/types';

const TASK_INDEX_KEY = 'tasks/index';
const TASK_PRIORITY_ORDER_KEY = 'tasks/priority-order';

export interface TaskDefinition {
  id: string;
  url: string;
  adapterId: string;
  mode?: 'all' | 'chapters';
  chapters?: string[];
  chapterUrls?: string[];
  priority?: number;
  options?: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  metadata?: Record<string, unknown>;
  downloadedImages: number;
  failedImages: number;
  totalImages: number;
  outputPath?: string;
  error?: string;
  challengeDiscoveryId?: string;
  challengeStatus?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface PersistedTaskRecord {
  task: TaskItem<TaskDefinition>;
  result: TaskResult;
  progress?: TaskProgress;
  checkpoint?: CrawlCheckpoint;
}

export class TaskManager {
  private queue: TaskQueue<TaskDefinition>;
  private progress: ProgressTracker;
  private eventBus?: EventBus;
  private storage?: IStorage;
  private records = new Map<string, PersistedTaskRecord>();
  private priorityOrder: string[] = [];
  private taskExecutor: (task: TaskItem<TaskDefinition>) => Promise<void>;

  constructor(
    executor: (task: TaskItem<TaskDefinition>) => Promise<void>,
    options?: { concurrency?: number; eventBus?: EventBus; storage?: IStorage }
  ) {
    this.taskExecutor = executor;
    this.eventBus = options?.eventBus;
    this.storage = options?.storage;
    this.progress = new ProgressTracker(options?.eventBus);
    this.queue = new TaskQueue<TaskDefinition>(
      async (task) => {
        try {
          await this.taskExecutor(task);
          await this.markTaskCompleted(task.id);
        } catch (error) {
          if (await this.markTaskWaitingVerification(task.id, error)) {
            return;
          }
          await this.markTaskFailed(task.id, error);
          this.eventBus?.emit('task:failed', {
            taskId: task.id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
          throw error;
        }
      },
      { concurrency: options?.concurrency ?? 3 }
    );
    this.registerEventHandlers();
  }

  async initialize(): Promise<void> {
    if (!this.storage) return;

    const taskIds = (await this.storage.read<string[]>(TASK_INDEX_KEY)) ?? [];
    this.priorityOrder = (await this.storage.read<string[]>(TASK_PRIORITY_ORDER_KEY)) ?? [];
    this.queue.setPriorityOrder(this.priorityOrder);
    for (const taskId of taskIds) {
      const record = await this.storage.read<PersistedTaskRecord>(this.getTaskKey(taskId));
      if (!record) {
        continue;
      }

      let changed = false;
      let shouldRequeue = false;
      if (record.task.status === 'pending' || record.task.status === 'running' || record.task.status === 'paused') {
        if (record.checkpoint?.resumable) {
          record.task.status = 'pending';
          record.task.completedAt = undefined;
          record.task.error = undefined;
          record.result.status = 'pending';
          record.result.completedAt = undefined;
          record.result.error = undefined;
          record.result.downloadedImages = record.checkpoint.completedImages;
          record.result.failedImages = record.checkpoint.failedImages;
          record.result.totalImages = record.checkpoint.totalImages;
          if (record.checkpoint.metadata) {
            record.result.metadata = record.checkpoint.metadata as unknown as Record<string, unknown>;
          }
          if (record.checkpoint.outputPath) {
            record.result.outputPath = record.checkpoint.outputPath;
          }
          shouldRequeue = true;
        } else {
          record.task.status = 'interrupted';
          record.task.completedAt = record.task.completedAt ?? new Date();
          record.result.status = 'interrupted';
          record.result.completedAt = record.result.completedAt ?? new Date();
          record.result.error = record.result.error ?? 'Task interrupted by server restart';
        }
        changed = true;
      }

      this.records.set(taskId, record);
      if (record.progress) {
        this.progress.hydrate(record.progress);
      }

      if (changed) {
        await this.persistRecord(record);
      }
      if (shouldRequeue) {
        await this.queue.add(record.task);
      }
    }
  }

  async dispose(): Promise<void> {
    this.queue.stop();
    await this.queue.waitForIdle();
  }

  async createTask(definition: TaskDefinition): Promise<string> {
    const now = new Date();
    const taskItem: TaskItem<TaskDefinition> = {
      id: definition.id,
      data: definition,
      status: 'pending',
      priority: definition.priority ?? 0,
      createdAt: now,
    };

    const record: PersistedTaskRecord = {
      task: taskItem,
      result: {
        taskId: definition.id,
        status: 'pending',
        downloadedImages: 0,
        failedImages: 0,
        totalImages: 0,
      },
    };

    this.records.set(definition.id, record);
    await this.persistRecord(record);
    await this.queue.add(taskItem);
    this.eventBus?.emit('task:created', { taskId: definition.id, url: definition.url });

    return definition.id;
  }

  async pauseTask(taskId: string): Promise<boolean> {
    const task = this.queue.get(taskId);
    if (!task) return false;

    if (task.status === 'running') {
      task.status = 'paused';
      task.completedAt = undefined;
      await this.updateTaskRecord(taskId, {
        task: {
          status: 'paused',
        },
        result: {
          status: 'paused',
        },
      });
      this.eventBus?.emit('task:paused', { taskId });
      return true;
    }

    return false;
  }

  async resumeTask(taskId: string): Promise<boolean> {
    const task = this.queue.get(taskId) ?? this.records.get(taskId)?.task;
    if (!task || (task.status !== 'paused' && task.status !== 'interrupted' && task.status !== 'waiting_verification' && task.status !== 'failed')) return false;

    task.status = 'pending';
    const checkpoint = this.records.get(taskId)?.checkpoint;
    await this.updateTaskRecord(taskId, {
      task: {
        status: 'pending',
        completedAt: undefined,
        error: undefined,
      },
      result: {
        status: 'pending',
        completedAt: undefined,
        error: undefined,
        downloadedImages: checkpoint?.completedImages ?? 0,
        failedImages: checkpoint?.failedImages ?? 0,
        totalImages: checkpoint?.totalImages ?? 0,
        ...(checkpoint?.metadata ? { metadata: checkpoint.metadata as unknown as Record<string, unknown> } : {}),
        ...(checkpoint?.outputPath ? { outputPath: checkpoint.outputPath } : {}),
      },
    });
    await this.queue.add(task);
    this.eventBus?.emit('task:resumed', { taskId });
    return true;
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const cancelled = this.queue.cancel(taskId);
    if (cancelled) {
      await this.updateTaskRecord(taskId, {
        task: {
          status: 'cancelled',
          completedAt: new Date(),
        },
        result: {
          status: 'cancelled',
          completedAt: new Date(),
        },
      });
      this.eventBus?.emit('task:cancelled', { taskId });
    }
    return cancelled;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const record = this.records.get(taskId);
    if (!record) {
      return false;
    }

    const activeStatuses: TaskStatus[] = ['pending', 'running', 'paused'];
    if (activeStatuses.includes(record.task.status)) {
      return false;
    }

    this.queue.remove(taskId);
    this.records.delete(taskId);
    this.progress.remove(taskId);

    if (this.storage) {
      const currentIndex = (await this.storage.read<string[]>(TASK_INDEX_KEY)) ?? [];
      const nextIndex = currentIndex.filter((id) => id !== taskId);
      const nextPriorityOrder = this.priorityOrder.filter((id) => id !== taskId);
      this.priorityOrder = nextPriorityOrder;
      this.queue.setPriorityOrder(nextPriorityOrder);
      await this.storage.write(TASK_INDEX_KEY, nextIndex);
      await this.storage.write(TASK_PRIORITY_ORDER_KEY, nextPriorityOrder);
      await this.storage.delete(this.getTaskKey(taskId));
    }

    return true;
  }

  getTask(taskId: string): TaskItem<TaskDefinition> | undefined {
    return this.records.get(taskId)?.task;
  }

  getTaskResult(taskId: string): TaskResult | undefined {
    return this.records.get(taskId)?.result;
  }

  getAllTasks(): TaskItem<TaskDefinition>[] {
    return Array.from(this.records.values()).map((record) => record.task);
  }

  getProgress(taskId: string): TaskProgress | undefined {
    return this.progress.get(taskId);
  }

  getCheckpoint(taskId: string): CrawlCheckpoint | undefined {
    return this.records.get(taskId)?.checkpoint;
  }

  getStats() {
    const tasks = this.getAllTasks();
    return {
      total: tasks.length,
      pending: tasks.filter((task) => task.status === 'pending').length,
      running: tasks.filter((task) => task.status === 'running').length,
      waitingVerification: tasks.filter((task) => task.status === 'waiting_verification').length,
      interrupted: tasks.filter((task) => task.status === 'interrupted').length,
      completed: tasks.filter((task) => task.status === 'completed').length,
      failed: tasks.filter((task) => task.status === 'failed').length,
      cancelled: tasks.filter((task) => task.status === 'cancelled').length,
    };
  }

  getPriorityOrder(): string[] {
    return this.priorityOrder;
  }

  async setPriorityOrder(taskIds: string[]): Promise<string[]> {
    const unique = Array.from(new Set(taskIds.map((id) => id.trim()).filter(Boolean)));
    this.priorityOrder = unique;
    this.queue.setPriorityOrder(unique);
    if (this.storage) {
      await this.storage.write(TASK_PRIORITY_ORDER_KEY, unique);
    }
    return unique;
  }

  async updateResult(taskId: string, updates: Partial<TaskResult>): Promise<void> {
    await this.updateTaskRecord(taskId, {
      result: updates,
    });
  }

  async updateCheckpoint(taskId: string, checkpoint: CrawlCheckpoint): Promise<void> {
    await this.updateTaskRecord(taskId, {
      checkpoint,
      result: {
        downloadedImages: checkpoint.completedImages,
        failedImages: checkpoint.failedImages,
        totalImages: checkpoint.totalImages,
        ...(checkpoint.metadata ? { metadata: checkpoint.metadata as unknown as Record<string, unknown> } : {}),
        ...(checkpoint.outputPath ? { outputPath: checkpoint.outputPath } : {}),
        error: checkpoint.lastError,
      },
    });
  }

  async updateTaskError(taskId: string, error?: string): Promise<void> {
    await this.updateTaskRecord(taskId, {
      task: { error },
      result: { error },
    });
  }

  getProgressTracker(): ProgressTracker {
    return this.progress;
  }

  private registerEventHandlers(): void {
    if (!this.eventBus) return;

    this.eventBus.on('task:started', async ({ taskId }) => {
      await this.updateTaskRecord(taskId, {
        task: {
          status: 'running',
          startedAt: new Date(),
          completedAt: undefined,
        },
        result: {
          status: 'running',
          startedAt: new Date(),
          completedAt: undefined,
        },
      });
    });

    this.eventBus.on('task:progress', async ({ taskId, progress }) => {
      const existingProgress = this.progress.get(taskId);
      const now = new Date();
      const snapshot: TaskProgress = {
        taskId,
        totalItems: progress.totalImages,
        completedItems: progress.completedImages,
        failedItems: progress.failedImages,
        currentItems: progress.currentChapter,
        percentage: progress.totalImages > 0 ? Math.round((progress.completedImages / progress.totalImages) * 100) : 0,
        startedAt: existingProgress?.startedAt ?? now,
        updatedAt: now,
        estimatedRemaining: existingProgress?.estimatedRemaining,
      };

      this.progress.hydrate(snapshot);
      await this.updateTaskRecord(taskId, {
        progress: snapshot,
        result: {
          ...(progress.metadata ? { metadata: progress.metadata as Record<string, unknown> } : {}),
          ...(progress.outputPath ? { outputPath: progress.outputPath } : {}),
        },
      });
    });

    this.eventBus.on('task:completed', async ({ taskId, result }) => {
      await this.markTaskCompleted(taskId, result as Partial<TaskResult> | undefined);
    });

    this.eventBus.on('task:failed', async ({ taskId, error }) => {
      await this.markTaskFailed(taskId, error);
    });
  }

  private async markTaskWaitingVerification(taskId: string, error: unknown): Promise<boolean> {
    const existing = this.records.get(taskId);
    const message = errorToLogObject(error).message as string;
    const existingChallengeDiscoveryId = typeof existing?.result.challengeDiscoveryId === 'string'
      ? existing.result.challengeDiscoveryId
      : undefined;
    const challengeDiscoveryId = error instanceof ComicError && typeof error.context.challengeDiscoveryId === 'string'
      ? error.context.challengeDiscoveryId
      : existingChallengeDiscoveryId;
    if (!challengeDiscoveryId) {
      return false;
    }

    const shouldWait = error instanceof ComicError
      ? hasWaitingVerificationContext(error.context) || /human verification|challenge|cloudflare|anti-bot|browser profile/i.test(message)
      : /human verification|challenge|cloudflare|anti-bot|browser profile/i.test(message);
    if (!shouldWait) {
      return false;
    }

    const challengeStatus = error instanceof ComicError && typeof error.context.challengeStatus === 'string'
      ? error.context.challengeStatus
      : typeof existing?.result.challengeStatus === 'string'
        ? existing.result.challengeStatus
        : undefined;
    await this.updateTaskRecord(taskId, {
      task: {
        status: 'waiting_verification',
        completedAt: undefined,
        error: message,
      },
      result: {
        status: 'waiting_verification',
        completedAt: undefined,
        error: message,
        challengeDiscoveryId,
        challengeStatus,
      },
    });
    this.eventBus?.emit('task:waiting_verification', {
      taskId,
      challengeDiscoveryId,
      challengeStatus,
      message,
    });
    return true;
  }

  private async markTaskCompleted(taskId: string, result?: Partial<TaskResult>): Promise<void> {
    await this.updateTaskRecord(taskId, {
      task: {
        status: 'completed',
        completedAt: new Date(),
      },
      result: {
        status: 'completed',
        completedAt: new Date(),
        ...(result ?? {}),
      },
    });
  }

  private async markTaskFailed(taskId: string, error: unknown): Promise<void> {
    const message = errorToLogObject(error).message as string;
    const challengeDiscoveryId = error instanceof ComicError && typeof error.context.challengeDiscoveryId === 'string'
      ? error.context.challengeDiscoveryId
      : undefined;
    const challengeStatus = error instanceof ComicError && typeof error.context.challengeStatus === 'string'
      ? error.context.challengeStatus
      : undefined;
    await this.updateTaskRecord(taskId, {
      task: {
        status: 'failed',
        completedAt: new Date(),
        error: message,
      },
      result: {
        status: 'failed',
        completedAt: new Date(),
        error: message,
        challengeDiscoveryId,
        challengeStatus,
      },
    });
  }

  private async updateTaskRecord(
    taskId: string,
    updates: {
      task?: Partial<TaskItem<TaskDefinition>>;
      result?: Partial<TaskResult>;
      progress?: TaskProgress;
      checkpoint?: CrawlCheckpoint;
    }
  ): Promise<void> {
    const record = this.records.get(taskId);
    if (!record) return;

    if (updates.task) {
      Object.assign(record.task, updates.task);
    }

    if (updates.result) {
      Object.assign(record.result, updates.result);
    }

    if (updates.progress) {
      record.progress = updates.progress;
    }

    if (updates.checkpoint) {
      record.checkpoint = updates.checkpoint;
    }

    await this.persistRecord(record);
  }

  private async persistRecord(record: PersistedTaskRecord): Promise<void> {
    if (!this.storage) return;

    const currentIndex = (await this.storage.read<string[]>(TASK_INDEX_KEY)) ?? [];
    if (!currentIndex.includes(record.task.id)) {
      currentIndex.push(record.task.id);
      await this.storage.write(TASK_INDEX_KEY, currentIndex);
    }

    await this.storage.write(this.getTaskKey(record.task.id), record);
  }

  private getTaskKey(taskId: string): string {
    return `tasks/${taskId}`;
  }
}

function hasWaitingVerificationContext(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  if (
    context.antiBotChallenge === true ||
    context.humanVerificationProfileUnavailable === true ||
    typeof context.challengeDiscoveryId === 'string'
  ) return true;
  return Object.values(context).some((entry) => hasWaitingVerificationContext(entry));
}
