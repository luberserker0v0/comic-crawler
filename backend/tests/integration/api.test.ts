import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventBus } from '../../src/events/bus';
import { AdapterRegistry } from '../../src/adapter/registry';
import { TaskManager } from '../../src/task/manager';
import type { IComicAdapter } from '../../../shared/types';

let eventBus: EventBus;

let taskManager: TaskManager;

let adapterRegistry: AdapterRegistry;

describe('Integration: API Endpoints', () => {
  IntegrationAPIEndpointsTestGroup1();
});

function IntegrationAPIEndpointsTestGroup1(): void {
  beforeEach(IntegrationAPIEndpointsTestScenario1);
  afterEach(IntegrationAPIEndpointsTestScenario2);
  it('should create task and get result', IntegrationAPIEndpointsTestShouldCreateTaskAndGetResult);
  it('should get stats', IntegrationAPIEndpointsTestShouldGetStats);
  it('should register and list adapters', IntegrationAPIEndpointsTestShouldRegisterAndListAdapters);
  it('should find adapter by URL', IntegrationAPIEndpointsTestShouldFindAdapterByURL);
}

function IntegrationAPIEndpointsTestScenario1() {
    eventBus = new EventBus();
    adapterRegistry = new AdapterRegistry(eventBus);
    taskManager = new TaskManager(async () => { }, { concurrency: 3, eventBus });
}

function IntegrationAPIEndpointsTestScenario2() {
    // cleanup
}

async function IntegrationAPIEndpointsTestShouldCreateTaskAndGetResult() {
    const taskId = await taskManager.createTask({
        id: 'test-task-1',
        url: 'https://example.com/comic/1',
        adapterId: 'test',
        priority: 0,
    });
    expect(taskId).toBe('test-task-1');
    const result = taskManager.getTaskResult('test-task-1');
    expect(result).toBeDefined();
    expect(result?.taskId).toBe('test-task-1');
}

function IntegrationAPIEndpointsTestShouldGetStats() {
    const stats = taskManager.getStats();
    expect(stats).toBeDefined();
    expect(stats.total).toBe(0);
}

function IntegrationAPIEndpointsTestShouldRegisterAndListAdapters() {
    class MockAdapter implements IComicAdapter {
        readonly id = 'mock';
        readonly name = 'Mock';
        readonly domains = ['mock.example.com'];
        readonly parseMode = 'playwright' as const;
        matchUrl(url: string): boolean { return url.includes('mock.example.com'); }
    }
    adapterRegistry.register(new MockAdapter());
    const adapters = adapterRegistry.list();
    expect(adapters).toHaveLength(1);
    expect(adapters[0].id).toBe('mock');
}

function IntegrationAPIEndpointsTestShouldFindAdapterByURL() {
    class MockAdapter implements IComicAdapter {
        readonly id = 'mock';
        readonly name = 'Mock';
        readonly domains = ['mock.example.com'];
        readonly parseMode = 'playwright' as const;
        matchUrl(url: string): boolean { return url.includes('mock.example.com'); }
    }
    adapterRegistry.register(new MockAdapter());
    const found = adapterRegistry.findByUrl('https://mock.example.com/comic/1');
    expect(found).toBeDefined();
    expect(found?.id).toBe('mock');
}
