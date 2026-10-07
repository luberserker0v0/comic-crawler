import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '../store';
import { useWebSocket } from '../hooks';
import { useLocalStorage } from '../hooks';
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

export const AgentPage: React.FC = () => {
  const {
    adapters,
    selectedAdapterId,
    selectedAdapter,
    actionLoading,
    error,
    fetchAdapters,
    selectAdapter,
    applyRealtimeEvent,
    promoteCandidate,
    rejectCandidate,
    rollbackAdapter,
    clearError,
  } = useAgentStore();
  const { text } = useI18n();
  const [selectedVersionId, setSelectedVersionId] = useLocalStorage<string | null>('agent:selected-version', null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [persistedAdapterId, setPersistedAdapterId] = useLocalStorage<string | null>('agent:selected-adapter', null);
  const [activeSection, setActiveSection] = useLocalStorage<'site-adapters' | 'build-jobs' | 'deleted-adapters'>('agent:active-section', 'site-adapters');
  const [deleteAdapterLoading, setDeleteAdapterLoading] = useState(false);
  const [deleteAdapterConfirmation, setDeleteAdapterConfirmation] = useState('');
  const [deleteAdapterResult, setDeleteAdapterResult] = useState<string | null>(null);
  const {
    siteAdapters,
    siteAdaptersLoading,
    siteAdaptersError,
    setSiteAdaptersError,
    selectedSiteAdapterId,
    setSelectedSiteAdapterId,
    selectedSiteAdapter,
    fetchSiteAdapters,
  } = useSiteAdapters();
  const {
    deletedAdapters,
    deletedAdaptersLoading,
    deletedAdaptersError,
    restoringAdapterId,
    fetchDeletedAdapters,
    restoreDeletedAdapter,
  } = useDeletedAdapters({ fetchSiteAdapters, fetchAdapters });
  const {
    buildJobs,
    buildJobsLoading,
    buildJobsError,
    retryingBuildJobId,
    fetchBuildJobs,
    retryBuildJob,
  } = useBuildJobs();
  const {
    reviewJob,
    reviewImplementation,
    reviewCapabilities,
    reviewDraft,
    reviewDraftContent,
    setReviewDraftContent,
    savedReviewDraftContent,
    selectedReviewFunctionId,
    setSelectedReviewFunctionId,
    reviewTestUrl,
    setReviewTestUrl,
    reviewTestResult,
    setReviewTestResult,
    functionRevisionInstruction,
    setFunctionRevisionInstruction,
    functionRevisionModelMode,
    setFunctionRevisionModelMode,
    functionRevisionMessage,
    reviewError,
    reviewLoading,
    openReviewJob,
    createEditableReviewDraft,
    saveEditableReviewDraft,
    resetEditableReviewDraft,
    requestFunctionRevision,
    retryFunctionRevision,
    runReviewFunctionTest,
    approveReviewJob,
    rejectReviewJob,
    closeReview,
  } = useReviewJob({ fetchBuildJobs, fetchSiteAdapters, fetchAdapters });
  const wsUrl = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    : '';

  const handleRealtimeMessage = useCallback((message: { event?: string; data?: Record<string, unknown> }) => {
    if (!message.event?.startsWith('adapter:repair:')) {
      return;
    }

    void applyRealtimeEvent(message);
  }, [applyRealtimeEvent]);

  const { connected, subscribe, unsubscribe } = useWebSocket(wsUrl, handleRealtimeMessage);

  useEffect(() => {
    fetchAdapters();
  }, [fetchAdapters]);

  useEffect(() => {
    fetchAdapters();
  }, [fetchAdapters]);

  useEffect(() => {
    if (!selectedAdapterId && adapters.length > 0) {
      const preferredAdapter = persistedAdapterId && adapters.some((adapter) => adapter.adapterId === persistedAdapterId)
        ? persistedAdapterId
        : adapters[0]!.adapterId;
      selectAdapter(preferredAdapter);
    }
  }, [adapters, selectedAdapterId, persistedAdapterId, selectAdapter]);

  useEffect(() => {
    if (selectedAdapterId) {
      setPersistedAdapterId(selectedAdapterId);
    }
  }, [selectedAdapterId, setPersistedAdapterId]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    const events = [
      'adapter:repair:started',
      'adapter:repair:validated',
      'adapter:repair:candidate-created',
      'adapter:repair:promotion-requested',
      'adapter:repair:promoted',
      'adapter:repair:failed',
      'adapter:repair:rolled-back',
    ];

    events.forEach((event) => subscribe(event));

    return () => {
      events.forEach((event) => unsubscribe(event));
    };
  }, [connected, subscribe, unsubscribe]);

  useEffect(() => {
    const versions = selectedAdapter?.versions?.versions ?? [];

    if (versions.length === 0) {
      if (selectedVersionId !== null) {
        setSelectedVersionId(null);
      }
      return;
    }

    const stillExists = selectedVersionId
      ? versions.some((version) => version.version === selectedVersionId)
      : false;
    const nextVersionId = stillExists ? selectedVersionId : versions[0]!.version;

    if (selectedVersionId !== nextVersionId) {
      setSelectedVersionId(nextVersionId);
    }
  }, [selectedAdapter, selectedVersionId, setSelectedVersionId]);

  const candidateVersion = selectedAdapter?.latestCandidate?.version;
  const activeVersion = selectedAdapter?.activeVersion?.version;
  const selectedVersion = useMemo(
    () => selectedAdapter?.versions?.versions.find((version) => version.version === selectedVersionId) ?? null,
    [selectedAdapter, selectedVersionId]
  );
  const deleteRequiresTypedConfirmation = pendingAction?.type === 'deleteAdapter' && Boolean(pendingAction.sourceWillBeDeleted);
  const deleteConfirmationMatches = !deleteRequiresTypedConfirmation || deleteAdapterConfirmation.trim() === pendingAction?.adapterId;

  const runPendingAction = async () => {
    if (!pendingAction) return;

    if (pendingAction.type === 'promote') {
      await promoteCandidate(pendingAction.adapterId, pendingAction.version);
    } else if (pendingAction.type === 'reject') {
      await rejectCandidate(pendingAction.adapterId, pendingAction.version);
    } else if (pendingAction.type === 'deleteAdapter') {
      setDeleteAdapterLoading(true);
      try {
        const response = await api.deleteAdapter(pendingAction.adapterId);
        await Promise.all([fetchSiteAdapters(), fetchAdapters(), fetchDeletedAdapters()]);
        setDeleteAdapterResult([
          response.data.message,
          `Registry removed: ${response.data.registryRemoved ? 'yes' : 'no'}`,
          `Source deleted: ${response.data.sourceDeleted ? 'yes' : 'no'}`,
          `Deleted marker: ${response.data.deletedMarkerWritten ? 'written' : 'missing'}`,
        ].join(' · '));
        if (selectedSiteAdapterId === pendingAction.adapterId) {
          setSelectedSiteAdapterId(null);
        }
        if (selectedAdapterId === pendingAction.adapterId) {
          setPersistedAdapterId(null);
        }
      } catch (error) {
        setSiteAdaptersError(getApiErrorMessage(error));
        return;
      } finally {
        setDeleteAdapterLoading(false);
      }
    } else {
      await rollbackAdapter(pendingAction.adapterId, pendingAction.version);
    }

    setPendingAction(null);
    setDeleteAdapterConfirmation('');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-6 shadow sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">{text.agent.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">{text.agent.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            {text.agent.description}
          </p>
        </div>
        <button
          onClick={() => {
            void fetchAdapters();
            void fetchSiteAdapters();
            void fetchBuildJobs();
            void fetchDeletedAdapters();
            if (selectedAdapterId) {
              void selectAdapter(selectedAdapterId);
            }
          }}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {text.agent.refresh}
        </button>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          {text.agent.realtime}: {connected ? text.agent.connected : text.agent.disconnected}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <div>{error}</div>
          <button onClick={clearError} className="mt-2 font-medium underline">
            {text.settings.dismissError}
          </button>
        </div>
      )}

      {deleteAdapterResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div>{deleteAdapterResult}</div>
          <button onClick={() => setDeleteAdapterResult(null)} className="mt-2 font-medium underline">
            {text.settings.dismissError}
          </button>
        </div>
      )}

      {pendingAction && (
        <PendingActionBanner
          pendingAction={pendingAction}
          deleteAdapterConfirmation={deleteAdapterConfirmation}
          setDeleteAdapterConfirmation={setDeleteAdapterConfirmation}
          setPendingAction={setPendingAction}
          runPendingAction={runPendingAction}
          actionLoading={actionLoading}
          deleteAdapterLoading={deleteAdapterLoading}
          deleteConfirmationMatches={deleteConfirmationMatches}
        />
      )}

      <SectionTabs activeSection={activeSection} setActiveSection={setActiveSection} />

      {activeSection === 'build-jobs' && (
        <BuildJobsSection
          buildJobs={buildJobs}
          buildJobsLoading={buildJobsLoading}
          buildJobsError={buildJobsError}
          retryingBuildJobId={retryingBuildJobId}
          reviewLoading={reviewLoading}
          fetchBuildJobs={fetchBuildJobs}
          retryBuildJob={retryBuildJob}
          openReviewJob={openReviewJob}
        />
      )}

      {activeSection === 'deleted-adapters' && (
        <DeletedAdaptersSection
          deletedAdapters={deletedAdapters}
          deletedAdaptersLoading={deletedAdaptersLoading}
          deletedAdaptersError={deletedAdaptersError}
          restoringAdapterId={restoringAdapterId}
          fetchDeletedAdapters={fetchDeletedAdapters}
          restoreDeletedAdapter={restoreDeletedAdapter}
        />
      )}

      {reviewJob && (
        <ReviewPanel
          reviewJob={reviewJob}
          reviewImplementation={reviewImplementation}
          reviewCapabilities={reviewCapabilities}
          reviewDraft={reviewDraft}
          reviewDraftContent={reviewDraftContent}
          setReviewDraftContent={setReviewDraftContent}
          savedReviewDraftContent={savedReviewDraftContent}
          selectedReviewFunctionId={selectedReviewFunctionId}
          setSelectedReviewFunctionId={setSelectedReviewFunctionId}
          reviewTestUrl={reviewTestUrl}
          setReviewTestUrl={setReviewTestUrl}
          reviewTestResult={reviewTestResult}
          setReviewTestResult={setReviewTestResult}
          functionRevisionInstruction={functionRevisionInstruction}
          setFunctionRevisionInstruction={setFunctionRevisionInstruction}
          functionRevisionModelMode={functionRevisionModelMode}
          setFunctionRevisionModelMode={setFunctionRevisionModelMode}
          functionRevisionMessage={functionRevisionMessage}
          reviewError={reviewError}
          reviewLoading={reviewLoading}
          createEditableReviewDraft={createEditableReviewDraft}
          saveEditableReviewDraft={saveEditableReviewDraft}
          resetEditableReviewDraft={resetEditableReviewDraft}
          requestFunctionRevision={requestFunctionRevision}
          retryFunctionRevision={retryFunctionRevision}
          runReviewFunctionTest={runReviewFunctionTest}
          approveReviewJob={approveReviewJob}
          rejectReviewJob={rejectReviewJob}
          closeReview={closeReview}
        />
      )}
      {activeSection === 'site-adapters' && (
        <SiteAdaptersSection
          siteAdapters={siteAdapters}
          siteAdaptersLoading={siteAdaptersLoading}
          siteAdaptersError={siteAdaptersError}
          selectedSiteAdapterId={selectedSiteAdapterId}
          setSelectedSiteAdapterId={setSelectedSiteAdapterId}
          selectAdapter={selectAdapter}
          selectedSiteAdapter={selectedSiteAdapter}
          selectedAdapter={selectedAdapter}
          candidateVersion={candidateVersion}
          activeVersion={activeVersion}
          actionLoading={actionLoading}
          deleteAdapterLoading={deleteAdapterLoading}
          setPendingAction={setPendingAction}
          selectedVersionId={selectedVersionId}
          setSelectedVersionId={setSelectedVersionId}
          selectedVersion={selectedVersion}
        />
      )}

    </div>
  );
};
