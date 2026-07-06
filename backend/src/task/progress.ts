import type { EventBus } from '../events/bus';

export interface TaskProgress {
  taskId: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  currentItems?: string;
  percentage: number;
  startedAt: Date;
  updatedAt: Date;
  estimatedRemaining?: number;
}

export class ProgressTracker {
  private progressMap = new Map<string, TaskProgress>();
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  init(taskId: string, totalItems: number): TaskProgress {
    const now = new Date();
    const progress: TaskProgress = {
      taskId,
      totalItems,
      completedItems: 0,
      failedItems: 0,
      percentage: 0,
      startedAt: now,
      updatedAt: now,
    };

    this.progressMap.set(taskId, progress);
    this.emitProgress(progress);
    return progress;
  }

  update(taskId: string, increment: { completed?: number; failed?: number; currentItem?: string }): TaskProgress | undefined {
    const progress = this.progressMap.get(taskId);
    if (!progress) return undefined;

    if (increment.completed) {
      progress.completedItems += increment.completed;
    }
    if (increment.failed) {
      progress.failedItems += increment.failed;
    }
    if (increment.currentItem) {
      progress.currentItems = increment.currentItem;
    }

    progress.updatedAt = new Date();
    progress.percentage = this.calculatePercentage(progress);
    progress.estimatedRemaining = this.estimateRemaining(progress);

    this.emitProgress(progress);
    return progress;
  }

  complete(taskId: string): TaskProgress | undefined {
    const progress = this.progressMap.get(taskId);
    if (!progress) return undefined;

    progress.completedItems = progress.totalItems;
    progress.percentage = 100;
    progress.updatedAt = new Date();
    progress.currentItems = undefined;

    this.emitProgress(progress);
    return progress;
  }

  get(taskId: string): TaskProgress | undefined {
    return this.progressMap.get(taskId);
  }

  hydrate(progress: TaskProgress): TaskProgress {
    this.progressMap.set(progress.taskId, progress);
    return progress;
  }

  getAll(): Map<string, TaskProgress> {
    return new Map(this.progressMap);
  }

  remove(taskId: string): void {
    this.progressMap.delete(taskId);
  }

  clear(): void {
    this.progressMap.clear();
  }

  private calculatePercentage(progress: TaskProgress): number {
    if (progress.totalItems === 0) return 0;
    return Math.round((progress.completedItems / progress.totalItems) * 100);
  }

  private estimateRemaining(progress: TaskProgress): number | undefined {
    if (progress.completedItems === 0) return undefined;

    const elapsed = Date.now() - progress.startedAt.getTime();
    const rate = progress.completedItems / elapsed;
    const remaining = progress.totalItems - progress.completedItems;

    return Math.round(remaining / rate);
  }

  private emitProgress(progress: TaskProgress): void {
    this.eventBus?.emit('task:progress', {
      taskId: progress.taskId,
      progress: {
        totalImages: progress.totalItems,
        completedImages: progress.completedItems,
        failedImages: progress.failedItems,
        currentChapter: progress.currentItems,
      },
    });
  }
}
