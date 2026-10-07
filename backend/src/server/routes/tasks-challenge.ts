import type { TaskManager } from '../../task/manager';
import type { ChallengeDiscoveryService } from '../../challenge';

export function adapterSupports(
  capabilities: { verification?: boolean; metadata: boolean; chapterImages: boolean },
  required: Partial<{ metadata: boolean; chapterImages: boolean }>
): boolean {
  return Object.entries(required).every(([key, value]) =>
    value === undefined || capabilities[key as keyof typeof capabilities] === value
  );
}

export async function recreateChallengeJobForTask(
  taskManager: TaskManager,
  challengeDiscoveryService: ChallengeDiscoveryService,
  taskId: string
) {
  const task = taskManager.getTask(taskId);
  if (!task) {
    throw new Error(`Task "${taskId}" was not found.`);
  }
  const verificationUrl = task.data.chapterUrls?.[0] ?? task.data.url;
  const challengeJob = await challengeDiscoveryService.create({ url: verificationUrl });
  const message = `Verification handoff expired or was removed. New challenge discovery job: ${challengeJob.id}`;
  await taskManager.updateResult(taskId, {
    challengeDiscoveryId: challengeJob.id,
    challengeStatus: challengeJob.status,
    error: message,
  });
  await taskManager.updateTaskError(taskId, message);
  return challengeJob;
}

export function isMissingChallengeJobError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /challenge discovery job .*not found|challenge discovery job .*was not found/i.test(message);
}
