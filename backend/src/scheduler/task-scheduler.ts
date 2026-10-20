import type { TaskItem, TaskSchedulerOptions, TaskSchedulerStats } from '../task/types';
import { ComicError, ErrorType, errorToLogObject } from '../error/types';
import { logger } from '../utils/logger';
import { ConcurrentSchedulingPolicy, type SchedulingPolicy } from './policy';

export type ScheduledTaskExecutor<T> = (task: TaskItem<T>) => Promise<void>;

export class TaskDeferredError extends Error {
  constructor(message: string, readonly retryAfterMs = 5_000) {
    super(message);
    this.name = 'TaskDeferredError';
  }
}

export class TaskScheduler<T = unknown> {
  private queue: TaskItem<T>[] = [];
  private running = new Map<string, TaskItem<T>>();
  private history = new Map<string, TaskItem<T>>();
  private priorityOrder: string[] = [];
  private readonly autoStart: boolean;
  private readonly policy: SchedulingPolicy<T>;
  private isPaused = false;
  private isStopped = false;
  private idleWaiters = new Set<() => void>();

  constructor(
    private readonly executor: ScheduledTaskExecutor<T>,
    options?: TaskSchedulerOptions,
    policy?: SchedulingPolicy<T>
  ) {
    this.autoStart = options?.autoStart ?? true;
    this.policy = policy ?? new ConcurrentSchedulingPolicy({ maxConcurrency: options?.concurrency ?? 3 });
  }

  async add(task: TaskItem<T>): Promise<void> {
    if (this.isStopped) throw new ComicError('Scheduler is stopped', ErrorType.VALIDATION_ERROR);
    task.status = 'pending';
    task.createdAt = task.createdAt ?? new Date();
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.error = undefined;
    this.queue.push(task);
    this.sortQueue();
    if (this.autoStart) this.process();
  }

  async addBatch(tasks: TaskItem<T>[]): Promise<void> {
    for (const task of tasks) await this.add(task);
  }

  pause(): void { this.isPaused = true; }
  resume(): void { this.isPaused = false; this.process(); }

  setPriorityOrder(taskIds: string[]): void {
    this.priorityOrder = taskIds;
    this.sortQueue();
    this.process();
  }

  cancel(taskId: string): boolean {
    const index = this.queue.findIndex((task) => task.id === taskId);
    if (index !== -1) {
      const task = this.queue[index]!;
      task.status = 'cancelled';
      task.completedAt = new Date();
      this.queue.splice(index, 1);
      this.history.set(task.id, task);
      this.notifyIfIdle();
      return true;
    }
    const runningTask = this.running.get(taskId);
    if (!runningTask) return false;
    runningTask.status = 'cancelled';
    runningTask.completedAt = new Date();
    return true;
  }

  remove(taskId: string): boolean {
    const queueIndex = this.queue.findIndex((task) => task.id === taskId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      this.notifyIfIdle();
      return true;
    }
    if (this.history.delete(taskId)) return true;
    return false;
  }

  stop(): void {
    this.isStopped = true;
    this.isPaused = true;
    this.queue = [];
    this.notifyIfIdle();
  }

  async waitForIdle(): Promise<void> {
    if (this.running.size === 0 && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  get(taskId: string): TaskItem<T> | undefined {
    return this.queue.find((task) => task.id === taskId) ?? this.running.get(taskId) ?? this.history.get(taskId);
  }

  getAll(): TaskItem<T>[] { return [...this.queue, ...this.running.values(), ...this.history.values()]; }

  getStats(): TaskSchedulerStats {
    const all = this.getAll();
    return {
      total: all.length,
      pending: this.queue.length,
      running: this.running.size,
      waitingForBrowserWorker: all.filter((task) => task.status === 'waiting_for_browser_worker').length,
      waitingVerification: all.filter((task) => task.status === 'waiting_verification').length,
      interrupted: all.filter((task) => task.status === 'interrupted').length,
      completed: all.filter((task) => task.status === 'completed').length,
      failed: all.filter((task) => task.status === 'failed').length,
      cancelled: all.filter((task) => task.status === 'cancelled').length,
    };
  }

  get size(): number { return this.queue.length + this.running.size + this.history.size; }
  get isEmpty(): boolean { return this.size === 0; }

  private process(): void {
    if (this.isPaused || this.isStopped) return;
    while (this.running.size < this.policy.maxConcurrency && this.queue.length > 0) {
      const index = this.policy.selectNextIndex(this.queue, [...this.running.values()]);
      if (index < 0) return;
      const [task] = this.queue.splice(index, 1);
      if (!task) return;
      task.status = 'running';
      task.startedAt = new Date();
      this.running.set(task.id, task);
      void this.executeTask(task);
    }
  }

  private async executeTask(task: TaskItem<T>): Promise<void> {
    let deferred: TaskDeferredError | undefined;
    try {
      deferred = await this.runTask(task);
    } finally {
      this.running.delete(task.id);
      if (deferred) this.deferTask(task, deferred);
      else { this.history.set(task.id, task); this.process(); }
      this.notifyIfIdle();
    }
  }

  private async runTask(task: TaskItem<T>): Promise<TaskDeferredError | undefined> {
    try {
      await this.executor(task);
      if (task.status === 'running') { task.status = 'completed'; task.completedAt = new Date(); }
      return undefined;
    } catch (error) {
      if (error instanceof TaskDeferredError) {
        task.status = 'waiting_for_browser_worker'; task.error = error.message; task.startedAt = undefined;
        return error;
      }
      if (task.status === 'running') {
        task.status = 'failed'; task.error = errorToLogObject(error).message as string; task.completedAt = new Date();
        logger.error({ taskId: task.id, error: errorToLogObject(error) }, 'Scheduled task execution failed');
      }
      return undefined;
    }
  }

  private deferTask(task: TaskItem<T>, deferred: TaskDeferredError): void {
    this.process();
    this.queue.push(task);
    this.sortQueue();
    const timer = setTimeout(() => {
      if (task.status === 'waiting_for_browser_worker') task.status = 'pending';
      this.process();
    }, Math.max(1, deferred.retryAfterMs));
    timer.unref();
  }

  private sortQueue(): void {
    const orderIndex = new Map(this.priorityOrder.map((taskId, index) => [taskId, index]));
    this.queue.sort((left, right) => {
      const leftIndex = orderIndex.get(left.id);
      const rightIndex = orderIndex.get(right.id);
      if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
      if (leftIndex !== undefined) return -1;
      if (rightIndex !== undefined) return 1;
      return right.priority - left.priority;
    });
  }

  private notifyIfIdle(): void {
    if (this.running.size > 0 || this.queue.length > 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
