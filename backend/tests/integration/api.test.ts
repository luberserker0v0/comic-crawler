import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventBus } from '../../src/events/bus';
import { AdapterRegistry } from '../../src/adapter/registry';
import { TaskManager } from '../../src/task/manager';
import type { IComicAdapter } from '../../../shared/types';

describe('Integration: API Endpoints', () => {
  let eventBus: EventBus;
  let taskManager: TaskManager;
  let adapterRegistry: AdapterRegistry;

  beforeEach(() => {
    eventBus = new EventBus();
    adapterRegistry = new AdapterRegistry(eventBus);
    taskManager = new TaskManager(
      async () => {},
      { concurrency: 3, eventBus }
    );
  });

  afterEach(() => {
    // cleanup
  });

  it('should create task and get result', async () => {
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
  });

  it('should get stats', () => {
    const stats = taskManager.getStats();
    expect(stats).toBeDefined();
    expect(stats.total).toBe(0);
  });

  it('should register and list adapters', () => {
    class MockAdapter implements IComicAdapter {
      readonly id = 'mock';
      readonly name = 'Mock';
      readonly domains = ['mock.example.com'];
      readonly parseMode = 'static' as const;
      matchUrl(url: string): boolean { return url.includes('mock.example.com'); }
    }

    adapterRegistry.register(new MockAdapter());
    const adapters = adapterRegistry.list();
    expect(adapters).toHaveLength(1);
    expect(adapters[0].id).toBe('mock');
  });

  it('should find adapter by URL', () => {
    class MockAdapter implements IComicAdapter {
      readonly id = 'mock';
      readonly name = 'Mock';
      readonly domains = ['mock.example.com'];
      readonly parseMode = 'static' as const;
      matchUrl(url: string): boolean { return url.includes('mock.example.com'); }
    }

    adapterRegistry.register(new MockAdapter());
    const found = adapterRegistry.findByUrl('https://mock.example.com/comic/1');
    expect(found).toBeDefined();
    expect(found?.id).toBe('mock');
  });
});
