import type { TaskItem } from '../task/types';

export abstract class SchedulingPolicy<T = unknown> {
  abstract readonly maxConcurrency: number;

  selectNextIndex(queued: readonly TaskItem<T>[], running: readonly TaskItem<T>[]): number {
    return queued.findIndex((task) => this.canStart(task, running));
  }

  canStart(_task: TaskItem<T>, _running: readonly TaskItem<T>[]): boolean {
    return true;
  }
}

export interface ConcurrentSchedulingPolicyOptions<T> {
  maxConcurrency: number;
  maxConcurrencyPerGroup?: number;
  groupBy?: (task: TaskItem<T>) => string | undefined;
}

export class ConcurrentSchedulingPolicy<T = unknown> extends SchedulingPolicy<T> {
  readonly maxConcurrency: number;
  private readonly maxConcurrencyPerGroup: number;
  private readonly groupBy?: (task: TaskItem<T>) => string | undefined;

  constructor(options: ConcurrentSchedulingPolicyOptions<T>) {
    super();
    this.maxConcurrency = normalizeConcurrency(options.maxConcurrency);
    this.maxConcurrencyPerGroup = normalizeConcurrency(options.maxConcurrencyPerGroup ?? Number.MAX_SAFE_INTEGER);
    this.groupBy = options.groupBy;
  }

  override canStart(task: TaskItem<T>, running: readonly TaskItem<T>[]): boolean {
    const group = this.groupBy?.(task);
    if (!group) return true;
    return running.filter((entry) => this.groupBy?.(entry) === group).length < this.maxConcurrencyPerGroup;
  }
}

export class SequentialSchedulingPolicy<T = unknown> extends ConcurrentSchedulingPolicy<T> {
  constructor() {
    super({ maxConcurrency: 1 });
  }
}

function normalizeConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}
