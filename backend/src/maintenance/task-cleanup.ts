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
    const reason = skipReason(deps.taskManager, task, processed, batchLimit, cutoff);
    if (reason) { result.skipped.push(`${task.id}: ${reason}`); continue; }
    processed += 1;
    if (dryRun) previewTaskDeletion(deps, policy, result, task.id);
    else await deleteTask(deps, policy, result, task.id);
  }
  return result;
}

function skipReason(taskManager: TaskManager, task: ReturnType<TaskManager['getAllTasks']>[number],
  processed: number, limit: number, cutoff: number): string | undefined {
  if (processed >= limit) return 'batch limit reached';
  if (!TERMINAL_TASK_STATUSES.includes(task.status)) return `status=${task.status}`;
  const completedAt = getTaskCompletedAt(taskManager, task.id);
  if (completedAt === null) return 'missing completedAt';
  if (completedAt > cutoff) return 'within retention';
  return undefined;
}

function previewTaskDeletion(deps: TaskCleanupDeps, policy: MaintenanceConfig,
  result: MaintenanceResult['tasks'], taskId: string): void {
  result.deleted.push(taskId);
  const outputPath = deps.taskManager.getTaskResult(taskId)?.outputPath;
  if (policy.deleteFiles && outputPath) result.filesDeleted.push(outputPath);
}

async function deleteTask(deps: TaskCleanupDeps, policy: MaintenanceConfig,
  result: MaintenanceResult['tasks'], taskId: string): Promise<void> {
  try {
    const downloadDir = typeof deps.downloadDir === 'function' ? await deps.downloadDir() : deps.downloadDir;
    const outcome = await deps.taskManager.deleteTaskWithFiles(taskId, { deleteFiles: policy.deleteFiles, downloadDir });
    if (!outcome.deleted) { result.skipped.push(`${taskId}: delete refused`); return; }
    result.deleted.push(taskId);
    if (outcome.filesDeleted) result.filesDeleted.push('(record outputPath)');
    if (outcome.filesSkipped) result.filesSkipped.push(`${taskId}: ${outcome.filesSkipped}`);
  } catch (error) {
    result.errors.push({ id: taskId, error: error instanceof Error ? error.message : String(error) });
  }
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
