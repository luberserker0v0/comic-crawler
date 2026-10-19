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
    const task = this.taskManager.getTask(input.taskId);
    if (!task) {
      throw new BrowserTargetRebindError(`Task "${input.taskId}" was not found.`, 'NOT_FOUND');
    }
    if ((task.data.ownerUserId ?? 'public') !== input.ownerUserId) {
      throw new BrowserTargetRebindError('The authenticated user does not own this task.', 'FORBIDDEN');
    }

    const matchingEvent = [...this.taskManager.getEvents(input.taskId)].reverse().find((event) =>
      sameTarget(event.previousBrowserTarget, input.expectedBrowserTarget)
      && sameTarget(event.browserTarget, input.browserTarget));
    const currentTarget = task.data.browserTarget;
    if (currentTarget?.mode === 'existing-tab'
      && sameTarget(currentTarget, input.browserTarget)
      && matchingEvent) {
      return this.finishHandoffRecovery(
        { task, event: matchingEvent, idempotent: true },
        input.browserTarget
      );
    }
    if (currentTarget?.mode !== 'existing-tab') {
      throw new BrowserTargetRebindError('Only existing-tab tasks can rebind their Browser Target.', 'INVALID_TARGET');
    }
    if (!sameTarget(currentTarget, input.expectedBrowserTarget)) {
      throw new BrowserTargetRebindError('The task Browser Target changed after it was inspected.', 'STALE_TARGET');
    }
    if (task.status === 'waiting_verification' && !this.challengeDiscoveryService) {
      throw new BrowserTargetRebindError(
        'Human verification recovery is not available because challenge discovery is not configured.',
        'INVALID_STATE'
      );
    }

    const challenge = await this.currentChallenge(input.taskId);
    const expectedUrl = task.status === 'waiting_verification'
      ? challenge?.normalizedUrl ?? task.data.chapterUrls?.[0] ?? task.data.url
      : task.data.url;
    let resourceUrl: string;
    try {
      ({ resourceUrl } = this.leaseCoordinator.validateExistingTabRecoveryTarget({
        ownerUserId: input.ownerUserId,
        target: input.browserTarget,
        expectedUrl,
        requireHumanHandoff: task.status === 'waiting_verification',
      }));
    } catch (error) {
      throw new BrowserTargetRebindError(
        error instanceof Error ? error.message : String(error),
        'INVALID_TARGET'
      );
    }

    const rebound = await this.taskManager.rebindBrowserTarget({
      ...input,
      browserTargetUrl: resourceUrl,
    });
    if (!rebound.idempotent) await this.leaseCoordinator.releaseTask(input.taskId);
    return this.finishHandoffRecovery(rebound, input.browserTarget, challenge);
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
    let challenge = current;
    if (!current || !sameOptionalTarget(current.browserTarget, browserTarget) || !rebound.idempotent) {
      challenge = current
        ? await this.challengeDiscoveryService.rebindBrowserTarget(current.id, browserTarget)
        : await this.challengeDiscoveryService.create({
            url: rebound.task.data.chapterUrls?.[0] ?? rebound.task.data.url,
            ownerUserId: rebound.task.data.ownerUserId,
            browserTarget,
          });
    }
    if (challenge) {
      await this.taskManager.updateResult(rebound.task.id, {
        challengeDiscoveryId: challenge.id,
        challengeStatus: challenge.status,
        error: challenge.error,
      });
      await this.taskManager.updateTaskError(rebound.task.id, challenge.error);
    }
    return { ...rebound, ...(challenge ? { challenge } : {}) };
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
