import type { BrowserCommand } from '@comiccrawler/browser-client-sdk';
import { BrowserRenderService } from '../../../src/browser/browser-render-service';
import { ChallengeDiscoveryService } from '../../../src/challenge/discovery-service';
import type { ChallengeDiscoveryJob } from '../../../src/challenge/discovery-types';
import type { IStorage } from '../../../src/storage/types';

describe('Browser Worker verification handoff', () => {
  it('retains an asynchronously acquired ready session for the follow-up operation', async () => {
    const storage = new MemoryStorage();
    const release = jest.fn(async () => undefined);
    const renderService = new BrowserRenderService({
      execute: async (_sessionId, command) => {
        if (command.type === 'page.get-url') return { type: command.type, url: 'about:blank' };
        if (command.type === 'page.navigate') return { type: command.type, url: command.url };
        if (command.type === 'page.get-content') {
          return { type: command.type, url: 'https://example.com/chapter', html: '<main class="reader"><img src="/1.jpg"></main>' };
        }
        if (command.type === 'page.focus') return { type: command.type };
        return { type: command.type, url: 'https://example.com/chapter' };
      },
    });
    const acquireBrowserSession = jest.fn(async () => ({ sessionId: 'session-ready', release }));
    const service = new ChallengeDiscoveryService(storage, {
      browserRenderService: renderService,
      acquireBrowserSession,
    });

    const browserTarget = { mode: 'existing-tab' as const, workerId: 'worker-1', resourceId: 'resource-1' };
    const queued = await service.createDeferred({
      url: 'https://example.com/chapter',
      ownerUserId: 'alice',
      browserTarget,
    });
    const ready = await waitForJob(service, queued.id, 'ready');

    expect(ready.browserSessionId).toBe('session-ready');
    expect(ready.ownerUserId).toBe('alice');
    expect(ready.browserTarget).toEqual(browserTarget);
    expect(acquireBrowserSession).toHaveBeenCalledWith({
      jobId: queued.id,
      ownerUserId: 'alice',
      url: 'https://example.com/chapter',
      browserTarget,
    });
    expect(release).not.toHaveBeenCalled();
    await service.deleteJob(queued.id);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('moves a deferred handoff to failed when Browser Worker acquisition times out', async () => {
    const storage = new MemoryStorage();
    const service = new ChallengeDiscoveryService(storage, {
      acquireBrowserSession: async () => {
        throw new Error('Browser Worker acquisition timed out.');
      },
    });

    const queued = await service.createDeferred({
      url: 'https://example.com/chapter',
      ownerUserId: 'alice',
      browserTarget: { mode: 'existing-tab', workerId: 'worker-1', resourceId: 'resource-1' },
    });

    await expect(waitForJob(service, queued.id, 'failed')).resolves.toMatchObject({
      error: 'Browser Worker acquisition timed out.',
    });
  });

  it('keeps cancellation terminal while a deferred Browser Worker lease is pending', async () => {
    const storage = new MemoryStorage();
    const release = jest.fn(async () => undefined);
    let resolveAcquire!: (lease: { sessionId: string; release(): Promise<void> }) => void;
    let notifyAcquireStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyAcquireStarted = resolve; });
    const service = new ChallengeDiscoveryService(storage, {
      acquireBrowserSession: async () => {
        notifyAcquireStarted();
        return new Promise((resolveLease) => { resolveAcquire = resolveLease; });
      },
    });

    const queued = await service.createDeferred({ url: 'https://example.com/chapter' });
    await started;
    await expect(service.cancel(queued.id)).resolves.toMatchObject({ status: 'cancelled' });
    resolveAcquire({ sessionId: 'late-session', release });
    await waitForCondition(() => release.mock.calls.length === 1);

    await expect(service.get(queued.id)).resolves.toMatchObject({
      status: 'cancelled',
      browserSessionId: undefined,
    });
    await expect(service.retry(queued.id)).rejects.toThrow('is cancelled');
  });

  it('focuses and inspects the task-bound session without a Playwright BrowserContext', async () => {
    const storage = new MemoryStorage();
    const commands: BrowserCommand[] = [];
    let html = '<html><title>Checking</title><div>cf-chl-widget</div></html>';
    const renderService = new BrowserRenderService({
      execute: async (_sessionId, command) => {
        commands.push(command);
        if (command.type === 'page.navigate') return { type: command.type, url: command.url };
        if (command.type === 'page.focus') return { type: command.type };
        if (command.type === 'page.get-content') {
          return { type: command.type, url: 'https://example.test/chapter', html };
        }
        if (command.type === 'page.get-url') return { type: command.type, url: 'https://example.test/chapter' };
        return { type: command.type, url: 'https://example.test/chapter' };
      },
    });
    const service = new ChallengeDiscoveryService(storage, {
      browserRenderService: renderService,
      getBrowserConfig: async () => ({
        timeout: 30_000,
        workerWaitTimeoutMs: 30 * 60 * 1000,
        postLoadDelayMs: 0,
      }),
    });
    const job: ChallengeDiscoveryJob = {
      id: 'challenge-1',
      url: 'https://example.test/chapter',
      normalizedUrl: 'https://example.test/chapter',
      hostname: 'example.test',
      status: 'challenge_required',
      browserSessionId: 'session-1',
      createdAt: '2026-10-16T00:00:00.000Z',
      updatedAt: '2026-10-16T00:00:00.000Z',
    };
    await storage.write('challenge-discovery-job-challenge-1', job);
    await storage.write('challenge-discovery-index', [job.id]);

    await expect(service.openBrowser(job.id)).resolves.toMatchObject({ status: 'browser_open' });
    expect(commands.map((command) => command.type)).toEqual(['page.focus']);
    await expect(service.readRemotePageSnapshot(job.id)).rejects.toThrow('still shows a challenge');
    await expect(service.get(job.id)).resolves.toMatchObject({ status: 'challenge_required' });

    html = '<html><title>Chapter</title><main class="reader">ready</main></html>';
    await expect(service.completeHumanVerification(job.id)).resolves.toMatchObject({ status: 'ready' });
    await expect(service.readRemotePageSnapshot(job.id)).resolves.toMatchObject({
      page: {
        url: 'https://example.test/chapter',
        title: 'Chapter',
        html,
      },
    });

    commands.length = 0;
    await service.readRemotePageSnapshot(job.id, { settle: true });
    expect(commands.map((command) => command.type)).toEqual([
      'page.get-content',
      'page.get-url',
      'page.wait-for-ready',
      'page.prepare-content',
      'page.get-content',
    ]);
  });
});

async function waitForJob(
  service: ChallengeDiscoveryService,
  id: string,
  status: ChallengeDiscoveryJob['status']
): Promise<ChallengeDiscoveryJob> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = await service.get(id);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Challenge job ${id} did not reach ${status}.`);
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Condition was not satisfied.');
}

class MemoryStorage implements IStorage {
  private readonly values = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }
  async write(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
  async list(): Promise<string[]> {
    return [...this.values.keys()];
  }
  async exists(key: string): Promise<boolean> {
    return this.values.has(key);
  }
}
