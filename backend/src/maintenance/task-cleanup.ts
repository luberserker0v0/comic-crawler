import type { MaintenanceConfig } from '@comiccrawler/shared';
import type { TaskManager } from '../task/manager';
import type { TaskStatus } from '../task/types';
import type { MaintenanceResult } from './service';

export interface TaskCleanupDeps {
  taskManager: TaskManager;
  downloadDir?: string | (() => string | Promise<string>);
}

const TERMINAL_TASK_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled', 'interrupted'];

export async function cleanupTasks(
  deps: TaskCleanupDeps,
  policy: MaintenanceConfig,
  batchLimit: number,
  dryRun: boolean
): Promise<MaintenanceResult['tasks']> {
  const result: MaintenanceResult['tasks'] = { scanned: 0, deleted: [], skipped: [], errors: [], filesDeleted: [], filesSkipped: [] };
  const all = deps.taskManager.getAllTasks();
  result.scanned = all.length;
  const cutoff = Date.now() - policy.tasksRetainDays * 24 * 60 * 60 * 1000;

  let processed = 0;
  for (const task of all) {
    if (processed >= batchLimit) {
      result.skipped.push(`${task.id}: batch limit reached`);
      continue;
    }
    if (!TERMINAL_TASK_STATUSES.includes(task.status)) {
      result.skipped.push(`${task.id}: status=${task.status}`);
      continue;
    }
    const completedAt = getTaskCompletedAt(deps.taskManager, task.id);
    if (completedAt === null) {
      result.skipped.push(`${task.id}: missing completedAt`);
      continue;
    }
    if (completedAt > cutoff) {
      result.skipped.push(`${task.id}: within retention`);
      continue;
    }
    processed += 1;
    if (dryRun) {
      result.deleted.push(task.id);
      const outputPath = deps.taskManager.getTaskResult(task.id)?.outputPath;
      if (policy.deleteFiles && outputPath) result.filesDeleted.push(outputPath);
      continue;
    }
    try {
      const downloadDir = typeof deps.downloadDir === 'function'
        ? await deps.downloadDir()
        : deps.downloadDir;
      const outcome = await deps.taskManager.deleteTaskWithFiles(task.id, {
        deleteFiles: policy.deleteFiles,
        downloadDir,
      });
      if (outcome.deleted) {
        result.deleted.push(task.id);
        if (outcome.filesDeleted) {
          const outputPath = '(record outputPath)';
          result.filesDeleted.push(outputPath);
        }
        if (outcome.filesSkipped) result.filesSkipped.push(`${task.id}: ${outcome.filesSkipped}`);
      } else {
        result.skipped.push(`${task.id}: delete refused`);
      }
    } catch (error) {
      result.errors.push({ id: task.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export function getTaskCompletedAt(taskManager: TaskManager, taskId: string): number | null {
  const task = taskManager.getTask(taskId);
  const result = taskManager.getTaskResult(taskId);
  const candidates = [task?.completedAt, result?.completedAt];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const time = candidate instanceof Date ? candidate.getTime() : new Date(candidate).getTime();
    if (Number.isFinite(time)) return time;
  }
  return null;
}
