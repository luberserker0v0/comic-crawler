import type { TaskItem, TaskQueueOptions, TaskQueueStats } from './types';
import { ComicError, ErrorType, errorToLogObject } from '../error/types';
import { logger } from '../utils/logger';

type TaskExecutor<T> = (task: TaskItem<T>) => Promise<void>;

export class TaskQueue<T = unknown> {
  private queue: TaskItem<T>[] = [];
  private running = new Map<string, TaskItem<T>>();
  private history = new Map<string, TaskItem<T>>();
  private priorityOrder: string[] = [];
  private options: Required<TaskQueueOptions>;
  private executor: TaskExecutor<T>;
  private isPaused = false;
  private isStopped = false;
  private idleWaiters = new Set<() => void>();

  constructor(executor: TaskExecutor<T>, options?: TaskQueueOptions) {
    this.executor = executor;
    this.options = {
      concurrency: options?.concurrency ?? 3,
      autoStart: options?.autoStart ?? true,
    };
  }

  async add(task: TaskItem<T>): Promise<void> {
    if (this.isStopped) {
      throw new ComicError('Queue is stopped', ErrorType.VALIDATION_ERROR);
    }

    task.status = 'pending';
    task.createdAt = task.createdAt ?? new Date();
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.error = undefined;
    this.queue.push(task);
    this.sortQueue();

    if (this.options.autoStart) {
      this.process();
    }
  }

  async addBatch(tasks: TaskItem<T>[]): Promise<void> {
    for (const task of tasks) {
      await this.add(task);
    }
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
    this.process();
  }

  setPriorityOrder(taskIds: string[]): void {
    this.priorityOrder = taskIds;
    this.sortQueue();
    this.process();
  }

  cancel(taskId: string): boolean {
    const index = this.queue.findIndex((t) => t.id === taskId);
    if (index !== -1) {
      const task = this.queue[index];
      task.status = 'cancelled';
      task.completedAt = new Date();
      this.queue.splice(index, 1);
      this.history.set(task.id, task);
      return true;
    }

    const runningTask = this.running.get(taskId);
    if (runningTask) {
      runningTask.status = 'cancelled';
      runningTask.completedAt = new Date();
      return true;
    }

    return false;
  }

  remove(taskId: string): boolean {
    const queueIndex = this.queue.findIndex((task) => task.id === taskId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      return true;
    }

    if (this.history.delete(taskId)) {
      return true;
    }

    if (this.running.has(taskId)) {
      return false;
    }

    return false;
  }

  stop(): void {
    this.isStopped = true;
    this.isPaused = true;
    this.queue = [];
    this.notifyIfIdle();
  }

  async waitForIdle(): Promise<void> {
    if (this.running.size === 0 && this.queue.length === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  get(taskId: string): TaskItem<T> | undefined {
    return this.queue.find((t) => t.id === taskId) ?? this.running.get(taskId) ?? this.history.get(taskId);
  }

  getAll(): TaskItem<T>[] {
    return [...this.queue, ...this.running.values(), ...this.history.values()];
  }

  getStats(): TaskQueueStats {
    const all = [...this.queue, ...this.running.values(), ...this.history.values()];
    return {
      total: all.length,
      pending: this.queue.length,
      running: this.running.size,
      waitingVerification: all.filter((t) => t.status === 'waiting_verification').length,
      interrupted: all.filter((t) => t.status === 'interrupted').length,
      completed: all.filter((t) => t.status === 'completed').length,
      failed: all.filter((t) => t.status === 'failed').length,
      cancelled: all.filter((t) => t.status === 'cancelled').length,
    };
  }

  get size(): number {
    return this.queue.length + this.running.size + this.history.size;
  }

  get isEmpty(): boolean {
    return this.size === 0;
  }

  private async process(): Promise<void> {
    if (this.isPaused || this.isStopped) return;

    while (this.running.size < this.options.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      task.status = 'running';
      task.startedAt = new Date();
      this.running.set(task.id, task);

      this.executeTask(task).catch(() => {});
    }
  }

  private async executeTask(task: TaskItem<T>): Promise<void> {
    try {
      await this.executor(task);
      if (task.status === 'running') {
        task.status = 'completed';
        task.completedAt = new Date();
      }
    } catch (error) {
      if (task.status === 'running') {
        task.status = 'failed';
        task.error = errorToLogObject(error).message as string;
        task.completedAt = new Date();
        logger.error({ taskId: task.id, error: errorToLogObject(error) }, 'Task execution failed');
      }
    } finally {
      this.running.delete(task.id);
      this.history.set(task.id, task);
      this.process();
      this.notifyIfIdle();
    }
  }

  private sortQueue(): void {
    const orderIndex = new Map(this.priorityOrder.map((taskId, index) => [taskId, index]));
    this.queue.sort((a, b) => {
      const aIndex = orderIndex.get(a.id);
      const bIndex = orderIndex.get(b.id);
      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
      if (aIndex !== undefined) return -1;
      if (bIndex !== undefined) return 1;
      return b.priority - a.priority;
    });
  }

  private notifyIfIdle(): void {
    if (this.running.size > 0 || this.queue.length > 0) {
      return;
    }

    for (const resolve of this.idleWaiters) {
      resolve();
    }
    this.idleWaiters.clear();
  }
}
