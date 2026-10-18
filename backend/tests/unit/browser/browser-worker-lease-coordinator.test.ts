import type { BrowserCapabilities } from '@comiccrawler/browser-client-sdk';
import type { BrowserResource, BrowserWorker, GatewaySession, OpenGatewaySessionRequest } from '../../../src/browser/browser-session-gateway';
import { BrowserWorkerLeaseCoordinator } from '../../../src/browser/browser-worker-lease-coordinator';

const capabilities: BrowserCapabilities = {
  executionMode: 'managed-profile',
  navigation: true,
  renderedDom: true,
  humanHandoff: true,
  responsiveViewport: true,
};

describe('BrowserWorkerLeaseCoordinator', () => {
  it('reserves one Worker per task and owns its session lifecycle', async () => {
    const gateway = new FakeGateway([worker('worker-a', 'alice')]);
    const coordinator = new BrowserWorkerLeaseCoordinator(gateway);
    const lease = await coordinator.acquire({
      taskId: 'task-1',
      ownerUserId: 'alice',
      target: { mode: 'managed-profile', workerId: 'worker-a' },
      initialUrl: 'https://example.test/chapter',
    });

    expect(lease.workerId).toBe('worker-a');
    expect(lease.sessionId).toBe('session-1');
    expect(gateway.opened[0]).toMatchObject({
      workerId: 'worker-a',
      leaseId: lease.leaseId,
      source: {
        type: 'managed-profile',
        initialUrl: 'https://example.test/chapter',
        navigationPolicy: 'navigate-to-target',
      },
    });
    expect(coordinator.listWorkers('alice')[0]).toMatchObject({ status: 'busy', activeTaskId: 'task-1' });
    await expect(coordinator.tryAcquire({ taskId: 'task-2', ownerUserId: 'alice' })).resolves.toBeUndefined();

    await lease.release();
    expect(gateway.closed).toEqual(['session-1']);
    expect(coordinator.listWorkers('alice')[0]).toMatchObject({ status: 'idle' });
    await coordinator.dispose();
  });

  it('does not allow a user to target another owner Worker', () => {
    const coordinator = new BrowserWorkerLeaseCoordinator(new FakeGateway([worker('worker-b', 'bob')]));
    expect(() => coordinator.validateTarget('alice', {
      mode: 'managed-profile',
      workerId: 'worker-b',
    })).toThrow('was not found for this user');
  });

  it('binds an existing-tab task to its exact Worker resource', async () => {
    const existingWorker = worker('worker-tab', 'alice', 'existing-tab');
    const resource: BrowserResource = {
      resourceId: 'resource-1',
      workerId: existingWorker.workerId,
      ownerUserId: 'alice',
      kind: 'tab',
      url: 'https://example.test/chapter',
      registeredAt: new Date().toISOString(),
    };
    const gateway = new FakeGateway([existingWorker], [resource]);
    const coordinator = new BrowserWorkerLeaseCoordinator(gateway);

    const lease = await coordinator.acquire({
      taskId: 'task-tab',
      ownerUserId: 'alice',
      target: { mode: 'existing-tab', workerId: existingWorker.workerId, resourceId: resource.resourceId },
      initialUrl: resource.url,
    });

    expect(lease.source).toEqual({
      type: 'existing-resource',
      resourceId: resource.resourceId,
      expectedUrl: resource.url,
      navigationPolicy: 'adopt-current-page',
    });
    await lease.release();
    await coordinator.dispose();
  });

  it('rejects a resource owned by another Worker of the same user', async () => {
    const first = worker('worker-tab-a', 'alice', 'existing-tab');
    const second = worker('worker-tab-b', 'alice', 'existing-tab');
    const resource: BrowserResource = {
      resourceId: 'resource-a',
      workerId: first.workerId,
      ownerUserId: 'alice',
      kind: 'tab',
      url: 'https://example.test/chapter',
      registeredAt: new Date().toISOString(),
    };
    const coordinator = new BrowserWorkerLeaseCoordinator(new FakeGateway([first, second], [resource]));

    expect(() => coordinator.validateTarget('alice', {
      mode: 'existing-tab',
      workerId: second.workerId,
      resourceId: resource.resourceId,
    })).toThrow('was not found for this Worker');
    await coordinator.dispose();
  });

  it('reopens a session on the same process after reconnect', async () => {
    const gateway = new FakeGateway([worker('worker-a', 'alice')]);
    const coordinator = new BrowserWorkerLeaseCoordinator(gateway);
    const lease = await coordinator.acquire({ taskId: 'task-1', ownerUserId: 'alice' });
    gateway.workers[0]!.online = false;
    gateway.workers[0]!.activeSessionId = undefined;
    gateway.workers[0]!.online = true;

    await expect(coordinator.waitForReconnect(lease, 100)).resolves.toBe(true);
    expect(lease.sessionId).toBe('session-2');
    expect(lease.state).toBe('active');
    await lease.release();
    await coordinator.dispose();
  });
});

class FakeGateway {
  readonly opened: OpenGatewaySessionRequest[] = [];
  readonly closed: string[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(readonly workers: BrowserWorker[], readonly resources: BrowserResource[] = []) {}

  listWorkers(ownerUserId?: string): BrowserWorker[] {
    return this.workers.filter((entry) => ownerUserId === undefined || entry.ownerUserId === ownerUserId);
  }
  getWorker(workerId: string): BrowserWorker | undefined {
    return this.workers.find((entry) => entry.workerId === workerId);
  }
  getResource(resourceId: string): BrowserResource | undefined {
    return this.resources.find((entry) => entry.resourceId === resourceId);
  }
  async openSession(request: OpenGatewaySessionRequest): Promise<GatewaySession> {
    this.opened.push(request);
    const target = this.getWorker(request.workerId);
    if (!target?.online) throw new Error('offline');
    const sessionId = `session-${this.opened.length}`;
    target.activeSessionId = sessionId;
    return {
      sessionId,
      leaseId: request.leaseId,
      workerId: request.workerId,
      ownerUserId: target.ownerUserId,
      source: request.source,
      initialPageClaimed: false,
      state: 'active',
      openedAt: new Date().toISOString(),
    };
  }
  async closeSession(sessionId: string): Promise<void> {
    this.closed.push(sessionId);
    const target = this.workers.find((entry) => entry.activeSessionId === sessionId);
    if (target) target.activeSessionId = undefined;
  }
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function worker(
  workerId: string,
  ownerUserId: string,
  executionMode: BrowserCapabilities['executionMode'] = 'managed-profile'
): BrowserWorker {
  return {
    workerId,
    clientId: `client-${ownerUserId}`,
    name: `Worker ${workerId}`,
    ownerUserId,
    processInstanceId: `process-${workerId}`,
    capabilities: { ...capabilities, executionMode },
    connectedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    online: true,
  };
}
