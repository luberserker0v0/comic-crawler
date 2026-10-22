import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '../store';
import { useWebSocket, useLocalStorage } from '../hooks';
import { useI18n } from '../text/i18n';
import { api, getApiErrorMessage } from '../api/client';
import { useBuildJobs } from './agent/useBuildJobs';
import { useDeletedAdapters } from './agent/useDeletedAdapters';
import { useReviewJob } from './agent/useReviewJob';
import { useSiteAdapters } from './agent/useSiteAdapters';
import { type PendingAction } from './agent/widgets';
import { BuildJobsSection } from './agent/sections/BuildJobsSection';
import { DeletedAdaptersSection } from './agent/sections/DeletedAdaptersSection';
import { PendingActionBanner } from './agent/sections/PendingActionBanner';
import { ReviewPanel } from './agent/sections/ReviewPanel';
import { SectionTabs } from './agent/sections/SectionTabs';
import { SiteAdaptersSection } from './agent/sections/SiteAdaptersSection';

export const AgentPage: React.FC = () => <AgentPageView model={useAgentPageModel()} />;

function useAgentPageModel() {
  const store = useAgentStore();
  const local = useAgentLocalState();
  const site = useSiteAdapters();
  const deleted = useDeletedAdapters({ fetchSiteAdapters: site.fetchSiteAdapters, fetchAdapters: store.fetchAdapters });
  const builds = useBuildJobs();
  const review = useReviewJob({ fetchBuildJobs: builds.fetchBuildJobs,
    fetchSiteAdapters: site.fetchSiteAdapters, fetchAdapters: store.fetchAdapters });
  const connected = useAgentRealtime(store.applyRealtimeEvent);
  useAgentSelection(store, local);
  const selectedVersion = useSelectedVersion(store.selectedAdapter, local);
  const actionContext = { store, local, site, deleted };
  return { store, local, site, deleted, builds, review, connected, selectedVersion,
    runPendingAction: () => runPendingAction(actionContext), text: useI18n().text };
}

function useAgentLocalState() {
  const [selectedVersionId, setSelectedVersionId] = useLocalStorage<string | null>('agent:selected-version', null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [persistedAdapterId, setPersistedAdapterId] = useLocalStorage<string | null>('agent:selected-adapter', null);
  const [activeSection, setActiveSection] = useLocalStorage<'site-adapters' | 'build-jobs' | 'deleted-adapters'>('agent:active-section', 'site-adapters');
  const [deleteAdapterLoading, setDeleteAdapterLoading] = useState(false);
  const [deleteAdapterConfirmation, setDeleteAdapterConfirmation] = useState('');
  const [deleteAdapterResult, setDeleteAdapterResult] = useState<string | null>(null);
  return { selectedVersionId, setSelectedVersionId, pendingAction, setPendingAction, persistedAdapterId,
    setPersistedAdapterId, activeSection, setActiveSection, deleteAdapterLoading, setDeleteAdapterLoading,
    deleteAdapterConfirmation, setDeleteAdapterConfirmation, deleteAdapterResult, setDeleteAdapterResult };
}

type AgentStore = ReturnType<typeof useAgentStore.getState>;
type AgentLocal = ReturnType<typeof useAgentLocalState>;

function useAgentRealtime(applyRealtimeEvent: AgentStore['applyRealtimeEvent']) {
  const wsUrl = typeof window === 'undefined' ? ''
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
  const onMessage = useCallback((message: { event?: string; data?: Record<string, unknown> }) => {
    if (message.event?.startsWith('adapter:repair:')) void applyRealtimeEvent(message);
  }, [applyRealtimeEvent]);
  const socket = useWebSocket(wsUrl, onMessage);
  useAgentSubscriptions(socket.connected, socket.subscribe, socket.unsubscribe);
  return socket.connected;
}

const agentEvents = ['adapter:repair:started', 'adapter:repair:validated',
  'adapter:repair:candidate-created', 'adapter:repair:promotion-requested',
  'adapter:repair:promoted', 'adapter:repair:failed', 'adapter:repair:rolled-back'];

function useAgentSubscriptions(connected: boolean, subscribe: (event: string) => void, unsubscribe: (event: string) => void) {
  useEffect(() => {
    if (!connected) return;
    agentEvents.forEach((event) => subscribe(event));
    return () => agentEvents.forEach((event) => unsubscribe(event));
  }, [connected, subscribe, unsubscribe]);
}

function useAgentSelection(store: AgentStore, local: AgentLocal) {
  const { fetchAdapters } = store;
  useEffect(() => { void fetchAdapters(); }, [fetchAdapters]);
  useDefaultAdapter(store, local);
  usePersistedAdapter(store.selectedAdapterId, local.setPersistedAdapterId);
}

function useDefaultAdapter(store: AgentStore, local: AgentLocal) {
  const { adapters, selectedAdapterId, selectAdapter } = store;
  useEffect(() => {
    if (selectedAdapterId || adapters.length === 0) return;
    const preferred = local.persistedAdapterId
      && adapters.some((adapter) => adapter.adapterId === local.persistedAdapterId)
      ? local.persistedAdapterId : adapters[0]!.adapterId;
    void selectAdapter(preferred);
  }, [adapters, selectedAdapterId, local.persistedAdapterId, selectAdapter]);
}

function usePersistedAdapter(selectedAdapterId: string | null, setPersistedAdapterId: (id: string | null) => void) {
  useEffect(() => {
    if (selectedAdapterId) setPersistedAdapterId(selectedAdapterId);
  }, [selectedAdapterId, setPersistedAdapterId]);
}

function useSelectedVersion(selectedAdapter: AgentStore['selectedAdapter'], local: AgentLocal) {
  useVersionSelection(selectedAdapter, local.selectedVersionId, local.setSelectedVersionId);
  return useMemo(() => selectedAdapter?.versions?.versions.find(
    (version) => version.version === local.selectedVersionId) ?? null,
  [selectedAdapter, local.selectedVersionId]);
}

function useVersionSelection(selectedAdapter: AgentStore['selectedAdapter'], selectedId: string | null, setSelectedId: (id: string | null) => void) {
  useEffect(() => {
    const versions = selectedAdapter?.versions?.versions ?? [];
    if (versions.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const stillExists = selectedId ? versions.some((version) => version.version === selectedId) : false;
    const nextId = stillExists ? selectedId : versions[0]!.version;
    if (selectedId !== nextId) setSelectedId(nextId);
  }, [selectedAdapter, selectedId, setSelectedId]);
}

type PendingContext = { store: AgentStore; local: AgentLocal;
  site: ReturnType<typeof useSiteAdapters>; deleted: ReturnType<typeof useDeletedAdapters> };

async function runPendingAction(context: PendingContext) {
  const action = context.local.pendingAction;
  if (!action) return;
  if (action.type === 'promote') await context.store.promoteCandidate(action.adapterId, action.version);
  else if (action.type === 'reject') await context.store.rejectCandidate(action.adapterId, action.version);
  else if (action.type === 'deleteAdapter') {
    const completed = await deleteAdapter(context, action);
    if (!completed) return;
  } else await context.store.rollbackAdapter(action.adapterId, action.version);
  context.local.setPendingAction(null);
  context.local.setDeleteAdapterConfirmation('');
}

async function deleteAdapter(context: PendingContext, action: Extract<PendingAction, { type: 'deleteAdapter' }>) {
  context.local.setDeleteAdapterLoading(true);
  try {
    const response = await api.deleteAdapter(action.adapterId);
    await Promise.all([context.site.fetchSiteAdapters(), context.store.fetchAdapters(),
      context.deleted.fetchDeletedAdapters()]);
    context.local.setDeleteAdapterResult(formatDeleteResult(response.data));
    clearDeletedSelections(context, action.adapterId);
    return true;
  } catch (error) {
    context.site.setSiteAdaptersError(getApiErrorMessage(error));
    return false;
  } finally {
    context.local.setDeleteAdapterLoading(false);
  }
}

function formatDeleteResult(data: Awaited<ReturnType<typeof api.deleteAdapter>>['data']) {
  return [data.message, `Registry removed: ${data.registryRemoved ? 'yes' : 'no'}`,
    `Source deleted: ${data.sourceDeleted ? 'yes' : 'no'}`,
    `Deleted marker: ${data.deletedMarkerWritten ? 'written' : 'missing'}`].join(' · ');
}

function clearDeletedSelections(context: PendingContext, adapterId: string) {
  if (context.site.selectedSiteAdapterId === adapterId) context.site.setSelectedSiteAdapterId(null);
  if (context.store.selectedAdapterId === adapterId) context.local.setPersistedAdapterId(null);
}

type AgentModel = ReturnType<typeof useAgentPageModel>;

function AgentPageView({ model }: { model: AgentModel }) {
  return <div className="mx-auto max-w-7xl space-y-6">
    <AgentHeader model={model} />
    <AgentMessages model={model} />
    <PendingAction model={model} />
    <SectionTabs activeSection={model.local.activeSection} setActiveSection={model.local.setActiveSection} />
    <ActiveAgentSection model={model} />
    {model.review.reviewJob && <ReviewPanel {...model.review} reviewJob={model.review.reviewJob} />}
  </div>;
}

function AgentHeader({ model }: { model: AgentModel }) {
  return <div className="flex flex-col gap-3 rounded-2xl bg-white p-6 shadow sm:flex-row sm:items-end sm:justify-between">
    <div><p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">{model.text.agent.eyebrow}</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-900">{model.text.agent.title}</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">{model.text.agent.description}</p></div>
    <button onClick={() => void refreshAgent(model)}
      className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">{model.text.agent.refresh}</button>
    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
      {model.text.agent.realtime}: {model.connected ? model.text.agent.connected : model.text.agent.disconnected}</div>
  </div>;
}

async function refreshAgent(model: AgentModel) {
  await Promise.all([model.store.fetchAdapters(), model.site.fetchSiteAdapters(),
    model.builds.fetchBuildJobs(), model.deleted.fetchDeletedAdapters()]);
  if (model.store.selectedAdapterId) await model.store.selectAdapter(model.store.selectedAdapterId);
}

function AgentMessages({ model }: { model: AgentModel }) {
  return <>
    {model.store.error && <DismissibleMessage tone="rose" message={model.store.error}
      onDismiss={model.store.clearError} label={model.text.settings.dismissError} />}
    {model.local.deleteAdapterResult && <DismissibleMessage tone="emerald" message={model.local.deleteAdapterResult}
      onDismiss={() => model.local.setDeleteAdapterResult(null)} label={model.text.settings.dismissError} />}
  </>;
}

function DismissibleMessage(props: { tone: 'rose' | 'emerald'; message: string; onDismiss(): void; label: string }) {
  const classes = props.tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return <div className={`rounded-xl border p-4 text-sm ${classes}`}><div>{props.message}</div>
    <button onClick={props.onDismiss} className="mt-2 font-medium underline">{props.label}</button></div>;
}

function PendingAction({ model }: { model: AgentModel }) {
  const action = model.local.pendingAction;
  if (!action) return null;
  const requires = action.type === 'deleteAdapter' && Boolean(action.sourceWillBeDeleted);
  const matches = !requires || model.local.deleteAdapterConfirmation.trim() === action.adapterId;
  return <PendingActionBanner pendingAction={action} deleteAdapterConfirmation={model.local.deleteAdapterConfirmation}
    setDeleteAdapterConfirmation={model.local.setDeleteAdapterConfirmation}
    setPendingAction={model.local.setPendingAction} runPendingAction={model.runPendingAction}
    actionLoading={model.store.actionLoading} deleteAdapterLoading={model.local.deleteAdapterLoading}
    deleteConfirmationMatches={matches} />;
}

function ActiveAgentSection({ model }: { model: AgentModel }) {
  if (model.local.activeSection === 'build-jobs') return <BuildJobsSection {...model.builds}
    reviewError={model.review.reviewError} reviewLoading={model.review.reviewLoading}
    openReviewJob={model.review.openReviewJob} />;
  if (model.local.activeSection === 'deleted-adapters') return <DeletedAdaptersSection {...model.deleted} />;
  return <SiteAdapters model={model} />;
}

function SiteAdapters({ model }: { model: AgentModel }) {
  const candidateVersion = model.store.selectedAdapter?.latestCandidate?.version;
  const activeVersion = model.store.selectedAdapter?.activeVersion?.version;
  return <SiteAdaptersSection {...model.site} selectAdapter={model.store.selectAdapter}
    selectedAdapter={model.store.selectedAdapter} candidateVersion={candidateVersion} activeVersion={activeVersion}
    actionLoading={model.store.actionLoading} deleteAdapterLoading={model.local.deleteAdapterLoading}
    setPendingAction={model.local.setPendingAction} selectedVersionId={model.local.selectedVersionId}
    setSelectedVersionId={model.local.setSelectedVersionId} selectedVersion={model.selectedVersion} />;
}
