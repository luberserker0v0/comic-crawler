import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { ConfigManager } from '../../../src/config/manager';
import { CrawlerEngine } from '../../../src/crawler/engine';
import { EventBus } from '../../../src/events/bus';
import { ComicCrawlerServer } from '../../../src/server/app';
import { JsonFileStore } from '../../../src/storage/json-store';
import { TaskManager } from '../../../src/task/manager';

const TEST_ROOT = join(__dirname, '__tmp__', 'api-docs-route');

let server: ComicCrawlerServer;

describe('API docs route', () => {
  APIDocsRouteTestGroup1();
});

function APIDocsRouteTestGroup1(): void {
  beforeEach(APIDocsRouteTestScenario1);
  afterEach(APIDocsRouteTestScenario2);
  it('serves Swagger UI at /api-docs', APIDocsRouteTestServesSwaggerUIAtApiDocs);
  it('keeps the OpenAPI specification available to Swagger UI', APIDocsRouteTestKeepsTheOpenAPISpecificationAvailableToSwaggerUI);
}

async function APIDocsRouteTestScenario1() {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });
    const eventBus = new EventBus();
    const storage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
    await storage.initialize();
    const configManager = new ConfigManager(storage, eventBus);
    await configManager.load();
    const taskManager = new TaskManager(async () => { }, { eventBus, storage });
    await taskManager.initialize();
    server = createServer(configManager, taskManager, eventBus);
}

function createServer(configManager: ConfigManager, taskManager: TaskManager, eventBus: EventBus) {
  return new ComicCrawlerServer({
        port: 0,
        host: '127.0.0.1',
        configManager,
        taskManager,
        adapterRegistry: new AdapterRegistry(eventBus),
        crawlerEngine: new CrawlerEngine({
            downloadDir: join(TEST_ROOT, 'downloads'),
            concurrency: 1,
            eventBus,
        }),
        eventBus,
  });
}

async function APIDocsRouteTestScenario2() {
    await server.stop();
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
}

async function APIDocsRouteTestServesSwaggerUIAtApiDocs() {
    const response = await server.getApp().inject({ method: 'GET', url: '/api-docs' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('swagger-ui');
    expect(response.body).toContain('swagger-ui-bundle.js');
}

async function APIDocsRouteTestKeepsTheOpenAPISpecificationAvailableToSwaggerUI() {
    const response = await server.getApp().inject({ method: 'GET', url: '/api-docs/yaml' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-yaml');
    expect(response.body).toContain('openapi: 3.1.0');
    expect(response.body).toContain('title: ComicCrawler REST API');
}
