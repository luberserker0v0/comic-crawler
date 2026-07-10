import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../../src/events/bus';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { AgentAdminService } from '../../../src/agent/admin-service';
import { ComicCrawlerServer } from '../../../src/server/app';
import { JsonFileStore } from '../../../src/storage/json-store';
import { ConfigManager } from '../../../src/config/manager';
import { TaskManager } from '../../../src/task/manager';
import { CrawlerEngine } from '../../../src/crawler/engine';
import type { IComicAdapter } from '@comiccrawler/shared';
import { VersionManager } from '../../../src/agent/version-manager';

const TEST_ROOT = join(__dirname, '__tmp__', 'agent-routes');

describe('Agent routes', () => {
  let server: ComicCrawlerServer;
  let agentAdminService: AgentAdminService;
  let adapterRegistry: AdapterRegistry;
  let storage: JsonFileStore;
  let crawlerEngine: CrawlerEngine;

  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });

    const eventBus = new EventBus();
    storage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data') });
    await storage.initialize();
    const configManager = new ConfigManager(storage, eventBus);
    await configManager.load();
    adapterRegistry = new AdapterRegistry(eventBus);
    const taskManager = new TaskManager(async () => {}, { eventBus });
    crawlerEngine = new CrawlerEngine({
      downloadDir: join(TEST_ROOT, 'downloads'),
      concurrency: 1,
      eventBus,
    });

    class MockAdapter implements IComicAdapter {
      readonly id = 'kuronavi';
      readonly name = 'Kuronavi';
      readonly domains = ['kuronavi.one'];
      readonly parseMode = 'static' as const;
      matchUrl(url: string): boolean { return url.includes('kuronavi.one'); }
    }

    adapterRegistry.register(new MockAdapter());
    agentAdminService = new AgentAdminService(join(TEST_ROOT, 'agent-runtime'), storage, eventBus);

    server = new ComicCrawlerServer({
      port: 0,
      host: '127.0.0.1',
      configManager,
      taskManager,
      adapterRegistry,
      crawlerEngine,
      eventBus,
      agentAdminService,
    });
  });

  afterEach(async () => {
    await server.stop().catch(() => undefined);
    await storage.dispose();
  });

  it('should return agent adapter state summary', async () => {
    const versionManager = new VersionManager(join(TEST_ROOT, 'agent-runtime'));
    await versionManager.createCandidateVersion({
      adapterId: 'kuronavi',
      selectorsContent: 'export const KURONAVI_SELECTORS = { title: "h1" };',
      testResults: { passed: 1, failed: 0 },
    });

    const response = await server.getApp().inject({
      method: 'GET',
      url: '/api/agent/adapters',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { data: Array<{ adapterId: string; latestCandidate: string | null }> };
    expect(payload.data[0]?.adapterId).toBe('kuronavi');
    expect(payload.data[0]?.latestCandidate).toBeTruthy();
  });

  it('should promote a candidate version through the API', async () => {
    const versionManager = new VersionManager(join(TEST_ROOT, 'agent-runtime'));
    const version = await versionManager.createCandidateVersion({
      adapterId: 'kuronavi',
      selectorsContent: 'export const KURONAVI_SELECTORS = { title: "h1" };',
      testResults: { passed: 1, failed: 0 },
    });

    const response = await server.getApp().inject({
      method: 'POST',
      url: '/api/agent/adapters/kuronavi/promote',
      payload: { version },
    });

    expect(response.statusCode).toBe(200);
    const activeVersion = await versionManager.getActiveVersion('kuronavi');
    expect(activeVersion?.version).toBe(version);
  });
});
