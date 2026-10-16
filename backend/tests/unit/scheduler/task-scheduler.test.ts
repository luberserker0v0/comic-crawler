import { describe, expect, it } from '@jest/globals';
import { ConcurrentSchedulingPolicy, SequentialSchedulingPolicy, TaskScheduler } from '../../../src/scheduler';
import type { TaskItem } from '../../../src/task/types';

interface GroupedTask {
  group: string;
}

function task(id: string, group: string, priority = 0): TaskItem<GroupedTask> {
  return { id, data: { group }, status: 'pending', priority, createdAt: new Date() };
}

describe('TaskScheduler policies', () => {
  it('runs one task at a time with SequentialSchedulingPolicy', async () => {
    let running = 0;
    let maximum = 0;
    const scheduler = new TaskScheduler<GroupedTask>(async () => {
      running += 1;
      maximum = Math.max(maximum, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    }, { concurrency: 10 }, new SequentialSchedulingPolicy<GroupedTask>());

    await scheduler.addBatch([task('a', 'a'), task('b', 'b'), task('c', 'c')]);
    await scheduler.waitForIdle();

    expect(maximum).toBe(1);
    expect(scheduler.getStats().completed).toBe(3);
  });

  it('runs concurrent tasks while limiting each group', async () => {
    const runningByGroup = new Map<string, number>();
    let maximumTotal = 0;
    let runningTotal = 0;
    const scheduler = new TaskScheduler<GroupedTask>(async (entry) => {
      const group = entry.data.group;
      runningTotal += 1;
      maximumTotal = Math.max(maximumTotal, runningTotal);
      runningByGroup.set(group, (runningByGroup.get(group) ?? 0) + 1);
      expect(runningByGroup.get(group)).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      runningByGroup.set(group, (runningByGroup.get(group) ?? 1) - 1);
      runningTotal -= 1;
    }, { concurrency: 10 }, new ConcurrentSchedulingPolicy<GroupedTask>({
      maxConcurrency: 2,
      maxConcurrencyPerGroup: 1,
      groupBy: (entry) => entry.data.group,
    }));

    await scheduler.addBatch([
      task('a-1', 'a'),
      task('a-2', 'a'),
      task('b-1', 'b'),
    ]);
    await scheduler.waitForIdle();

    expect(maximumTotal).toBe(2);
    expect(scheduler.getStats().completed).toBe(3);
  });
});
