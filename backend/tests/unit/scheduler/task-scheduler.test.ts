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
  TaskSchedulerPoliciesTestGroup1();
});

function TaskSchedulerPoliciesTestGroup1(): void {
  it('runs one task at a time with SequentialSchedulingPolicy', TaskSchedulerPoliciesTestRunsOneTaskAtATimeWithSequentialSchedulingPolicy);
  it('runs concurrent tasks while limiting each group', TaskSchedulerPoliciesTestRunsConcurrentTasksWhileLimitingEachGroup);
}

async function TaskSchedulerPoliciesTestRunsOneTaskAtATimeWithSequentialSchedulingPolicy() {
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
}

async function TaskSchedulerPoliciesTestRunsConcurrentTasksWhileLimitingEachGroup() {
    const runningByGroup = new Map<string, number>();
    const counts = { maximum: 0, running: 0 };
    const scheduler = createConcurrentScheduler(runningByGroup, counts);
    await scheduler.addBatch([task('a-1', 'a'), task('a-2', 'a'), task('b-1', 'b')]);
    await scheduler.waitForIdle();
    expect(counts.maximum).toBe(2);
    expect(scheduler.getStats().completed).toBe(3);
}

function createConcurrentScheduler(groups: Map<string, number>, counts: { maximum: number; running: number }) {
  return new TaskScheduler<GroupedTask>(async (entry) => {
    await trackConcurrentRun(entry.data.group, groups, counts);
  }, { concurrency: 10 }, new ConcurrentSchedulingPolicy<GroupedTask>({
        maxConcurrency: 2,
        maxConcurrencyPerGroup: 1,
        groupBy: (entry) => entry.data.group,
    }));
}

async function trackConcurrentRun(group: string, groups: Map<string, number>, counts: { maximum: number; running: number }) {
  counts.running += 1;
  counts.maximum = Math.max(counts.maximum, counts.running);
  groups.set(group, (groups.get(group) ?? 0) + 1);
  expect(groups.get(group)).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  groups.set(group, (groups.get(group) ?? 1) - 1);
  counts.running -= 1;
}
