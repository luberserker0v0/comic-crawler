import { describe, expect, it } from '@jest/globals';
import { BrowserLeaseCoordinator } from '../../../src/browser/lease-coordinator';
import type { BrowserProviderRegistry } from '../../../src/browser/provider-registry';

class FakeRegistry {
  readonly records = new Map([
    ['worker-a', { providerId: 'worker-a', ownerUserId: 'alice', providerName: 'Alice PC', online: true }],
    ['worker-b', { providerId: 'worker-b', ownerUserId: 'bob', providerName: 'Bob PC', online: true }],
  ]);
  readonly sessions = new Map<string, any>();
  readonly listeners = new Set<() => void>();
  closed: string[] = [];
  sequence = 0;
  processInstanceId = 'process-test';

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(ownerUserId?: string) {
    return [...this.records.values()].filter((record) => !ownerUserId || record.ownerUserId === ownerUserId);
  }

  getRecord(workerId: string) {
    return this.records.get(workerId);
  }

  isOnline(workerId: string) {
    return this.records.get(workerId)?.online === true;
  }

  getProcessInstanceId() {
    return this.processInstanceId;
  }

  async createSession(workerId: string) {
    const sessionId = `session-${++this.sequence}`;
    const session = {
      sessionId,
      providerId: workerId,
      connectUrl: `ws://relay/${sessionId}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      capabilities: {},
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  resolveBrowserConfig(base: any, sessionId: string) {
    return { ...base, remote: { wsEndpoint: `ws://relay/${sessionId}` } };
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  async heartbeat(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  async closeSession(sessionId: string) {
    this.closed.push(sessionId);
    this.sessions.delete(sessionId);
  }
}

const browserConfig = {
  mode: 'remote' as const,
  maxInstances: 1,
  timeout: 30_000,
  waitUntil: 'domcontentloaded' as const,
  challengeAutoAttempt: true,
  challengeWaitMs: 15_000,
};

describe('BrowserLeaseCoordinator', () => {
  it('selects only a worker owned by the authenticated task user', async () => {
    const registry = new FakeRegistry();
    const coordinator = new BrowserLeaseCoordinator(registry as unknown as BrowserProviderRegistry, 50);

    expect(() => coordinator.validateTarget('alice', { mode: 'specific', workerId: 'worker-b' }))
      .toThrow('not found for this user');

    const lease = await coordinator.acquire({
      taskId: 'task-a',
      ownerUserId: 'alice',
      target: { mode: 'any' },
      baseBrowserConfig: browserConfig,
    });
    expect(lease.workerId).toBe('worker-a');
    expect(lease.browserConfig.remote?.wsEndpoint).toContain(lease.sessionId);
    await lease.release();
  });

  it('allows one task per worker and wakes the next waiter after release', async () => {
    const registry = new FakeRegistry();
    const coordinator = new BrowserLeaseCoordinator(registry as unknown as BrowserProviderRegistry, 500);
    const first = await coordinator.acquire({
      taskId: 'task-1', ownerUserId: 'alice', target: { mode: 'any' }, baseBrowserConfig: browserConfig,
    });
    let secondResolved = false;
    const secondPromise = coordinator.acquire({
      taskId: 'task-2', ownerUserId: 'alice', target: { mode: 'any' }, baseBrowserConfig: browserConfig,
    }).then((lease) => { secondResolved = true; return lease; });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondResolved).toBe(false);
    expect(coordinator.listWorkers('alice')[0]).toMatchObject({ status: 'busy', activeTaskId: 'task-1' });

    await first.release();
    const second = await secondPromise;
    expect(second.workerId).toBe('worker-a');
    expect(registry.closed).toContain(first.sessionId);
    await second.release();
  });

  it('keeps the same lease for a resumed task', async () => {
    const registry = new FakeRegistry();
    const coordinator = new BrowserLeaseCoordinator(registry as unknown as BrowserProviderRegistry, 50);
    const first = await coordinator.acquire({
      taskId: 'task-1', ownerUserId: 'alice', target: { mode: 'any' }, baseBrowserConfig: browserConfig,
    });
    const resumed = await coordinator.acquire({
      taskId: 'task-1', ownerUserId: 'alice', target: { mode: 'any' }, baseBrowserConfig: browserConfig,
    });
    expect(resumed).toBe(first);
    expect(registry.sequence).toBe(1);
    await resumed.release();
  });

  it('does not resume a lease after the Worker process has restarted', async () => {
    const registry = new FakeRegistry();
    const coordinator = new BrowserLeaseCoordinator(registry as unknown as BrowserProviderRegistry, 50);
    const lease = await coordinator.acquire({
      taskId: 'task-1', ownerUserId: 'alice', target: { mode: 'any' }, baseBrowserConfig: browserConfig,
    });
    registry.processInstanceId = 'process-restarted';

    await expect(coordinator.waitForReconnect(lease, 20)).resolves.toBe(false);
    await lease.release();
  });
});
