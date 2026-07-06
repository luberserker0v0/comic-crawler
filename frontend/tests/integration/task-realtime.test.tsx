import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DashboardPage } from '../../src/pages/DashboardPage';
import { TaskManagerPage } from '../../src/pages/TaskManagerPage';
import { api } from '../../src/api/client';
import { useTaskStore } from '../../src/store';

let realtimeCallback: ((message: { event?: string; data?: Record<string, unknown> }) => void) | undefined;

jest.mock('../../src/hooks', () => {
  const actual = jest.requireActual('../../src/hooks') as object;

  return {
    ...actual,
    useWebSocket: (_url: string, onMessage?: (message: { event?: string; data?: Record<string, unknown> }) => void) => {
      realtimeCallback = onMessage;
      return {
        connected: true,
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
      };
    },
  };
});

describe('Task realtime updates', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    realtimeCallback = undefined;
    useTaskStore.setState({
      tasks: [],
      stats: { total: 0, pending: 0, running: 0, interrupted: 0, completed: 0, failed: 0, cancelled: 0 },
      loading: false,
      error: null,
    });
  });

  it('should update dashboard progress without a manual refresh', async () => {
    jest.spyOn(api, 'getTasks').mockResolvedValue({
      data: {
        tasks: [
          {
            id: 'task-1',
            url: 'https://example.com/comic/1',
            status: 'running',
            priority: 0,
            createdAt: new Date().toISOString(),
            progress: {
              totalItems: 5,
              completedItems: 0,
              failedItems: 0,
              percentage: 0,
              currentItems: 'Chapter 1',
            },
          },
        ],
        stats: { total: 1, pending: 0, running: 1, interrupted: 0, completed: 0, failed: 0, cancelled: 0 },
      },
    } as any);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>
    );

    await screen.findByText('task-1');

    await act(async () => {
      realtimeCallback?.({
        event: 'task:progress',
        data: {
          taskId: 'task-1',
          progress: {
            totalImages: 5,
            completedImages: 2,
            failedImages: 0,
            currentChapter: 'Chapter 1',
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText((_, element) => element?.textContent === '進度: 40% · Chapter 1').length).toBeGreaterThan(0);
    });
  });

  it('should patch selected task detail on progress events and refetch once on completion', async () => {
    jest.spyOn(api, 'getTasks').mockResolvedValue({
      data: {
        tasks: [
          {
            id: 'task-1',
            url: 'https://example.com/comic/1',
            status: 'running',
            priority: 0,
            createdAt: new Date().toISOString(),
            progress: {
              totalItems: 5,
              completedItems: 0,
              failedItems: 0,
              percentage: 0,
              currentItems: 'Chapter 1',
            },
          },
        ],
        stats: { total: 1, pending: 0, running: 1, interrupted: 0, completed: 0, failed: 0, cancelled: 0 },
      },
    } as any);

    const getTaskSpy = jest.spyOn(api, 'getTask').mockResolvedValue({
      data: {
        task: {
          id: 'task-1',
          url: 'https://example.com/comic/1',
          status: 'running',
          priority: 0,
          createdAt: new Date().toISOString(),
        },
        progress: {
          totalItems: 5,
          completedItems: 0,
          failedItems: 0,
          percentage: 0,
          currentItems: 'Chapter 1',
        },
        result: {
          taskId: 'task-1',
          status: 'running',
          downloadedImages: 0,
          failedImages: 0,
          totalImages: 5,
          outputPath: 'D:/downloads',
          metadata: { title: 'Demo Comic' },
        },
        preview: null,
      },
    } as any);

    render(
      <MemoryRouter
        initialEntries={['/tasks/task-1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/tasks/:taskId" element={<TaskManagerPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('task-1');
    const getTaskCallsBefore = getTaskSpy.mock.calls.length;

    await act(async () => {
      realtimeCallback?.({
        event: 'task:progress',
        data: {
          taskId: 'task-1',
          progress: {
            totalImages: 5,
            completedImages: 2,
            failedImages: 0,
            currentChapter: 'Chapter 1',
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText((_, element) => element?.textContent === '2 / 5')).toBeInTheDocument();
    });
    expect(getTaskSpy.mock.calls.length).toBe(getTaskCallsBefore);

    getTaskSpy.mockResolvedValueOnce({
      data: {
        task: {
          id: 'task-1',
          url: 'https://example.com/comic/1',
          status: 'completed',
          priority: 0,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
        progress: {
          totalItems: 5,
          completedItems: 5,
          failedItems: 0,
          percentage: 100,
          currentItems: 'Chapter 1',
        },
        result: {
          taskId: 'task-1',
          status: 'completed',
          downloadedImages: 5,
          failedImages: 0,
          totalImages: 5,
          outputPath: 'D:/downloads',
          metadata: { title: 'Demo Comic' },
        },
        preview: null,
      },
    } as any);

    await act(async () => {
      realtimeCallback?.({
        event: 'task:completed',
        data: {
          taskId: 'task-1',
          result: {
            totalImages: 5,
            downloadedImages: 5,
            failedImages: 0,
          },
        },
      });
    });

    await waitFor(() => {
      expect(getTaskSpy.mock.calls.length).toBe(getTaskCallsBefore + 1);
    });
  });
});
