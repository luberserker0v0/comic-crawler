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

let server: ComicCrawlerServer;

let agentAdminService: AgentAdminService;

let adapterRegistry: AdapterRegistry;

let storage: JsonFileStore;

let crawlerEngine: CrawlerEngine;

class MockAdapter implements IComicAdapter {
  readonly id = 'kuronavi'; readonly name = 'Kuronavi';
  readonly domains = ['kuronavi.one']; readonly parseMode = 'playwright' as const;
  matchUrl(url: string): boolean { return url.includes('kuronavi.one'); }
}

describe('Agent routes', () => {
  AgentRoutesTestGroup1();
});

function AgentRoutesTestGroup1(): void {
  beforeEach(AgentRoutesTestScenario1);
  afterEach(AgentRoutesTestScenario2);
  it('should return agent adapter state summary', AgentRoutesTestShouldReturnAgentAdapterStateSummary);
  it('should promote a candidate version through the API', AgentRoutesTestShouldPromoteACandidateVersionThroughTheAPI);
}

async function AgentRoutesTestScenario1() {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });
    const eventBus = new EventBus();
    storage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data') });
    await storage.initialize();
    const configManager = await createConfigManager(eventBus);
    adapterRegistry = new AdapterRegistry(eventBus);
    const taskManager = new TaskManager(async () => { }, { eventBus });
    crawlerEngine = new CrawlerEngine({
        downloadDir: join(TEST_ROOT, 'downloads'),
        concurrency: 1,
        eventBus,
    });
    adapterRegistry.register(new MockAdapter());
    agentAdminService = new AgentAdminService(join(TEST_ROOT, 'agent-runtime'), storage, eventBus);
    server = createAgentServer(configManager, taskManager, eventBus);
}

async function createConfigManager(eventBus: EventBus): Promise<ConfigManager> {
  const configManager = new ConfigManager(storage, eventBus);
  await configManager.load();
  return configManager;
}

function createAgentServer(configManager: ConfigManager, taskManager: TaskManager, eventBus: EventBus) {
  return new ComicCrawlerServer({
        port: 0,
        host: '127.0.0.1',
        configManager,
        taskManager,
        adapterRegistry,
        crawlerEngine,
        eventBus,
        agentAdminService,
  });
}

async function AgentRoutesTestScenario2() {
    await server.stop().catch(() => undefined);
    await storage.dispose();
}

async function AgentRoutesTestShouldReturnAgentAdapterStateSummary() {
    const versionManager = new VersionManager(join(TEST_ROOT, 'agent-runtime'));
    await createCandidateVersion(versionManager);
    const response = await server.getApp().inject({
        method: 'GET',
        url: '/api/agent/adapters',
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
        data: Array<{
            adapterId: string;
            latestCandidate: string | null;
        }>;
    };
    expect(payload.data[0]?.adapterId).toBe('kuronavi');
    expect(payload.data[0]?.latestCandidate).toBeTruthy();
}

function createCandidateVersion(versionManager: VersionManager): Promise<string> {
  return versionManager.createCandidateVersion({
    adapterId: 'kuronavi', selectorsContent: 'export const KURONAVI_SELECTORS = { title: "h1" };',
    testResults: { passed: 1, failed: 0 },
  });
}

async function AgentRoutesTestShouldPromoteACandidateVersionThroughTheAPI() {
    const versionManager = new VersionManager(join(TEST_ROOT, 'agent-runtime'));
    const version = await createCandidateVersion(versionManager);
    const response = await server.getApp().inject({
        method: 'POST',
        url: '/api/agent/adapters/kuronavi/promote',
        payload: { version },
    });
    expect(response.statusCode).toBe(200);
    const activeVersion = await versionManager.getActiveVersion('kuronavi');
    expect(activeVersion?.version).toBe(version);
}
