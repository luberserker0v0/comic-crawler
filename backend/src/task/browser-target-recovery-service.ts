import type { ExistingTabBrowserTarget } from '@comiccrawler/shared';
import type { ChallengeDiscoveryJob } from '../challenge/discovery-types';
import type { ChallengeDiscoveryService } from '../challenge';
import type { BrowserWorkerLeaseCoordinator } from '../browser/browser-worker-lease-coordinator';
import {
  BrowserTargetRebindError,
  type RebindBrowserTargetResult,
  type TaskManager,
} from './manager';

export interface RecoverBrowserTargetRequest {
  taskId: string;
  ownerUserId: string;
  expectedBrowserTarget: ExistingTabBrowserTarget;
  browserTarget: ExistingTabBrowserTarget;
}

export interface RecoverBrowserTargetResult extends RebindBrowserTargetResult {
  challenge?: ChallengeDiscoveryJob;
}

export class BrowserTargetRecoveryService {
  private readonly operations = new Map<string, Promise<void>>();

  constructor(
    private readonly taskManager: TaskManager,
    private readonly leaseCoordinator: BrowserWorkerLeaseCoordinator,
    private readonly challengeDiscoveryService?: ChallengeDiscoveryService
  ) {}

  async recover(input: RecoverBrowserTargetRequest): Promise<RecoverBrowserTargetResult> {
    const previous = this.operations.get(input.taskId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.recoverUnlocked(input));
    const settled = operation.then(() => undefined, () => undefined);
    this.operations.set(input.taskId, settled);
    try {
      return await operation;
    } finally {
      if (this.operations.get(input.taskId) === settled) this.operations.delete(input.taskId);
    }
  }

  private async recoverUnlocked(input: RecoverBrowserTargetRequest): Promise<RecoverBrowserTargetResult> {
    const task = this.requireOwnedTask(input);
    const matchingEvent = this.findMatchingEvent(input);
    const currentTarget = task.data.browserTarget;
    if (currentTarget?.mode === 'existing-tab'
      && sameTarget(currentTarget, input.browserTarget)
      && matchingEvent) {
      return this.finishHandoffRecovery({ task, event: matchingEvent, idempotent: true }, input.browserTarget);
    }
    this.validateCurrentTarget(task, input);
    const challenge = await this.currentChallenge(input.taskId);
    const expectedUrl = task.status === 'waiting_verification'
      ? challenge?.normalizedUrl ?? task.data.chapterUrls?.[0] ?? task.data.url
      : task.data.url;
    const browserTargetUrl = this.validateRecoveryResource(input, expectedUrl, task.status === 'waiting_verification');
    const rebound = await this.taskManager.rebindBrowserTarget({ ...input, browserTargetUrl });
    if (!rebound.idempotent) await this.leaseCoordinator.releaseTask(input.taskId);
    return this.finishHandoffRecovery(rebound, input.browserTarget, challenge);
  }

  private requireOwnedTask(input: RecoverBrowserTargetRequest) {
    const task = this.taskManager.getTask(input.taskId);
    if (!task) throw new BrowserTargetRebindError(`Task "${input.taskId}" was not found.`, 'NOT_FOUND');
    if ((task.data.ownerUserId ?? 'public') !== input.ownerUserId) {
      throw new BrowserTargetRebindError('The authenticated user does not own this task.', 'FORBIDDEN');
    }
    return task;
  }

  private findMatchingEvent(input: RecoverBrowserTargetRequest) {
    return [...this.taskManager.getEvents(input.taskId)].reverse().find((event) =>
      sameTarget(event.previousBrowserTarget, input.expectedBrowserTarget)
      && sameTarget(event.browserTarget, input.browserTarget));
  }

  private validateCurrentTarget(task: ReturnType<TaskManager['getTask']>, input: RecoverBrowserTargetRequest): void {
    const target = task!.data.browserTarget;
    if (target?.mode !== 'existing-tab') throw new BrowserTargetRebindError(
      'Only existing-tab tasks can rebind their Browser Target.', 'INVALID_TARGET'
    );
    if (!sameTarget(target, input.expectedBrowserTarget)) throw new BrowserTargetRebindError(
      'The task Browser Target changed after it was inspected.', 'STALE_TARGET'
    );
    if (task!.status === 'waiting_verification' && !this.challengeDiscoveryService) throw new BrowserTargetRebindError(
      'Human verification recovery is not available because challenge discovery is not configured.', 'INVALID_STATE'
    );
  }

  private validateRecoveryResource(input: RecoverBrowserTargetRequest, expectedUrl: string, humanHandoff: boolean): string {
    try {
      return this.leaseCoordinator.validateExistingTabRecoveryTarget({
        ownerUserId: input.ownerUserId, target: input.browserTarget, expectedUrl, requireHumanHandoff: humanHandoff,
      }).resourceUrl;
    } catch (error) {
      throw new BrowserTargetRebindError(error instanceof Error ? error.message : String(error), 'INVALID_TARGET');
    }
  }

  private async finishHandoffRecovery(
    rebound: RebindBrowserTargetResult,
    browserTarget: ExistingTabBrowserTarget,
    knownChallenge?: ChallengeDiscoveryJob | null
  ): Promise<RecoverBrowserTargetResult> {
    if (rebound.task.status !== 'waiting_verification' || !this.challengeDiscoveryService) {
      return rebound;
    }

    const current = knownChallenge ?? await this.currentChallenge(rebound.task.id);
    const challenge = await this.recoverChallenge(rebound, browserTarget, current);
    if (challenge) await this.updateTaskChallenge(rebound.task.id, challenge);
    return { ...rebound, ...(challenge ? { challenge } : {}) };
  }

  private async recoverChallenge(rebound: RebindBrowserTargetResult, browserTarget: ExistingTabBrowserTarget,
    current: ChallengeDiscoveryJob | null): Promise<ChallengeDiscoveryJob | null> {
    if (current && sameOptionalTarget(current.browserTarget, browserTarget) && rebound.idempotent) return current;
    if (current) return this.challengeDiscoveryService!.rebindBrowserTarget(current.id, browserTarget);
    return this.challengeDiscoveryService!.create({
      url: rebound.task.data.chapterUrls?.[0] ?? rebound.task.data.url,
      ownerUserId: rebound.task.data.ownerUserId, browserTarget,
    });
  }

  private async updateTaskChallenge(taskId: string, challenge: ChallengeDiscoveryJob): Promise<void> {
    await this.taskManager.updateResult(taskId, {
      challengeDiscoveryId: challenge.id, challengeStatus: challenge.status, error: challenge.error,
    });
    await this.taskManager.updateTaskError(taskId, challenge.error);
  }

  private async currentChallenge(taskId: string): Promise<ChallengeDiscoveryJob | null> {
    const challengeDiscoveryId = this.taskManager.getTaskResult(taskId)?.challengeDiscoveryId;
    if (!challengeDiscoveryId || !this.challengeDiscoveryService) return null;
    return this.challengeDiscoveryService.get(challengeDiscoveryId);
  }
}

function sameTarget(left: ExistingTabBrowserTarget, right: ExistingTabBrowserTarget): boolean {
  return left.workerId === right.workerId && left.resourceId === right.resourceId;
}

function sameOptionalTarget(
  left: ChallengeDiscoveryJob['browserTarget'],
  right: ExistingTabBrowserTarget
): boolean {
  return left?.mode === 'existing-tab' && sameTarget(left, right);
}
