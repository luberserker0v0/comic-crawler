import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { api } from '../../../src/api/client';
import { useTaskStore } from '../../../src/store';

const requests = { delete: jest.fn(), get: jest.fn() };
let originalClient: unknown;

describe('task store commands', () => {
  beforeEach(setupTaskStore);
  afterEach(restoreApiClient);

  it('keeps the API client receiver when deleting a task', async () => {
    await useTaskStore.getState().deleteTask('task-1');

    expect(requests.delete).toHaveBeenCalledWith('/api/tasks/task-1');
    expect(requests.get).toHaveBeenCalledWith('/api/tasks');
    expect(useTaskStore.getState().tasks).toEqual([]);
    expect(useTaskStore.getState().error).toBeNull();
  });
});

function setupTaskStore() {
  originalClient = Reflect.get(api, 'client');
  requests.delete.mockReset().mockResolvedValue({ data: { data: { message: 'deleted' } } });
  requests.get.mockReset().mockResolvedValue({ data: { data: { tasks: [], stats: emptyStats() } } });
  Reflect.set(api, 'client', requests);
  useTaskStore.setState({ tasks: [task()], stats: emptyStats(), loading: false, error: null });
}

function restoreApiClient() {
  Reflect.set(api, 'client', originalClient);
}

function task() {
  return { id: 'task-1', url: 'https://example.com/chapter/1', status: 'completed',
    priority: 0, createdAt: '2026-10-22T00:00:00.000Z' };
}

function emptyStats() {
  return { total: 0, pending: 0, running: 0, waitingForBrowserWorker: 0,
    waitingVerification: 0, interrupted: 0, completed: 0, failed: 0, cancelled: 0 };
}
