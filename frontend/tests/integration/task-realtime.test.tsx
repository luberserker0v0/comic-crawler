import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../../src/api/client';
import { DashboardPage } from '../../src/pages/DashboardPage';
import { TaskManagerPage } from '../../src/pages/TaskManagerPage';
import { useAdapterStore, useTaskStore } from '../../src/store';

type RealtimeMessage = { event?: string; data?: Record<string, unknown> };
let realtimeCallback: ((message: RealtimeMessage) => void) | undefined;

jest.mock('../../src/hooks', () => {
  const actual = jest.requireActual('../../src/hooks') as object;
  return {
    ...actual,
    useWebSocket: (_url: string, onMessage?: (message: RealtimeMessage) => void) => {
      realtimeCallback = onMessage;
      return { connected: true, subscribe: jest.fn(), unsubscribe: jest.fn() };
    },
  };
});

describe('Task realtime updates', registerRealtimeTests);

function registerRealtimeTests() {
  beforeEach(setupRealtimeTest);
  it('should update dashboard progress without a manual refresh', testDashboardProgress);
  it('should patch selected task detail on progress events and refetch once on completion', testTaskDetailProgress);
}

function setupRealtimeTest() {
  jest.restoreAllMocks();
  realtimeCallback = undefined;
  jest.spyOn(api, 'getAdapters').mockResolvedValue({ data: [] } as any);
  jest.spyOn(api, 'getBrowserWorkers').mockResolvedValue({ data: { workers: [], resources: [] } } as any);
  jest.spyOn(api, 'getTaskPriorityOrder').mockResolvedValue({ data: { taskIds: [] } } as any);
  useTaskStore.setState({ tasks: [], stats: emptyStats(), loading: false, error: null });
  useAdapterStore.setState({ adapters: [], loading: false, error: null });
}

function emptyStats() {
  return {
    total: 0, pending: 0, running: 0, waitingForBrowserWorker: 0, waitingVerification: 0,
    interrupted: 0, completed: 0, failed: 0, cancelled: 0,
  };
}

function runningTask() {
  return {
    id: 'task-1', url: 'https://example.com/comic/1', status: 'running', priority: 0,
    createdAt: new Date().toISOString(),
    progress: { totalItems: 5, completedItems: 0, failedItems: 0, percentage: 0, currentItems: 'Chapter 1' },
  };
}

function tasksResponse() {
  return { data: {
    tasks: [runningTask()],
    stats: { total: 1, pending: 0, running: 1, interrupted: 0, completed: 0, failed: 0, cancelled: 0 },
  } } as any;
}

function taskDetailResponse(status: 'running' | 'completed') {
  const completed = status === 'completed';
  return { data: {
    task: { ...runningTask(), progress: undefined, status, ...(completed ? { completedAt: new Date().toISOString() } : {}) },
    progress: { totalItems: 5, completedItems: completed ? 5 : 0, failedItems: 0,
      percentage: completed ? 100 : 0, currentItems: 'Chapter 1' },
    result: { taskId: 'task-1', status, downloadedImages: completed ? 5 : 0, failedImages: 0,
      totalImages: 5, outputPath: 'D:/downloads', metadata: { title: 'Demo Comic' } },
    preview: null,
  } } as any;
}

function renderDashboard() {
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
}

function renderTaskManager() {
  render(<MemoryRouter initialEntries={['/tasks/task-1']}><Routes>
    <Route path="/tasks/:taskId" element={<TaskManagerPage />} />
  </Routes></MemoryRouter>);
}

async function emitProgress() {
  await act(async () => realtimeCallback?.({ event: 'task:progress', data: {
    taskId: 'task-1', progress: { totalImages: 5, completedImages: 2, failedImages: 0, currentChapter: 'Chapter 1' },
  } }));
}

async function emitCompletion() {
  await act(async () => realtimeCallback?.({ event: 'task:completed', data: {
    taskId: 'task-1', result: { totalImages: 5, downloadedImages: 5, failedImages: 0 },
  } }));
}

async function testDashboardProgress() {
  jest.spyOn(api, 'getTasks').mockResolvedValue(tasksResponse());
  renderDashboard();
  await screen.findByText('task-1');
  await emitProgress();
  await waitFor(() => {
    expect(screen.getAllByText((_, element) => element?.textContent === '進度: 40% · Chapter 1').length).toBeGreaterThan(0);
  });
}

async function testTaskDetailProgress() {
  jest.spyOn(api, 'getTasks').mockResolvedValue(tasksResponse());
  const getTaskSpy = jest.spyOn(api, 'getTask').mockResolvedValue(taskDetailResponse('running'));
  renderTaskManager();
  await screen.findByText('task-1');
  const callsBefore = getTaskSpy.mock.calls.length;
  await assertProgressDoesNotRefetch(getTaskSpy, callsBefore);
  getTaskSpy.mockResolvedValueOnce(taskDetailResponse('completed'));
  await emitCompletion();
  await waitFor(() => expect(getTaskSpy.mock.calls.length).toBe(callsBefore + 1));
}

async function assertProgressDoesNotRefetch(spy: ReturnType<typeof jest.spyOn>, callsBefore: number) {
  await emitProgress();
  await waitFor(() => {
    expect(screen.getByText((_, element) => element?.textContent === '2 / 5')).toBeInTheDocument();
  });
  expect(spy.mock.calls.length).toBe(callsBefore);
}
