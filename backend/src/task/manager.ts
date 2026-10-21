import type { TaskStatus, TaskItem } from './types';
import type { TaskProgress } from './progress';
import type { CrawlCheckpoint } from './checkpoint';
import type { EventBus } from '../events/bus';
import type { EventMap } from '../events/types';
import type { IStorage } from '../storage/types';
import { TaskDeferredError, TaskScheduler } from '../scheduler';
import { ProgressTracker } from './progress';
import { ComicError, errorToLogObject } from '../error/types';
import { deleteTaskOutputDir, hasWaitingVerificationContext } from './file-utils';
import type {
  BrowserTarget as SharedBrowserTarget,
  ExistingTabBrowserTarget,
  TaskBrowserTargetReboundEvent,
} from '@comiccrawler/shared';

const TASK_INDEX_KEY = 'tasks/index';
const TASK_PRIORITY_ORDER_KEY = 'tasks/priority-order';

export interface DeleteTaskOptions {
  deleteFiles?: boolean;
  downloadDir?: string;
}

export interface DeleteTaskResult {
  deleted: boolean;
  filesDeleted: boolean;
  filesSkipped?: string;
}

export interface TaskDefinition {
  id: string;
  url: string;
  adapterId: string;
  mode?: 'all' | 'chapters';
  chapters?: string[];
  chapterUrls?: string[];
  priority?: number;
  options?: Record<string, unknown>;
  ownerUserId?: string;
  browserTarget?: BrowserTarget;
  browserTargetUrl?: string;
  browserWaitStartedAt?: string;
}

export type BrowserTarget = SharedBrowserTarget;

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
  events?: TaskBrowserTargetReboundEvent[];
}

export class BrowserTargetRebindError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_STATE' | 'STALE_TARGET' | 'INVALID_TARGET'
  ) {
    super(message);
    this.name = 'BrowserTargetRebindError';
  }
}

export interface RebindBrowserTargetResult {
  task: TaskItem<TaskDefinition>;
  event: TaskBrowserTargetReboundEvent;
  idempotent: boolean;
}

interface RebindBrowserTargetInput {
  taskId: string;
  ownerUserId: string;
  expectedBrowserTarget: ExistingTabBrowserTarget;
  browserTarget: ExistingTabBrowserTarget;
  browserTargetUrl: string;
}

interface TaskRecordUpdates {
  task?: Partial<TaskItem<TaskDefinition>>;
  result?: Partial<TaskResult>;
  progress?: TaskProgress;
  checkpoint?: CrawlCheckpoint;
}

export class TaskManager {
  private scheduler: TaskScheduler<TaskDefinition>;
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
    this.scheduler = new TaskScheduler<TaskDefinition>(
      (task) => this.executeScheduledTask(task), { concurrency: options?.concurrency ?? 3 });
    this.registerEventHandlers();
  }

  private async executeScheduledTask(task: TaskItem<TaskDefinition>): Promise<void> {
    try {
      await this.taskExecutor(task);
      await this.markTaskCompleted(task.id);
    } catch (error) {
      if (error instanceof TaskDeferredError) throw error;
      if (await this.markTaskWaitingVerification(task.id, error)) return;
      await this.markTaskFailed(task.id, error);
      this.eventBus?.emit('task:failed', { taskId: task.id,
        error: error instanceof Error ? error : new Error(String(error)) });
      throw error;
    }
  }

  async initialize(): Promise<void> {
    if (!this.storage) return;
    const taskIds = (await this.storage.read<string[]>(TASK_INDEX_KEY)) ?? [];
    this.priorityOrder = (await this.storage.read<string[]>(TASK_PRIORITY_ORDER_KEY)) ?? [];
    this.scheduler.setPriorityOrder(this.priorityOrder);
    for (const taskId of taskIds) {
      const record = await this.storage.read<PersistedTaskRecord>(this.getTaskKey(taskId));
      if (record) await this.restoreRecord(taskId, record);
    }
  }

  private async restoreRecord(taskId: string, record: PersistedTaskRecord): Promise<void> {
    const recoverable = isStartupActiveStatus(record.task.status);
    const shouldRequeue = recoverable && record.checkpoint?.resumable === true;
    if (shouldRequeue) resetRecordForResume(record);
    else if (recoverable) interruptRecord(record);
    this.records.set(taskId, record);
    if (record.progress) this.progress.hydrate(record.progress);
    if (recoverable) await this.persistRecord(record);
    if (shouldRequeue) await this.scheduler.add(record.task);
  }

  async dispose(): Promise<void> {
    this.scheduler.stop();
    await this.scheduler.waitForIdle();
  }

  async createTask(definition: TaskDefinition): Promise<string> {
    const record = createTaskRecord(definition);
    this.records.set(definition.id, record);
    await this.persistRecord(record);
    await this.scheduler.add(record.task);
    this.eventBus?.emit('task:created', { taskId: definition.id, url: definition.url });
    return definition.id;
  }

  async pauseTask(taskId: string): Promise<boolean> {
    const task = this.scheduler.get(taskId);
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
    const task = this.scheduler.get(taskId) ?? this.records.get(taskId)?.task;
    const checkpoint = this.records.get(taskId)?.checkpoint;
    if (!task || !canResumeTask(task.status, checkpoint)) return false;
    task.status = 'pending';
    await this.updateTaskRecord(taskId, createResumeUpdates(checkpoint));
    await this.scheduler.add(task);
    this.eventBus?.emit('task:resumed', { taskId });
    return true;
  }

  async cancelTask(taskId: string): Promise<boolean> {
    let cancelled = this.scheduler.cancel(taskId);
    const record = this.records.get(taskId);
    if (!cancelled && record?.task.status === 'waiting_verification') cancelled = true;
    if (!cancelled) return false;
    const completedAt = new Date();
    await this.updateTaskRecord(taskId, { task: { status: 'cancelled', completedAt },
      result: { status: 'cancelled', completedAt } });
    this.eventBus?.emit('task:cancelled', { taskId });
    return cancelled;
  }

  async deleteTask(taskId: string, options?: DeleteTaskOptions): Promise<boolean> {
    const result = await this.deleteTaskWithFiles(taskId, options);
    return result.deleted;
  }

  async deleteTaskWithFiles(taskId: string, options?: DeleteTaskOptions): Promise<DeleteTaskResult> {
    const record = this.records.get(taskId);
    if (!record) return { deleted: false, filesDeleted: false };
    const activeStatuses: TaskStatus[] = ['pending', 'running', 'paused', 'waiting_for_browser_worker'];
    if (activeStatuses.includes(record.task.status)) return { deleted: false, filesDeleted: false };
    const files = await deleteRecordFiles(record, options);
    this.scheduler.remove(taskId);
    this.records.delete(taskId);
    this.progress.remove(taskId);
    await this.deletePersistedRecord(taskId);
    return { deleted: true, filesDeleted: files.deleted,
      ...(files.skipped ? { filesSkipped: files.skipped } : {}) };
  }

  private async deletePersistedRecord(taskId: string): Promise<void> {
    if (!this.storage) return;
    const currentIndex = (await this.storage.read<string[]>(TASK_INDEX_KEY)) ?? [];
    const nextOrder = this.priorityOrder.filter((id) => id !== taskId);
    this.priorityOrder = nextOrder;
    this.scheduler.setPriorityOrder(nextOrder);
    await this.storage.write(TASK_INDEX_KEY, currentIndex.filter((id) => id !== taskId));
    await this.storage.write(TASK_PRIORITY_ORDER_KEY, nextOrder);
    await this.storage.delete(this.getTaskKey(taskId));
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

  getEvents(taskId: string): TaskBrowserTargetReboundEvent[] {
    return [...(this.records.get(taskId)?.events ?? [])];
  }

  async rebindBrowserTarget(input: RebindBrowserTargetInput): Promise<RebindBrowserTargetResult> {
    const record = requireRebindRecord(this.records, input);
    const idempotent = findIdempotentRebind(record, input);
    if (idempotent) return { task: record.task, event: idempotent, idempotent: true };
    const currentTarget = validateCurrentRebindTarget(record, input);
    const previousStatus = record.task.status;
    const event = createRebindEvent(record, currentTarget, input.browserTarget);
    applyRebind(record, input, event);
    await this.persistRecord(record);
    if (previousStatus === 'interrupted' || previousStatus === 'failed')
      await this.scheduler.add(record.task);
    this.eventBus?.emit('task:browser_target_rebound', { taskId: input.taskId, event });
    return { task: record.task, event, idempotent: false };
  }

  getStats() {
    const tasks = this.getAllTasks();
    return {
      total: tasks.length,
      pending: tasks.filter((task) => task.status === 'pending').length,
      running: tasks.filter((task) => task.status === 'running').length,
      waitingForBrowserWorker: tasks.filter((task) => task.status === 'waiting_for_browser_worker').length,
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
    this.scheduler.setPriorityOrder(unique);
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

  async markWaitingForBrowserWorker(taskId: string, message: string): Promise<void> {
    const record = this.records.get(taskId);
    if (!record) return;
    record.task.data.browserWaitStartedAt ??= new Date().toISOString();
    await this.updateTaskRecord(taskId, {
      task: { status: 'waiting_for_browser_worker', completedAt: undefined, error: message },
      result: { status: 'waiting_for_browser_worker', completedAt: undefined, error: message },
    });
    this.eventBus?.emit('task:waiting_for_browser_worker', { taskId, message });
  }

  async markBrowserWorkerAcquired(taskId: string): Promise<void> {
    const record = this.records.get(taskId);
    if (!record) return;
    delete record.task.data.browserWaitStartedAt;
    record.task.error = undefined;
    record.result.error = undefined;
    await this.persistRecord(record);
  }

  getProgressTracker(): ProgressTracker {
    return this.progress;
  }

  private registerEventHandlers(): void {
    if (!this.eventBus) return;
    this.eventBus.on('task:started', ({ taskId }) => this.handleTaskStarted(taskId));
    this.eventBus.on('task:progress', (event) => this.handleTaskProgress(event));
    this.eventBus.on('task:completed', ({ taskId, result }) =>
      this.markTaskCompleted(taskId, result as Partial<TaskResult> | undefined));
    this.eventBus.on('task:failed', ({ taskId, error }) => this.markTaskFailed(taskId, error));
  }

  private async handleTaskStarted(taskId: string): Promise<void> {
    const startedAt = new Date();
    await this.updateTaskRecord(taskId, {
      task: { status: 'running', startedAt, completedAt: undefined },
      result: { status: 'running', startedAt, completedAt: undefined },
    });
  }

  private async handleTaskProgress({ taskId, progress }: EventMap['task:progress']): Promise<void> {
    const snapshot = createProgressSnapshot(taskId, progress, this.progress.get(taskId));
    this.progress.hydrate(snapshot);
    await this.updateTaskRecord(taskId, { progress: snapshot, result: {
      ...(progress.metadata ? { metadata: progress.metadata as Record<string, unknown> } : {}),
      ...(progress.outputPath ? { outputPath: progress.outputPath } : {}) } });
  }

  private async markTaskWaitingVerification(taskId: string, error: unknown): Promise<boolean> {
    const existing = this.records.get(taskId);
    const message = errorToLogObject(error).message as string;
    const challengeDiscoveryId = challengeContextValue(error, existing, 'challengeDiscoveryId');
    if (!challengeDiscoveryId || !shouldWaitForVerification(error, message)) return false;
    const challengeStatus = challengeContextValue(error, existing, 'challengeStatus');
    await this.updateTaskRecord(taskId, {
      task: { status: 'waiting_verification', completedAt: undefined, error: message },
      result: { status: 'waiting_verification', completedAt: undefined, error: message,
        challengeDiscoveryId, challengeStatus },
    });
    this.eventBus?.emit('task:waiting_verification', { taskId, challengeDiscoveryId, challengeStatus, message });
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
    const context = error instanceof ComicError ? error.context : {};
    const challengeDiscoveryId = stringValue(context.challengeDiscoveryId);
    const challengeStatus = stringValue(context.challengeStatus);
    const completedAt = new Date();
    await this.updateTaskRecord(taskId, {
      task: { status: 'failed', completedAt, error: message },
      result: { status: 'failed', completedAt, error: message, challengeDiscoveryId, challengeStatus },
    });
  }

  private async updateTaskRecord(
    taskId: string,
    updates: TaskRecordUpdates
  ): Promise<void> {
    const record = this.records.get(taskId);
    if (!record) return;
    applyRecordUpdates(record, updates);
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

function createTaskRecord(definition: TaskDefinition): PersistedTaskRecord {
  const task: TaskItem<TaskDefinition> = { id: definition.id, data: definition,
    status: 'pending', priority: definition.priority ?? 0, createdAt: new Date() };
  return { task, result: { taskId: definition.id, status: 'pending',
    downloadedImages: 0, failedImages: 0, totalImages: 0 } };
}

function isStartupActiveStatus(status: TaskStatus): boolean {
  return ['pending', 'running', 'paused', 'waiting_for_browser_worker'].includes(status);
}

function resetRecordForResume(record: PersistedTaskRecord): void {
  const checkpoint = record.checkpoint!;
  Object.assign(record.task, { status: 'pending', completedAt: undefined, error: undefined });
  Object.assign(record.result, { status: 'pending', completedAt: undefined, error: undefined,
    downloadedImages: checkpoint.completedImages, failedImages: checkpoint.failedImages,
    totalImages: checkpoint.totalImages,
    ...(checkpoint.metadata ? { metadata: checkpoint.metadata as unknown as Record<string, unknown> } : {}),
    ...(checkpoint.outputPath ? { outputPath: checkpoint.outputPath } : {}) });
}

function interruptRecord(record: PersistedTaskRecord): void {
  const completedAt = record.task.completedAt ?? new Date();
  Object.assign(record.task, { status: 'interrupted', completedAt });
  Object.assign(record.result, { status: 'interrupted',
    completedAt: record.result.completedAt ?? completedAt,
    error: record.result.error ?? 'Task interrupted by server restart' });
}

function canResumeTask(status: TaskStatus, checkpoint?: CrawlCheckpoint): boolean {
  return ['paused', 'interrupted', 'waiting_verification', 'failed'].includes(status)
    || status === 'completed' && checkpoint?.resumable === true;
}

function createResumeUpdates(checkpoint?: CrawlCheckpoint): TaskRecordUpdates {
  return { task: { status: 'pending', completedAt: undefined, error: undefined }, result: {
    status: 'pending', completedAt: undefined, error: undefined,
    downloadedImages: checkpoint?.completedImages ?? 0, failedImages: checkpoint?.failedImages ?? 0,
    totalImages: checkpoint?.totalImages ?? 0,
    ...(checkpoint?.metadata ? { metadata: checkpoint.metadata as unknown as Record<string, unknown> } : {}),
    ...(checkpoint?.outputPath ? { outputPath: checkpoint.outputPath } : {}) } };
}

async function deleteRecordFiles(record: PersistedTaskRecord, options?: DeleteTaskOptions) {
  if (!options?.deleteFiles || !record.result.outputPath) return { deleted: false, skipped: undefined };
  return deleteTaskOutputDir(record.result.outputPath, options.downloadDir);
}

function requireRebindRecord(
  records: Map<string, PersistedTaskRecord>, input: RebindBrowserTargetInput
): PersistedTaskRecord {
  const record = records.get(input.taskId);
  if (!record) throw new BrowserTargetRebindError(`Task "${input.taskId}" was not found.`, 'NOT_FOUND');
  if ((record.task.data.ownerUserId ?? 'public') !== input.ownerUserId)
    throw new BrowserTargetRebindError('The authenticated user does not own this task.', 'FORBIDDEN');
  if (sameBrowserTarget(input.expectedBrowserTarget, input.browserTarget))
    throw new BrowserTargetRebindError('The replacement Browser Target must differ from the expected target.', 'INVALID_TARGET');
  return record;
}

function findIdempotentRebind(record: PersistedTaskRecord, input: RebindBrowserTargetInput) {
  if (record.task.data.browserTarget?.mode !== 'existing-tab'
    || !sameBrowserTarget(record.task.data.browserTarget, input.browserTarget)) return undefined;
  return [...(record.events ?? [])].reverse().find((event) =>
    sameBrowserTarget(event.previousBrowserTarget, input.expectedBrowserTarget)
    && sameBrowserTarget(event.browserTarget, input.browserTarget));
}

function validateCurrentRebindTarget(
  record: PersistedTaskRecord, input: RebindBrowserTargetInput
): ExistingTabBrowserTarget {
  const target = record.task.data.browserTarget;
  if (target?.mode !== 'existing-tab')
    throw new BrowserTargetRebindError('Only existing-tab tasks can rebind their Browser Target.', 'INVALID_TARGET');
  if (!sameBrowserTarget(target, input.expectedBrowserTarget))
    throw new BrowserTargetRebindError('The task Browser Target changed after it was inspected.', 'STALE_TARGET');
  if (!isRecoverableBrowserTargetState(record.task.status, record.task.error ?? record.result.error))
    throw new BrowserTargetRebindError(
      `Task status "${record.task.status}" does not allow Browser Target recovery.`, 'INVALID_STATE');
  return target;
}

function createRebindEvent(
  record: PersistedTaskRecord, previous: ExistingTabBrowserTarget, target: ExistingTabBrowserTarget
): TaskBrowserTargetReboundEvent {
  const reboundAt = new Date().toISOString();
  return { type: 'task:browser_target_rebound', occurredAt: reboundAt,
    previousBrowserTarget: { ...previous }, browserTarget: { ...target }, previousStatus: record.task.status,
    ...(record.task.error ? { previousTaskError: record.task.error } : {}),
    ...(record.result.error ? { previousResultError: record.result.error } : {}),
    recovery: { reason: 'browser_client_process_restarted', reboundAt } };
}

function applyRebind(
  record: PersistedTaskRecord, input: RebindBrowserTargetInput, event: TaskBrowserTargetReboundEvent
): void {
  record.task.data.browserTarget = { ...input.browserTarget };
  record.task.data.browserTargetUrl = input.browserTargetUrl;
  delete record.task.data.browserWaitStartedAt;
  record.events = [...(record.events ?? []), event];
  if (record.task.status === 'waiting_verification') return;
  Object.assign(record.task, { status: 'pending', completedAt: undefined, error: undefined });
  Object.assign(record.result, { status: 'pending', completedAt: undefined, error: undefined });
}

function createProgressSnapshot(
  taskId: string, progress: EventMap['task:progress']['progress'], existing?: TaskProgress
): TaskProgress {
  const now = new Date();
  return { taskId, totalItems: progress.totalImages, completedItems: progress.completedImages,
    failedItems: progress.failedImages, currentItems: progress.currentChapter, stage: progress.stage,
    stageDetail: progress.stageDetail, metadata: progress.metadata,
    chapterListSummary: progress.chapterListSummary,
    percentage: progress.totalImages > 0 ? Math.round(progress.completedImages / progress.totalImages * 100) : 0,
    startedAt: existing?.startedAt ?? now, updatedAt: now,
    estimatedRemaining: existing?.estimatedRemaining };
}

function challengeContextValue(
  error: unknown, record: PersistedTaskRecord | undefined,
  key: 'challengeDiscoveryId' | 'challengeStatus'
): string | undefined {
  const errorValue = error instanceof ComicError ? stringValue(error.context[key]) : undefined;
  return errorValue ?? stringValue(record?.result[key]);
}

function shouldWaitForVerification(error: unknown, message: string): boolean {
  const matches = /human verification|challenge|cloudflare|anti-bot/i.test(message);
  return error instanceof ComicError ? hasWaitingVerificationContext(error.context) || matches : matches;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function applyRecordUpdates(record: PersistedTaskRecord, updates: TaskRecordUpdates): void {
  if (updates.task) Object.assign(record.task, updates.task);
  if (updates.result) Object.assign(record.result, updates.result);
  if (updates.progress) record.progress = updates.progress;
  if (updates.checkpoint) record.checkpoint = updates.checkpoint;
}

function sameBrowserTarget(left: ExistingTabBrowserTarget, right: ExistingTabBrowserTarget): boolean {
  return left.mode === right.mode
    && left.workerId === right.workerId
    && left.resourceId === right.resourceId;
}

function isRecoverableBrowserTargetState(status: TaskStatus, error: string | undefined): boolean {
  if (status === 'waiting_for_browser_worker' || status === 'interrupted' || status === 'waiting_verification') {
    return true;
  }
  return status === 'failed' && /browser (worker|resource|session).*(offline|disconnect|not found|closed|lost|restart)/i.test(error ?? '');
}
