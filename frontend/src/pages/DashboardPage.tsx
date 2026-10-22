import React, { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAdapterStore, useTaskStore } from '../store';
import { StatsCard } from '../components/StatsCard';
import { TaskList } from '../components/TaskList';
import { NewTaskForm } from '../components/NewTaskForm';
import { useWebSocket } from '../hooks';
import { useI18n } from '../text/i18n';

export const DashboardPage: React.FC = () => {
  const { adapters, fetchTasks, loading, text } = useDashboardData();
  return <div className="mx-auto max-w-7xl space-y-6">
    <h1 className="text-2xl font-bold">{text.dashboard.title}</h1>
    <StatsCard />
    <CreateTaskCard text={text} />
    <AdapterCapabilities adapters={adapters} text={text} />
    <DashboardTasks fetchTasks={fetchTasks} loading={loading} text={text} />
  </div>;
};

type DashboardText = ReturnType<typeof useI18n>['text'];
type DashboardAdapters = ReturnType<typeof useAdapterStore.getState>['adapters'];

function useDashboardData() {
  const { fetchTasks, applyRealtimeEvent, loading } = useTaskStore();
  const { adapters, fetchAdapters } = useAdapterStore();
  const { text } = useI18n();
  useDashboardRealtime(applyRealtimeEvent);
  useEffect(() => { void fetchTasks(); void fetchAdapters(); }, [fetchTasks, fetchAdapters]);
  return { adapters, fetchTasks, loading, text };
}

function useDashboardRealtime(applyRealtimeEvent: ReturnType<typeof useTaskStore.getState>['applyRealtimeEvent']) {
  const wsUrl = typeof window === 'undefined' ? ''
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
  const handleRealtimeMessage = useCallback((message: { event?: string; data?: Record<string, unknown> }) => {
    if (message.event?.startsWith('task:')) applyRealtimeEvent(message);
  }, [applyRealtimeEvent]);
  const { connected, subscribe, unsubscribe } = useWebSocket(wsUrl, handleRealtimeMessage);
  useTaskSubscriptions(connected, subscribe, unsubscribe);
}

const taskEvents = ['task:created', 'task:started', 'task:progress', 'task:paused',
  'task:resumed', 'task:completed', 'task:failed', 'task:cancelled'];

function useTaskSubscriptions(connected: boolean, subscribe: (event: string) => void, unsubscribe: (event: string) => void) {
  useEffect(() => {
    if (!connected) return;
    taskEvents.forEach((event) => subscribe(event));
    return () => taskEvents.forEach((event) => unsubscribe(event));
  }, [connected, subscribe, unsubscribe]);
}

function CreateTaskCard({ text }: { text: DashboardText }) {
  return <div className="rounded-lg bg-white p-6 shadow">
    <h2 className="mb-4 text-lg font-semibold">{text.dashboard.createTask}</h2><NewTaskForm />
  </div>;
}

function AdapterCapabilities({ adapters, text }: { adapters: DashboardAdapters; text: DashboardText }) {
  return <div className="rounded-lg bg-white p-6 shadow">
    <h2 className="mb-4 text-lg font-semibold">{text.dashboard.adapterCapabilities}</h2>
    <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm">
      <AdapterTableHeader text={text} />
      <tbody className="divide-y divide-gray-100">{adapters.map((adapter) => <AdapterRow key={adapter.id} adapter={adapter} />)}</tbody>
    </table>{adapters.length === 0 && <div className="py-4 text-sm text-slate-500">{text.dashboard.noAdapters}</div>}</div>
  </div>;
}

function AdapterTableHeader({ text }: { text: DashboardText }) {
  return <thead className="bg-gray-50"><tr>
    {[text.dashboard.adapter, text.dashboard.verificationCapability, text.dashboard.metadataCapability,
      text.dashboard.chapterImagesCapability].map((label) => <th key={label} className="px-4 py-2 text-left font-medium text-gray-500">{label}</th>)}
  </tr></thead>;
}

function AdapterRow({ adapter }: { adapter: DashboardAdapters[number] }) {
  return <tr><td className="px-4 py-2"><div className="font-medium text-slate-900">{adapter.name}</div>
    <div className="text-xs text-slate-500">{adapter.id}</div></td>
    <CapabilityCell enabled={adapter.capabilities.verification} />
    <CapabilityCell enabled={adapter.capabilities.metadata} />
    <CapabilityCell enabled={adapter.capabilities.chapterImages} />
  </tr>;
}

function CapabilityCell({ enabled }: { enabled: boolean }) {
  return <td className={enabled ? 'px-4 py-2 text-emerald-700' : 'px-4 py-2 text-rose-700'}>{enabled ? 'O' : 'X'}</td>;
}

function DashboardTasks({ fetchTasks, loading, text }: { fetchTasks(): Promise<void>; loading: boolean; text: DashboardText }) {
  return <div className="rounded-lg bg-white p-6 shadow">
    <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{text.dashboard.taskList}</h2>
      <div className="flex items-center gap-4"><button onClick={() => void fetchTasks()} className="text-sm text-blue-600 hover:underline">{text.dashboard.refresh}</button>
        <Link to="/tasks" className="text-sm text-slate-600 hover:underline">{text.dashboard.openManager}</Link></div>
    </div>
    {loading ? <div className="py-8 text-center">{text.stats.loading}</div> : <TaskList showDetailLink />}
  </div>;
}
