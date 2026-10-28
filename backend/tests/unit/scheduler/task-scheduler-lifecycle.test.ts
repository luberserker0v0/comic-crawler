import { describe, it, expect, beforeEach } from '@jest/globals';
import { TaskDeferredError, TaskScheduler } from '../../../src/scheduler';
import type { TaskItem } from '../../../src/task/types';

let scheduler: TaskScheduler<{ url: string }>;

let executedTasks: { url: string }[];

describe('TaskScheduler lifecycle', () => {
  TaskSchedulerLifecycleTestGroup1();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function TaskSchedulerLifecycleTestGroup1(): void {
  beforeEach(TaskSchedulerLifecycleTestScenario1);
  it('should add and execute tasks', TaskSchedulerLifecycleTestShouldAddAndExecuteTasks);
  it('should respect concurrency limit', TaskSchedulerLifecycleTestShouldRespectConcurrencyLimit);
  it('should pause and resume', TaskSchedulerLifecycleTestShouldPauseAndResume);
  it('should cancel tasks', TaskSchedulerLifecycleTestShouldCancelTasks);
  it('aborts a running task when it is cancelled', TaskSchedulerLifecycleTestAbortsARunningTask);
  it('should track stats', TaskSchedulerLifecycleTestShouldTrackStats);
  it('should sort by priority', TaskSchedulerLifecycleTestShouldSortByPriority);
  it('should put forced task order before numeric priority', TaskSchedulerLifecycleTestShouldPutForcedTaskOrderBeforeNumericPriority);
  it('does not occupy a concurrency slot while a task waits for a browser worker', TaskSchedulerLifecycleTestDoesNotOccupyAConcurrencySlotWhileATaskWaitsForABrowserWorker);
}

function TaskSchedulerLifecycleTestScenario1() {
    executedTasks = [];
    scheduler = new TaskScheduler<{
        url: string;
    }>(async (task) => {
        executedTasks.push(task.data);
    }, { concurrency: 2, autoStart: true });
}

async function TaskSchedulerLifecycleTestShouldAddAndExecuteTasks() {
    const task: TaskItem<{
        url: string;
    }> = {
        id: 'task-1',
        data: { url: 'https://example.com' },
        status: 'pending',
        priority: 0,
        createdAt: new Date(),
    };
    await scheduler.add(task);
    await sleep(50);
    expect(executedTasks).toHaveLength(1);
    expect(executedTasks[0].url).toBe('https://example.com');
}

async function TaskSchedulerLifecycleTestShouldRespectConcurrencyLimit() {
    const tasks: TaskItem<{
        url: string;
    }>[] = [
        { id: 't1', data: { url: '1' }, status: 'pending', priority: 0, createdAt: new Date() },
        { id: 't2', data: { url: '2' }, status: 'pending', priority: 0, createdAt: new Date() },
        { id: 't3', data: { url: '3' }, status: 'pending', priority: 0, createdAt: new Date() },
    ];
    for (const task of tasks) {
        await scheduler.add(task);
    }
    await sleep(50);
    const stats = scheduler.getStats();
    expect(stats.running).toBeLessThanOrEqual(2);
}

async function TaskSchedulerLifecycleTestShouldPauseAndResume() {
    const task: TaskItem<{
        url: string;
    }> = {
        id: 'task-1',
        data: { url: 'https://example.com' },
        status: 'pending',
        priority: 0,
        createdAt: new Date(),
    };
    scheduler.pause();
    await scheduler.add(task);
    await sleep(50);
    expect(executedTasks).toHaveLength(0);
    scheduler.resume();
    await sleep(50);
    expect(executedTasks).toHaveLength(1);
}

async function TaskSchedulerLifecycleTestShouldCancelTasks() {
    scheduler.pause();
    const task: TaskItem<{
        url: string;
    }> = {
        id: 'task-1',
        data: { url: 'https://example.com' },
        status: 'pending',
        priority: 0,
        createdAt: new Date(),
    };
    await scheduler.add(task);
    expect(scheduler.get('task-1')).toBeDefined();
    const cancelled = scheduler.cancel('task-1');
    expect(cancelled).toBe(true);
    expect(scheduler.get('task-1')?.status).toBe('cancelled');
}

async function TaskSchedulerLifecycleTestAbortsARunningTask() {
    let observedAbort = false;
    scheduler = new TaskScheduler(async (_task, signal) => new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { observedAbort = true; resolve(); }, { once: true });
    }), { concurrency: 1, autoStart: true });
    await scheduler.add(lifecycleTask('running'));
    await sleep(10);
    expect(scheduler.cancel('running')).toBe(true);
    await scheduler.waitForIdle();
    expect(observedAbort).toBe(true);
    expect(scheduler.get('running')?.status).toBe('cancelled');
}

async function TaskSchedulerLifecycleTestShouldTrackStats() {
    const completedTasks: string[] = [];
    scheduler = createTrackingScheduler(completedTasks);
    await scheduler.addBatch([lifecycleTask('t1'), lifecycleTask('t2')]);
    await sleep(200);
    expect(completedTasks).toContain('t1');
    expect(completedTasks).toContain('t2');
    const stats = scheduler.getStats();
    expect(stats.completed).toBe(2);
    expect(scheduler.getAll().some((task) => task.id === 't1' && task.status === 'completed')).toBe(true);
}

function createTrackingScheduler(completed: string[]): TaskScheduler<{ url: string }> {
  return new TaskScheduler(async (task) => {
    completed.push(task.id);
  }, { concurrency: 2, autoStart: true });
}

function lifecycleTask(id: string): TaskItem<{ url: string }> {
  return { id, data: { url: id.slice(1) }, status: 'pending', priority: 0, createdAt: new Date() };
}

async function TaskSchedulerLifecycleTestShouldSortByPriority() {
    const low: TaskItem<{
        url: string;
    }> = { id: 'low', data: { url: 'low' }, status: 'pending', priority: 0, createdAt: new Date() };
    const high: TaskItem<{
        url: string;
    }> = { id: 'high', data: { url: 'high' }, status: 'pending', priority: 10, createdAt: new Date() };
    scheduler.pause();
    await scheduler.add(low);
    await scheduler.add(high);
    const all = scheduler.getAll();
    const pending = all.filter((t) => t.status === 'pending');
    expect(pending[0].id).toBe('high');
}

async function TaskSchedulerLifecycleTestShouldPutForcedTaskOrderBeforeNumericPriority() {
    const lowForced: TaskItem<{
        url: string;
    }> = { id: 'forced', data: { url: 'forced' }, status: 'pending', priority: 0, createdAt: new Date() };
    const highPriority: TaskItem<{
        url: string;
    }> = { id: 'high', data: { url: 'high' }, status: 'pending', priority: 10, createdAt: new Date() };
    scheduler.pause();
    scheduler.setPriorityOrder(['forced']);
    await scheduler.add(highPriority);
    await scheduler.add(lowForced);
    const pending = scheduler.getAll().filter((task) => task.status === 'pending');
    expect(pending[0].id).toBe('forced');
    expect(pending[1].id).toBe('high');
}

async function TaskSchedulerLifecycleTestDoesNotOccupyAConcurrencySlotWhileATaskWaitsForABrowserWorker() {
    const order: string[] = [];
    let firstAttempt = true;
    scheduler = new TaskScheduler<{
        url: string;
    }>(async (entry) => {
        if (entry.id === 'waiting' && firstAttempt) {
            firstAttempt = false;
            throw new TaskDeferredError('Waiting for a browser worker.', 50);
        }
        order.push(entry.id);
    }, { concurrency: 1, autoStart: true });
    scheduler.pause();
    await scheduler.add({ id: 'waiting', data: { url: 'waiting' }, status: 'pending', priority: 10, createdAt: new Date() });
    await scheduler.add({ id: 'ready', data: { url: 'ready' }, status: 'pending', priority: 0, createdAt: new Date() });
    scheduler.resume();
    await sleep(100);
    expect(order).toEqual(['ready', 'waiting']);
    expect(scheduler.getStats().completed).toBe(2);
}
