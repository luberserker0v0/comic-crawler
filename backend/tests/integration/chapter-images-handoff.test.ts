import { afterEach, describe, expect, it, jest } from '@jest/globals';
import fastify from 'fastify';
import type { BrowserCommand } from '@comiccrawler/browser-client-sdk';
import { AdapterRegistry } from '../../src/adapter/registry';
import { ComixAdapter } from '../../src/adapter/sites/comix';
import { BrowserRenderService } from '../../src/browser/browser-render-service';
import { ChallengeDiscoveryService } from '../../src/challenge/discovery-service';
import type { ChallengeDiscoveryJob } from '../../src/challenge/discovery-types';
import { setupAdaptersRoutes } from '../../src/server/routes/adapters';
import type { IStorage } from '../../src/storage/types';

const CHAPTER_URL = 'https://comix.to/title/demo/123-chapter-1';
const TARGET = { mode: 'existing-tab' as const, workerId: 'worker-1', resourceId: 'resource-1' };
const CHALLENGE_HTML = '<html><title>Just a moment</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></html>';
const READER_HTML = `
  <html><body>
    <main class="rpage-main"><div class="rpage-main__inner">
      <div class="rpage-page" data-page="1"><img class="rpage-page__img" src="https://cdn.example/page-1.jpg"></div>
      <div class="rpage-page" data-page="2"><img class="rpage-page__img" src="https://cdn.example/page-2.jpg"></div>
    </div></main>
    <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
  </body></html>`;

describe('Integration: chapter-images existing-tab verification handoff', () => {
  const apps: Array<ReturnType<typeof fastify>> = [];
  const services: ChallengeDiscoveryService[] = [];

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.dispose()));
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('retains the selected tab and retries the same handoff after verification', async () => {
    const app = fastify();
    apps.push(app);
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    registry.register(new ComixAdapter());
    let html = CHALLENGE_HTML;
    let operationLeaseActive = false;
    const releaseChallengeLease = jest.fn(async () => undefined);
    const acquireBrowserSession = jest.fn(async (input: unknown) => {
      await waitForCondition(() => !operationLeaseActive);
      return { sessionId: 'challenge-session', release: releaseChallengeLease };
    });
    const renderService = new BrowserRenderService({
      execute: async (_sessionId: string, command: BrowserCommand) => {
        if (command.type === 'page.focus') return { type: command.type };
        if (command.type === 'page.navigate') return { type: command.type, url: command.url };
        if (command.type === 'page.get-content') return { type: command.type, url: CHAPTER_URL, html };
        return { type: command.type, url: CHAPTER_URL };
      },
    });
    const challengeService = new ChallengeDiscoveryService(storage, {
      browserRenderService: renderService,
      acquireBrowserSession,
      getBrowserConfig: async () => ({
        timeout: 1_000,
        workerWaitTimeoutMs: 1_000,
        postLoadDelayMs: 0,
      }),
    });
    services.push(challengeService);
    const withBrowserSession = jest.fn(async (
      _request: unknown,
      target: unknown,
      _url: string,
      _renderContext: unknown,
      action: (sessionId: string) => Promise<unknown>
    ) => {
      expect(target).toEqual(TARGET);
      operationLeaseActive = true;
      try {
        return await action('operation-session');
      } finally {
        operationLeaseActive = false;
      }
    });
    setupAdaptersRoutes(app, registry, {
      challengeDiscoveryService: challengeService,
      browserRenderService: renderService,
      withBrowserSession: withBrowserSession as any,
    });

    const challengedResponse = await app.inject({
      method: 'POST',
      url: '/api/adapters/chapter-images',
      payload: { url: CHAPTER_URL, browserTarget: TARGET },
    });
    expect(challengedResponse.statusCode).toBe(409);
    const challenged = challengedResponse.json();
    expect(challenged.code).toBe('CHAPTER_IMAGES_VERIFICATION_REQUIRED');
    expect(challenged.data).toMatchObject({
      errorCode: 'CHAPTER_IMAGES_VERIFICATION_REQUIRED',
      challengeStatus: 'queued',
      retryableAfterVerification: true,
      challenge: {
        status: 'queued',
        normalizedUrl: CHAPTER_URL,
        retryableAfterVerification: true,
        ownerUserId: 'public',
        browserTarget: TARGET,
      },
    });

    const challengeId = challenged.data.challengeDiscoveryId as string;
    const required = await waitForJob(challengeService, challengeId, 'challenge_required');
    expect(required).toMatchObject({
      ownerUserId: 'public',
      browserTarget: TARGET,
      browserSessionId: 'challenge-session',
    });
    expect(acquireBrowserSession).toHaveBeenCalledWith(expect.objectContaining({
      jobId: challengeId,
      ownerUserId: 'public',
      url: CHAPTER_URL,
      browserTarget: TARGET,
    }));

    html = READER_HTML;
    await expect(challengeService.completeHumanVerification(challengeId)).resolves.toMatchObject({ status: 'ready' });

    const retryResponse = await app.inject({
      method: 'POST',
      url: '/api/adapters/chapter-images',
      payload: { url: CHAPTER_URL, browserTarget: TARGET, challengeDiscoveryId: challengeId },
    });
    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json().data.imageUrls).toEqual([
      'https://cdn.example/page-1.jpg',
      'https://cdn.example/page-2.jpg',
    ]);
    expect(await challengeService.list()).toHaveLength(1);
    expect(acquireBrowserSession).toHaveBeenCalledTimes(1);
  });
});

async function waitForJob(
  service: ChallengeDiscoveryService,
  id: string,
  status: ChallengeDiscoveryJob['status']
): Promise<ChallengeDiscoveryJob> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await service.get(id);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Challenge job ${id} did not reach ${status}.`);
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
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
