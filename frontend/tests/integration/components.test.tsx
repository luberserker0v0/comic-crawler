import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ProgressBar } from '../../src/components/ProgressBar';
import { TaskList } from '../../src/components/TaskList';
import { StatsCard } from '../../src/components/StatsCard';
import { NewTaskForm } from '../../src/components/NewTaskForm';
import { useTaskStore, useConfigStore, useAdapterStore } from '../../src/store';
import { uiText } from '../../src/text/zhTW';

describe('Integration: Component Interaction', () => {
  beforeEach(() => {
    useTaskStore.setState({
      tasks: [],
      stats: { total: 0, pending: 0, running: 0, interrupted: 0, completed: 0, failed: 0, cancelled: 0 },
      loading: false,
      error: null,
    });
    useConfigStore.setState({
      config: null,
      loading: false,
      error: null,
    });
    useAdapterStore.setState({
      adapters: [],
      loading: false,
      error: null,
    });
  });

  it('should render ProgressBar with correct state', () => {
    render(<ProgressBar current={3} total={10} label="Download" />);

    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
  });

  it('should render empty TaskList', () => {
    render(<TaskList tasks={[]} />);

    expect(screen.getByText(uiText.taskList.empty)).toBeInTheDocument();
  });

  it('should render TaskList with tasks', () => {
    const tasks = [
      {
        id: 'task-1',
        url: 'https://example.com/comic/1',
        status: 'pending' as const,
        priority: 0,
        createdAt: new Date().toISOString(),
      },
    ];

    render(<TaskList tasks={tasks as any} />);

    expect(screen.getByText('task-1')).toBeInTheDocument();
    expect(screen.getByText(uiText.taskList.statusLabels.pending)).toBeInTheDocument();
  });

  it('should render interrupted task label', () => {
    const tasks = [
      {
        id: 'task-2',
        url: 'https://example.com/comic/2',
        status: 'interrupted' as const,
        priority: 0,
        createdAt: new Date().toISOString(),
      },
    ];

    render(<TaskList tasks={tasks as any} />);

    expect(screen.getByText(uiText.taskList.statusLabels.interrupted)).toBeInTheDocument();
    expect(screen.getByText(uiText.taskList.resume)).toBeInTheDocument();
  });

  it('should render StatsCard with zero stats', () => {
    useTaskStore.setState({
      stats: { total: 0, pending: 0, running: 0, interrupted: 0, completed: 0, failed: 0, cancelled: 0 },
      tasks: [],
      loading: false,
      error: null,
    });

    render(<StatsCard />);

    expect(screen.getByText(uiText.stats.total)).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('should render NewTaskForm', () => {
    render(<NewTaskForm />);

    expect(screen.getByLabelText(uiText.taskForm.urlLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(uiText.taskForm.chaptersLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(uiText.taskForm.priorityLabel)).toBeInTheDocument();
    expect(screen.getByText(uiText.taskForm.submit)).toBeInTheDocument();
  });

  it('should update progress bar dynamically', () => {
    const { rerender } = render(<ProgressBar current={0} total={10} label="Test" />);

    expect(screen.getByText('0%')).toBeInTheDocument();

    rerender(<ProgressBar current={5} total={10} label="Test" />);
    expect(screen.getByText('50%')).toBeInTheDocument();

    rerender(<ProgressBar current={10} total={10} label="Test" />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
