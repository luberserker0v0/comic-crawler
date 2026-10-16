import { randomUUID } from 'node:crypto';
import type { BrowserConfig } from '@comiccrawler/shared';
import type { BrowserTarget } from '../task/manager';
import type { BrowserProviderRegistry } from './provider-registry';

export type BrowserLeaseState = 'active' | 'reconnecting' | 'releasing' | 'released';

export interface BrowserLease {
  leaseId: string;
  taskId: string;
  ownerUserId: string;
  workerId: string;
  processInstanceId: string;
  sessionId: string;
  state: BrowserLeaseState;
  acquiredAt: string;
  expiresAt: string;
  browserConfig: BrowserConfig;
  release(): Promise<void>;
}

export interface AcquireBrowserLeaseRequest {
  taskId: string;
  ownerUserId: string;
  target?: BrowserTarget;
  baseBrowserConfig: BrowserConfig;
  timeoutMs?: number;
  onWaiting?: (message: string) => void | Promise<void>;
}

/** Owns the task-to-worker reservation and the internal Playwright session lifecycle. */
export class BrowserLeaseCoordinator {
  private readonly leasesByWorker = new Map<string, BrowserLease>();
  private readonly leasesByTask = new Map<string, BrowserLease>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeRegistry: () => void;

  constructor(
    private readonly registry: BrowserProviderRegistry,
    private readonly defaultTimeoutMs = 30 * 60 * 1000
  ) {
    this.unsubscribeRegistry = registry.onChange(() => this.notifyChanged());
  }

  listWorkers(ownerUserId?: string): Array<Record<string, unknown>> {
    return this.registry.list(ownerUserId).map((worker) => {
      const workerId = String(worker.providerId);
      const lease = this.leasesByWorker.get(workerId);
      return {
        workerId,
        name: worker.providerName,
        ownerUserId: worker.ownerUserId,
        clientInstanceId: worker.clientInstanceId,
        status: worker.online ? (lease ? 'busy' : 'idle') : 'offline',
        online: worker.online,
        capabilities: (worker.descriptor as { capabilities?: unknown } | undefined)?.capabilities,
        activeTaskId: lease?.taskId,
        lastConnectedAt: worker.lastConnectedAt,
      };
    });
  }

  validateTarget(ownerUserId: string, target: BrowserTarget): void {
    if (target.mode === 'any') return;
    const record = this.registry.getRecord(target.workerId);
    if (!record || record.revokedAt || record.ownerUserId !== ownerUserId) {
      throw new Error(`Browser worker "${target.workerId}" was not found for this user.`);
    }
  }

  async acquire(request: AcquireBrowserLeaseRequest): Promise<BrowserLease> {
    const existing = this.leasesByTask.get(request.taskId);
    if (existing && existing.state !== 'released') return existing;
    const target = request.target ?? { mode: 'any' as const };
    this.validateTarget(request.ownerUserId, target);
    const timeoutMs = normalizeTimeout(request.timeoutMs ?? this.defaultTimeoutMs);
    const deadline = Date.now() + timeoutMs;
    let announcedWaiting = false;

    while (Date.now() < deadline) {
      const workerId = this.selectAvailableWorker(request.ownerUserId, target);
      if (workerId) {
        // Reserve synchronously before the asynchronous create-session request.
        const reservation = this.createReservation(request, workerId);
        this.leasesByWorker.set(workerId, reservation);
        this.leasesByTask.set(request.taskId, reservation);
        this.notifyChanged();
        try {
          const session = await this.registry.createSession(workerId, { ttlSeconds: 300 });
          reservation.sessionId = session.sessionId;
          reservation.expiresAt = session.expiresAt;
          reservation.browserConfig = this.registry.resolveBrowserConfig(request.baseBrowserConfig, session.sessionId);
          this.startHeartbeat(reservation);
          return reservation;
        } catch (error) {
          this.leasesByWorker.delete(workerId);
          this.leasesByTask.delete(request.taskId);
          this.notifyChanged();
          if (Date.now() >= deadline) throw error;
        }
      }

      if (!announcedWaiting) {
        announcedWaiting = true;
        const description = target.mode === 'specific'
          ? `Waiting for browser worker "${target.workerId}".`
          : 'Waiting for an available browser worker.';
        await request.onWaiting?.(description);
      }
      await this.waitForChange(Math.min(5_000, deadline - Date.now()));
    }

    const description = target.mode === 'specific'
      ? `Timed out waiting for browser worker "${target.workerId}".`
      : 'Timed out waiting for an available browser worker.';
    throw new Error(description);
  }

  async tryAcquire(request: AcquireBrowserLeaseRequest): Promise<BrowserLease | undefined> {
    const existing = this.leasesByTask.get(request.taskId);
    if (existing && existing.state !== 'released') return existing;
    const target = request.target ?? { mode: 'any' as const };
    this.validateTarget(request.ownerUserId, target);
    const workerId = this.selectAvailableWorker(request.ownerUserId, target);
    if (!workerId) return undefined;
    const reservation = this.createReservation(request, workerId);
    this.leasesByWorker.set(workerId, reservation);
    this.leasesByTask.set(request.taskId, reservation);
    this.notifyChanged();
    try {
      const session = await this.registry.createSession(workerId, { ttlSeconds: 300 });
      reservation.sessionId = session.sessionId;
      reservation.expiresAt = session.expiresAt;
      reservation.browserConfig = this.registry.resolveBrowserConfig(request.baseBrowserConfig, session.sessionId);
      this.startHeartbeat(reservation);
      return reservation;
    } catch {
      this.leasesByWorker.delete(workerId);
      this.leasesByTask.delete(request.taskId);
      this.notifyChanged();
      return undefined;
    }
  }

  async waitForReconnect(lease: BrowserLease, timeoutMs = 120_000): Promise<boolean> {
    const deadline = Date.now() + normalizeTimeout(timeoutMs);
    lease.state = 'reconnecting';
    while (Date.now() < deadline) {
      if (this.registry.isOnline(lease.workerId)
        && this.registry.getProcessInstanceId(lease.workerId) === lease.processInstanceId
        && this.registry.getSession(lease.sessionId)) {
        lease.state = 'active';
        return true;
      }
      await this.waitForChange(Math.min(5_000, deadline - Date.now()));
    }
    return false;
  }

  async releaseTask(taskId: string): Promise<void> {
    await this.leasesByTask.get(taskId)?.release();
  }

  async dispose(): Promise<void> {
    this.unsubscribeRegistry();
    await Promise.all([...this.leasesByWorker.values()].map((lease) => lease.release()));
    this.listeners.clear();
  }

  private selectAvailableWorker(ownerUserId: string, target: BrowserTarget): string | undefined {
    const records = this.registry.list(ownerUserId);
    return records.find((worker) => {
      const workerId = String(worker.providerId);
      return worker.online === true
        && !this.leasesByWorker.has(workerId)
        && (target.mode === 'any' || target.workerId === workerId);
    })?.providerId as string | undefined;
  }

  private createReservation(request: AcquireBrowserLeaseRequest, workerId: string): BrowserLease {
    let heartbeat: NodeJS.Timeout | undefined;
    let released = false;
    const lease: BrowserLease = {
      leaseId: `lease_${randomUUID()}`,
      taskId: request.taskId,
      ownerUserId: request.ownerUserId,
      workerId,
      processInstanceId: this.registry.getProcessInstanceId(workerId) ?? '',
      sessionId: '',
      state: 'active',
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      browserConfig: request.baseBrowserConfig,
      release: async () => {
        if (released) return;
        released = true;
        lease.state = 'releasing';
        if (heartbeat) clearInterval(heartbeat);
        if (lease.sessionId && this.registry.getSession(lease.sessionId)) {
          await this.registry.closeSession(lease.sessionId).catch(() => undefined);
        }
        lease.state = 'released';
        if (this.leasesByWorker.get(workerId) === lease) this.leasesByWorker.delete(workerId);
        if (this.leasesByTask.get(request.taskId) === lease) this.leasesByTask.delete(request.taskId);
        this.notifyChanged();
      },
    };
    Object.defineProperty(lease, '__setHeartbeat', { value: (value: NodeJS.Timeout) => { heartbeat = value; } });
    return lease;
  }

  private startHeartbeat(lease: BrowserLease): void {
    const timer = setInterval(() => {
      void this.registry.heartbeat(lease.sessionId, 300).then((session) => {
        lease.expiresAt = session.expiresAt;
        lease.state = 'active';
      }).catch(() => {
        lease.state = 'reconnecting';
      });
    }, 60_000);
    timer.unref();
    (lease as BrowserLease & { __setHeartbeat(value: NodeJS.Timeout): void }).__setHeartbeat(timer);
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

function normalizeTimeout(value: number): number {
  if (!Number.isFinite(value)) return 30 * 60 * 1000;
  return Math.max(1, Math.floor(value));
}
