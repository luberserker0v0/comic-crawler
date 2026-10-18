import { randomUUID } from 'node:crypto';
import type { BrowserRenderContext, BrowserSessionSource } from '@comiccrawler/browser-client-sdk';
import type { BrowserTarget } from '../task/manager';
import type { BrowserSessionGateway, BrowserWorker, GatewaySession } from './browser-session-gateway';
import { normalizeBrowserResourceUrl } from './browser-resource-url';

export type BrowserWorkerLeaseState = 'active' | 'reconnecting' | 'releasing' | 'released';

export interface BrowserWorkerLease {
  leaseId: string;
  taskId: string;
  ownerUserId: string;
  workerId: string;
  processInstanceId: string;
  sessionId: string;
  source: BrowserSessionSource;
  state: BrowserWorkerLeaseState;
  acquiredAt: string;
  release(): Promise<void>;
}

export interface AcquireBrowserWorkerLeaseRequest {
  taskId: string;
  ownerUserId: string;
  target?: BrowserTarget;
  initialUrl?: string;
  renderContext?: BrowserRenderContext;
  timeoutMs?: number;
  onWaiting?: (message: string) => void | Promise<void>;
}

export interface ValidateExistingTabRecoveryTargetRequest {
  ownerUserId: string;
  target: Extract<BrowserTarget, { mode: 'existing-tab' }>;
  expectedUrl: string;
  requireHumanHandoff: boolean;
}

type GatewayPort = Pick<
  BrowserSessionGateway,
  'listWorkers' | 'getWorker' | 'getResource' | 'openSession' | 'closeSession' | 'onChange'
>;

export class BrowserWorkerLeaseCoordinator {
  private readonly leasesByWorker = new Map<string, BrowserWorkerLease>();
  private readonly leasesByTask = new Map<string, BrowserWorkerLease>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeGateway: () => void;

  constructor(
    private readonly gateway: GatewayPort,
    private readonly defaultTimeoutMs = 30 * 60 * 1000
  ) {
    this.unsubscribeGateway = gateway.onChange(() => this.notifyChanged());
  }

  listWorkers(ownerUserId?: string): Array<Record<string, unknown>> {
    return this.gateway.listWorkers(ownerUserId).map((worker) => {
      const lease = this.leasesByWorker.get(worker.workerId);
      return {
        ...worker,
        status: worker.online ? (lease ? 'busy' : 'idle') : 'offline',
        activeTaskId: lease?.taskId,
      };
    });
  }

  validateTarget(ownerUserId: string, target: BrowserTarget): void {
    const workerId = target.workerId;
    if (!workerId) return;
    const worker = this.gateway.getWorker(workerId);
    if (!worker || worker.ownerUserId !== ownerUserId) {
      throw new Error(`Browser Worker "${workerId}" was not found for this user.`);
    }
    if (worker.capabilities.executionMode !== target.mode) {
      throw new Error(`Browser Worker "${workerId}" does not support ${target.mode}.`);
    }
    if (target.mode === 'existing-tab') {
      const resource = this.gateway.getResource(target.resourceId);
      if (!resource || resource.workerId !== workerId || resource.ownerUserId !== ownerUserId) {
        throw new Error(`Browser resource "${target.resourceId}" was not found for this Worker.`);
      }
    }
  }

  validateExistingTabRecoveryTarget(request: ValidateExistingTabRecoveryTargetRequest): { resourceUrl: string } {
    this.validateTarget(request.ownerUserId, request.target);
    const worker = this.gateway.getWorker(request.target.workerId)!;
    const resource = this.gateway.getResource(request.target.resourceId)!;
    if (!worker.online) {
      throw new Error(`Browser Worker "${worker.workerId}" is offline.`);
    }
    if (worker.activeSessionId || this.leasesByWorker.has(worker.workerId)) {
      throw new Error(`Browser Worker "${worker.workerId}" is busy.`);
    }
    if (!worker.capabilities.navigation || !worker.capabilities.renderedDom) {
      throw new Error(`Browser Worker "${worker.workerId}" does not provide the capabilities required by this task.`);
    }
    if (request.requireHumanHandoff && !worker.capabilities.humanHandoff) {
      throw new Error(`Browser Worker "${worker.workerId}" does not support human verification handoff.`);
    }
    if (normalizeBrowserResourceUrl(resource.url) !== normalizeBrowserResourceUrl(request.expectedUrl)) {
      throw new Error(`Browser resource "${resource.resourceId}" is not on the task target URL.`);
    }
    return { resourceUrl: resource.url };
  }

  async acquire(request: AcquireBrowserWorkerLeaseRequest): Promise<BrowserWorkerLease> {
    const existing = this.leasesByTask.get(request.taskId);
    if (existing && existing.state !== 'released') return existing;
    const target = request.target ?? { mode: 'managed-profile' as const };
    this.validateTarget(request.ownerUserId, target);
    const deadline = Date.now() + normalizeTimeout(request.timeoutMs ?? this.defaultTimeoutMs);
    let announcedWaiting = false;

    while (Date.now() < deadline) {
      const worker = this.selectAvailableWorker(request.ownerUserId, target);
      if (worker) {
        const lease = this.reserve(request, worker);
        try {
          const session = await this.openSession(lease, request);
          lease.sessionId = session.sessionId;
          return lease;
        } catch (error) {
          this.removeReservation(lease);
          if (Date.now() >= deadline) throw error;
        }
      }
      if (!announcedWaiting) {
        announcedWaiting = true;
        await request.onWaiting?.(waitingMessage(target, false));
      }
      await this.waitForChange(Math.min(5_000, deadline - Date.now()));
    }
    throw new Error(waitingMessage(target, true));
  }

  async tryAcquire(request: AcquireBrowserWorkerLeaseRequest): Promise<BrowserWorkerLease | undefined> {
    const existing = this.leasesByTask.get(request.taskId);
    if (existing && existing.state !== 'released') return existing;
    const target = request.target ?? { mode: 'managed-profile' as const };
    this.validateTarget(request.ownerUserId, target);
    const worker = this.selectAvailableWorker(request.ownerUserId, target);
    if (!worker) return undefined;
    const lease = this.reserve(request, worker);
    try {
      const session = await this.openSession(lease, request);
      lease.sessionId = session.sessionId;
      return lease;
    } catch {
      this.removeReservation(lease);
      return undefined;
    }
  }

  async waitForReconnect(lease: BrowserWorkerLease, timeoutMs = 120_000): Promise<boolean> {
    const deadline = Date.now() + normalizeTimeout(timeoutMs);
    lease.state = 'reconnecting';
    while (Date.now() < deadline) {
      if (isReleased(lease)) return false;
      const worker = this.gateway.getWorker(lease.workerId);
      if (worker?.online && worker.processInstanceId === lease.processInstanceId) {
        try {
          const session = await this.gateway.openSession({
            workerId: lease.workerId,
            leaseId: lease.leaseId,
            sessionId: lease.sessionId,
            source: lease.source,
          });
          lease.sessionId = session.sessionId;
          lease.state = 'active';
          return true;
        } catch {
          // The Worker may still be finishing disconnect cleanup.
        }
      }
      await this.waitForChange(Math.min(5_000, deadline - Date.now()));
    }
    return false;
  }

  async releaseTask(taskId: string): Promise<void> {
    await this.leasesByTask.get(taskId)?.release();
  }

  async dispose(): Promise<void> {
    this.unsubscribeGateway();
    await Promise.all([...this.leasesByWorker.values()].map((lease) => lease.release()));
    this.listeners.clear();
  }

  private selectAvailableWorker(ownerUserId: string, target: BrowserTarget): BrowserWorker | undefined {
    return this.gateway.listWorkers(ownerUserId).find((worker) =>
      worker.online
      && !worker.activeSessionId
      && !this.leasesByWorker.has(worker.workerId)
      && worker.capabilities.executionMode === target.mode
      && (target.mode !== 'managed-profile' || !target.workerId || target.workerId === worker.workerId)
      && (target.mode !== 'existing-tab' || target.workerId === worker.workerId));
  }

  private reserve(request: AcquireBrowserWorkerLeaseRequest, worker: BrowserWorker): BrowserWorkerLease {
    const target = request.target ?? { mode: 'managed-profile' as const };
    const source = sessionSource(target, request.initialUrl);
    let released = false;
    const lease: BrowserWorkerLease = {
      leaseId: `lease_${randomUUID()}`,
      taskId: request.taskId,
      ownerUserId: request.ownerUserId,
      workerId: worker.workerId,
      processInstanceId: worker.processInstanceId,
      sessionId: '',
      source,
      state: 'active',
      acquiredAt: new Date().toISOString(),
      release: async () => {
        if (released) return;
        released = true;
        lease.state = 'releasing';
        if (lease.sessionId) await this.gateway.closeSession(lease.sessionId).catch(() => undefined);
        lease.state = 'released';
        this.removeReservation(lease);
      },
    };
    this.leasesByWorker.set(worker.workerId, lease);
    this.leasesByTask.set(request.taskId, lease);
    this.notifyChanged();
    return lease;
  }

  private openSession(
    lease: BrowserWorkerLease,
    request: AcquireBrowserWorkerLeaseRequest
  ): Promise<GatewaySession> {
    return this.gateway.openSession({
      workerId: lease.workerId,
      leaseId: lease.leaseId,
      source: lease.source,
      renderContext: request.renderContext,
    });
  }

  private removeReservation(lease: BrowserWorkerLease): void {
    if (this.leasesByWorker.get(lease.workerId) === lease) this.leasesByWorker.delete(lease.workerId);
    if (this.leasesByTask.get(lease.taskId) === lease) this.leasesByTask.delete(lease.taskId);
    this.notifyChanged();
  }

  private waitForChange(timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.listeners.delete(done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      timer.unref();
      this.listeners.add(done);
    });
  }

  private notifyChanged(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function waitingMessage(target: BrowserTarget, timedOut: boolean): string {
  const prefix = timedOut ? 'Timed out waiting for' : 'Waiting for';
  return target.mode === 'existing-tab' || target.workerId
    ? `${prefix} Browser Worker "${target.workerId}".`
    : `${prefix} an available managed-profile Browser Worker.`;
}

function sessionSource(target: BrowserTarget, initialUrl: string | undefined): BrowserSessionSource {
  if (target.mode === 'existing-tab') {
    if (!initialUrl) throw new Error('An existing-tab Browser session requires the target URL.');
    return {
      type: 'existing-resource',
      resourceId: target.resourceId,
      expectedUrl: initialUrl,
      navigationPolicy: 'adopt-current-page',
    };
  }
  return {
    type: 'managed-profile',
    initialUrl,
    navigationPolicy: 'navigate-to-target',
  };
}

function normalizeTimeout(value: number): number {
  if (!Number.isFinite(value)) return 30 * 60 * 1000;
  return Math.max(1, Math.floor(value));
}

function isReleased(lease: BrowserWorkerLease): boolean {
  return lease.state === 'releasing' || lease.state === 'released';
}
