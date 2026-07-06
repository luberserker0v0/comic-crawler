import { describe, it, expect, beforeEach } from '@jest/globals';
import { TaskQueue } from '../../../src/task/queue';
import type { TaskItem } from '../../../src/task/types';

describe('TaskQueue', () => {
  let queue: TaskQueue<{ url: string }>;
  let executedTasks: { url: string }[];

  beforeEach(() => {
    executedTasks = [];
    queue = new TaskQueue<{ url: string }>(
      async (task) => {
        executedTasks.push(task.data);
      },
      { concurrency: 2, autoStart: true }
    );
  });

  it('should add and execute tasks', async () => {
    const task: TaskItem<{ url: string }> = {
      id: 'task-1',
      data: { url: 'https://example.com' },
      status: 'pending',
      priority: 0,
      createdAt: new Date(),
    };

    await queue.add(task);
    await sleep(50);

    expect(executedTasks).toHaveLength(1);
    expect(executedTasks[0].url).toBe('https://example.com');
  });

  it('should respect concurrency limit', async () => {
    const tasks: TaskItem<{ url: string }>[] = [
      { id: 't1', data: { url: '1' }, status: 'pending', priority: 0, createdAt: new Date() },
      { id: 't2', data: { url: '2' }, status: 'pending', priority: 0, createdAt: new Date() },
      { id: 't3', data: { url: '3' }, status: 'pending', priority: 0, createdAt: new Date() },
    ];

    for (const task of tasks) {
      await queue.add(task);
    }

    await sleep(50);

    const stats = queue.getStats();
    expect(stats.running).toBeLessThanOrEqual(2);
  });

  it('should pause and resume', async () => {
    const task: TaskItem<{ url: string }> = {
      id: 'task-1',
      data: { url: 'https://example.com' },
      status: 'pending',
      priority: 0,
      createdAt: new Date(),
    };

    queue.pause();
    await queue.add(task);
    await sleep(50);

    expect(executedTasks).toHaveLength(0);

    queue.resume();
    await sleep(50);

    expect(executedTasks).toHaveLength(1);
  });

  it('should cancel tasks', async () => {
    queue.pause();
    const task: TaskItem<{ url: string }> = {
      id: 'task-1',
      data: { url: 'https://example.com' },
      status: 'pending',
      priority: 0,
      createdAt: new Date(),
    };

    await queue.add(task);
    expect(queue.get('task-1')).toBeDefined();

    const cancelled = queue.cancel('task-1');
    expect(cancelled).toBe(true);
    expect(queue.get('task-1')?.status).toBe('cancelled');
  });

  it('should track stats', async () => {
    const completedTasks: string[] = [];
    queue = new TaskQueue<{ url: string }>(
      async (task) => {
        completedTasks.push(task.id);
      },
      { concurrency: 2, autoStart: true }
    );

    const tasks: TaskItem<{ url: string }>[] = [
      { id: 't1', data: { url: '1' }, status: 'pending', priority: 0, createdAt: new Date() },
      { id: 't2', data: { url: '2' }, status: 'pending', priority: 0, createdAt: new Date() },
    ];

    for (const task of tasks) {
      await queue.add(task);
    }

    await sleep(200);

    expect(completedTasks).toContain('t1');
    expect(completedTasks).toContain('t2');
    const stats = queue.getStats();
    expect(stats.completed).toBe(2);
    expect(queue.getAll().some((task) => task.id === 't1' && task.status === 'completed')).toBe(true);
  });

  it('should sort by priority', async () => {
    const low: TaskItem<{ url: string }> = { id: 'low', data: { url: 'low' }, status: 'pending', priority: 0, createdAt: new Date() };
    const high: TaskItem<{ url: string }> = { id: 'high', data: { url: 'high' }, status: 'pending', priority: 10, createdAt: new Date() };

    queue.pause();
    await queue.add(low);
    await queue.add(high);

    const all = queue.getAll();
    const pending = all.filter((t) => t.status === 'pending');
    expect(pending[0].id).toBe('high');
  });

  it('should put forced task order before numeric priority', async () => {
    const lowForced: TaskItem<{ url: string }> = { id: 'forced', data: { url: 'forced' }, status: 'pending', priority: 0, createdAt: new Date() };
    const highPriority: TaskItem<{ url: string }> = { id: 'high', data: { url: 'high' }, status: 'pending', priority: 10, createdAt: new Date() };

    queue.pause();
    queue.setPriorityOrder(['forced']);
    await queue.add(highPriority);
    await queue.add(lowForced);

    const pending = queue.getAll().filter((task) => task.status === 'pending');
    expect(pending[0].id).toBe('forced');
    expect(pending[1].id).toBe('high');
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
