import React, { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAdapterStore, useTaskStore } from '../store';
import { StatsCard } from '../components/StatsCard';
import { TaskList } from '../components/TaskList';
import { NewTaskForm } from '../components/NewTaskForm';
import { useWebSocket } from '../hooks';
import { useI18n } from '../text/i18n';

export const DashboardPage: React.FC = () => {
  const { fetchTasks, applyRealtimeEvent, loading } = useTaskStore();
  const { adapters, fetchAdapters } = useAdapterStore();
  const { text } = useI18n();
  const wsUrl = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    : '';

  const handleRealtimeMessage = useCallback((message: { event?: string; data?: Record<string, unknown> }) => {
    if (!message.event?.startsWith('task:')) {
      return;
    }

    applyRealtimeEvent(message);
  }, [applyRealtimeEvent]);

  const { connected, subscribe, unsubscribe } = useWebSocket(wsUrl, handleRealtimeMessage);

  useEffect(() => {
    void fetchTasks();
    void fetchAdapters();
  }, [fetchTasks, fetchAdapters]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    const events = [
      'task:created',
      'task:started',
      'task:progress',
      'task:paused',
      'task:resumed',
      'task:completed',
      'task:failed',
      'task:cancelled',
    ];

    events.forEach((event) => subscribe(event));

    return () => {
      events.forEach((event) => unsubscribe(event));
    };
  }, [connected, subscribe, unsubscribe]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h1 className="text-2xl font-bold">{text.dashboard.title}</h1>

      <StatsCard />

      <div className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-4 text-lg font-semibold">{text.dashboard.createTask}</h2>
        <NewTaskForm />
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-4 text-lg font-semibold">{text.dashboard.adapterCapabilities}</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Adapter</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">{text.dashboard.verificationCapability}</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">{text.dashboard.metadataCapability}</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">{text.dashboard.chapterImagesCapability}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {adapters.map((adapter) => (
                <tr key={adapter.id}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-900">{adapter.name}</div>
                    <div className="text-xs text-slate-500">{adapter.id}</div>
                  </td>
                  <td className={adapter.capabilities.verification ? 'px-4 py-2 text-emerald-700' : 'px-4 py-2 text-rose-700'}>
                    {adapter.capabilities.verification ? 'O' : 'X'}
                  </td>
                  <td className={adapter.capabilities.metadata ? 'px-4 py-2 text-emerald-700' : 'px-4 py-2 text-rose-700'}>
                    {adapter.capabilities.metadata ? 'O' : 'X'}
                  </td>
                  <td className={adapter.capabilities.chapterImages ? 'px-4 py-2 text-emerald-700' : 'px-4 py-2 text-rose-700'}>
                    {adapter.capabilities.chapterImages ? 'O' : 'X'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {adapters.length === 0 && (
            <div className="py-4 text-sm text-slate-500">{text.dashboard.noAdapters}</div>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{text.dashboard.taskList}</h2>
          <div className="flex items-center gap-4">
            <button
              onClick={() => fetchTasks()}
              className="text-sm text-blue-600 hover:underline"
            >
              {text.dashboard.refresh}
            </button>
            <Link to="/tasks" className="text-sm text-slate-600 hover:underline">
              {text.dashboard.openManager}
            </Link>
          </div>
        </div>
        {loading ? (
          <div className="py-8 text-center">{text.stats.loading}</div>
        ) : (
          <TaskList showDetailLink />
        )}
      </div>
    </div>
  );
};
