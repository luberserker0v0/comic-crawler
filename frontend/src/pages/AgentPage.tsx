import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '../store';
import { useWebSocket } from '../hooks';
import { useLocalStorage } from '../hooks';
import { formatText, useI18n } from '../text/i18n';
import { api, getApiErrorMessage } from '../api/client';
import { ImplementationEditor } from '../components/ImplementationEditor';
import { useBuildJobs } from './agent/useBuildJobs';
import { useDeletedAdapters } from './agent/useDeletedAdapters';
import { useReviewJob } from './agent/useReviewJob';
import { useSiteAdapters } from './agent/useSiteAdapters';
import {
  StatusBadge,
  VersionDetails,
  canRetryBuildJob,
  canReviewBuildJob,
  defaultTestUrlForFunction,
  formatActionDescription,
  formatActionTitle,
  formatBuildJobMode,
  formatBuildJobTarget,
  formatCapabilityValue,
  formatCooldown,
  formatDateTime,
  formatImplementationKind,
  formatJson,
  type PendingAction,
} from './agent/widgets';

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
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-amber-900">{formatActionTitle(text, pendingAction)}</h2>
              <p className="mt-1 text-sm text-amber-800">{formatActionDescription(text, pendingAction)}</p>
              {pendingAction.type === 'deleteAdapter' && pendingAction.sourceWillBeDeleted && (
                <div className="mt-3 max-w-2xl rounded-lg border border-rose-200 bg-white p-3 text-sm text-rose-800">
                  <div>{text.agent.pendingActions.deleteSourcePath}: <span className="font-mono">{pendingAction.sourcePath ?? '-'}</span></div>
                  <label className="mt-3 block">
                    <span className="font-medium">{formatText(text.agent.pendingActions.typeAdapterIdToConfirm, { adapterId: pendingAction.adapterId })}</span>
                    <input
                      value={deleteAdapterConfirmation}
                      onChange={(event) => setDeleteAdapterConfirmation(event.target.value)}
                      className="mt-2 w-full rounded-lg border border-rose-200 px-3 py-2 font-mono text-sm text-slate-900"
                      placeholder={pendingAction.adapterId}
                    />
                  </label>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setPendingAction(null);
                  setDeleteAdapterConfirmation('');
                }}
                className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900"
              >
                {text.agent.pendingActions.cancel}
              </button>
              <button
                onClick={runPendingAction}
                disabled={actionLoading || deleteAdapterLoading || !deleteConfirmationMatches}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading || deleteAdapterLoading ? text.agent.pendingActions.working : text.agent.pendingActions.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 rounded-2xl bg-white p-2 shadow">
        <button
          type="button"
          onClick={() => setActiveSection('site-adapters')}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeSection === 'site-adapters'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {text.agent.siteAdaptersTab}
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('build-jobs')}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeSection === 'build-jobs'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {text.agent.buildJobsTab}
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('deleted-adapters')}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeSection === 'deleted-adapters'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {text.agent.deletedAdaptersTab}
        </button>
      </div>

      {activeSection === 'build-jobs' && (
      <section className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{text.agent.buildJobs}</h2>
            <p className="mt-1 text-sm text-slate-500">{text.agent.buildJobsDescription}</p>
            <p className="mt-1 text-xs text-slate-400">{text.agent.buildJobTaskBoundary}</p>
          </div>
          <button
            type="button"
            onClick={() => void fetchBuildJobs()}
            disabled={buildJobsLoading}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {buildJobsLoading ? `${text.agent.refresh}...` : text.agent.refresh}
          </button>
        </div>
        {buildJobsError && (
          <div className="border-b border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">{buildJobsError}</div>
        )}
        <div className="divide-y divide-slate-100">
          {buildJobs.map((job) => (
            <div key={job.id} className="px-6 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900">{job.id}</span>
                    <StatusBadge text={text} value={job.status} />
                    {job.phase && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{job.phase}</span>}
                  </div>
                  <div className="mt-2 break-all text-sm text-slate-700">{job.normalizedUrl ?? job.url}</div>
                  <div className="mt-1 text-xs text-slate-500">{job.hostname}</div>
                </div>
                <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2 lg:min-w-[30rem]">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobTarget}</div>
                    <div className="mt-1 font-medium text-slate-800">{formatBuildJobTarget(text, job)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobMode}</div>
                    <div className="mt-1 font-medium text-slate-800">{formatBuildJobMode(text, job)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobAdapter}</div>
                    <div className="mt-1 break-all font-medium text-slate-800">{job.adapterName ?? job.adapterId ?? job.baseAdapterId ?? '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobUpdated}</div>
                    <div className="mt-1 font-medium text-slate-800">{formatDateTime(job.updatedAt)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobModel}</div>
                    <div className="mt-1 break-all font-medium text-slate-800">{job.model ?? '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobAoUrl}</div>
                    <div className="mt-1 break-all font-medium text-slate-800">{job.aoBaseUrl ?? '-'}</div>
                  </div>
                </div>
              </div>
              {job.error && (
                <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
                  <span className="font-medium">{text.agent.buildJobError}: </span>
                  {String(job.error)}
                </div>
              )}
              {Boolean(job.implementationValidation) && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <span className="font-medium">implementationValidation: </span>
                  <span className="font-mono">{JSON.stringify(job.implementationValidation)}</span>
                </div>
              )}
              {canRetryBuildJob(job) && (
                <button
                  type="button"
                  onClick={() => void retryBuildJob(job.id)}
                  disabled={retryingBuildJobId === job.id}
                  className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {retryingBuildJobId === job.id ? `${text.agent.retryBuild}...` : text.agent.retryBuild}
                </button>
              )}
              {canReviewBuildJob(job) && (
                <button
                  type="button"
                  onClick={() => void openReviewJob(job.id)}
                  disabled={reviewLoading === 'load'}
                  className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reviewLoading === 'load' ? `${text.agent.reviewAdapterDraft}...` : text.agent.reviewAdapterDraft}
                </button>
              )}
            </div>
          ))}
          {buildJobs.length === 0 && !buildJobsLoading && (
            <div className="px-6 py-10 text-center text-sm text-slate-500">{text.agent.noBuildJobs}</div>
          )}
        </div>
      </section>
      )}

      {activeSection === 'deleted-adapters' && (
        <section className="rounded-2xl bg-white p-6 shadow">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">{text.agent.deletedAdapters}</h2>
              <p className="mt-1 text-sm text-slate-500">{text.agent.deletedAdaptersDescription}</p>
            </div>
            <button
              type="button"
              onClick={() => void fetchDeletedAdapters()}
              disabled={deletedAdaptersLoading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletedAdaptersLoading ? `${text.agent.refresh}...` : text.agent.refresh}
            </button>
          </div>

          {deletedAdaptersError && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{deletedAdaptersError}</div>
          )}

          <div className="mt-5 space-y-3">
            {deletedAdapters.map((adapter) => (
              <div key={`${adapter.adapterId}-${adapter.deletedAt}`} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{adapter.adapterId}</div>
                    <div className="mt-1 text-xs text-slate-500">{text.agent.deletedAt}: {formatDateTime(adapter.deletedAt)}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                        {formatImplementationKind(text, adapter.implementationKind)}
                      </span>
                      <span className={`rounded-full px-2 py-1 ${adapter.restorable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {adapter.restorable ? text.agent.restorable : text.agent.notRestorable}
                      </span>
                    </div>
                    {adapter.sourcePath && (
                      <div className="mt-3 break-all text-xs text-slate-600">
                        {text.agent.sourcePath}: <span className="font-mono">{adapter.sourcePath}</span>
                      </div>
                    )}
                    {adapter.sourceDirectory && (
                      <div className="mt-1 break-all text-xs text-slate-500">
                        {text.agent.sourceDirectory}: <span className="font-mono">{adapter.sourceDirectory}</span>
                      </div>
                    )}
                    <div className="mt-3 text-sm text-slate-600">{adapter.restoreReason}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void restoreDeletedAdapter(adapter.adapterId)}
                    disabled={!adapter.restorable || restoringAdapterId === adapter.adapterId}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {restoringAdapterId === adapter.adapterId ? `${text.agent.restoreAdapter}...` : text.agent.restoreAdapter}
                  </button>
                </div>
              </div>
            ))}
            {deletedAdapters.length === 0 && !deletedAdaptersLoading && (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                {text.agent.noDeletedAdapters}
              </div>
            )}
          </div>
        </section>
      )}

      {reviewJob && (
        <section className="overflow-hidden rounded-2xl bg-white shadow">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.25em] text-indigo-500">{text.agent.reviewPanelEyebrow}</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">{reviewCapabilities?.adapter.name ?? reviewJob.adapterName ?? reviewJob.id}</h2>
              <p className="mt-1 break-all text-sm text-slate-500">{reviewJob.normalizedUrl}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!reviewDraft ? (
                <button
                  type="button"
                  onClick={() => void createEditableReviewDraft()}
                  disabled={reviewLoading !== null || !reviewJob.adapterImplementationTs}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reviewLoading === 'edit' ? `${text.agent.editDraftCopy}...` : text.agent.editDraftCopy}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void saveEditableReviewDraft()}
                    disabled={reviewLoading !== null || reviewDraftContent === savedReviewDraftContent}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reviewLoading === 'save' ? `${text.agent.saveDraftCopy}...` : text.agent.saveDraftCopy}
                  </button>
                  <button
                    type="button"
                    onClick={resetEditableReviewDraft}
                    disabled={reviewLoading !== null || reviewDraftContent === (reviewImplementation?.content ?? '')}
                    className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {text.agent.resetDraftCopy}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => void approveReviewJob()}
                disabled={
                  reviewLoading !== null ||
                  Boolean(reviewDraft) ||
                  reviewJob.status !== 'awaiting_review' ||
                  (reviewJob.implementationValidation as { valid?: boolean } | undefined)?.valid === false
                }
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reviewLoading === 'approve' ? `${text.agent.approveAdapter}...` : text.agent.approveAdapter}
              </button>
              <button
                type="button"
                onClick={() => void rejectReviewJob()}
                disabled={reviewLoading !== null || reviewJob.status !== 'awaiting_review'}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reviewLoading === 'reject' ? `${text.agent.rejectDraft}...` : text.agent.rejectDraft}
              </button>
              <button
                type="button"
                onClick={() => closeReview()}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {text.agent.closeReview}
              </button>
            </div>
          </div>

          {reviewError && (
            <div className="border-b border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">{reviewError}</div>
          )}

          <div className="grid gap-6 p-6 xl:grid-cols-[0.85fr_1.15fr]">
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{text.agent.reviewJobSummary}</h3>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-400">Job ID</dt>
                    <dd className="mt-1 break-all font-medium text-slate-900">{reviewJob.id}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">{text.agent.buildJobTarget}</dt>
                    <dd className="mt-1 font-medium text-slate-900">{formatBuildJobTarget(text, reviewJob)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">{text.agent.buildJobMode}</dt>
                    <dd className="mt-1 font-medium text-slate-900">{formatBuildJobMode(text, reviewJob)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">{text.agent.buildJobUpdated}</dt>
                    <dd className="mt-1 font-medium text-slate-900">{formatDateTime(reviewJob.updatedAt)}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{text.agent.capabilitiesAndFunctions}</h3>
                <div className="mt-3 grid gap-2 text-sm">
                  {reviewCapabilities?.functions.map((fn) => (
                    <label
                      key={fn.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                        selectedReviewFunctionId === fn.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'
                      } ${fn.implemented ? '' : 'opacity-50'}`}
                    >
                      <input
                        type="radio"
                        name="review-function"
                        value={fn.id}
                        checked={selectedReviewFunctionId === fn.id}
                        disabled={!fn.implemented}
                        onChange={() => {
                          setSelectedReviewFunctionId(fn.id);
                          setReviewTestUrl(defaultTestUrlForFunction(reviewJob, fn.id));
                          setReviewTestResult(null);
                        }}
                        className="mt-1"
                      />
                      <span>
                        <span className="block font-medium text-slate-900">{fn.label}</span>
                        <span className="mt-1 block text-xs text-slate-500">{fn.capability} · {fn.implemented ? text.agent.implemented : text.agent.notImplemented}</span>
                      </span>
                    </label>
                  )) ?? (
                    <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">{text.agent.loadingReview}</div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{text.agent.runDraftFunctionTest}</h3>
                <label className="mt-3 block text-sm">
                  <span className="font-medium text-slate-700">{text.agent.testUrl}</span>
                  <input
                    value={reviewTestUrl}
                    onChange={(event) => setReviewTestUrl(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void runReviewFunctionTest()}
                  disabled={reviewLoading !== null || !selectedReviewFunctionId || !reviewTestUrl.trim()}
                  className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reviewLoading === 'test' ? `${text.agent.runTests}...` : text.agent.runTests}
                </button>
                {reviewTestResult && (
                  <div className={`mt-4 rounded-lg border p-3 text-sm ${
                    reviewTestResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
                  }`}>
                    <div className="font-semibold">
                      {reviewTestResult.ok ? text.agent.testPassed : text.agent.testFailed}
                      {' · '}
                      {reviewTestResult.status}
                      {' · '}
                      {reviewTestResult.durationMs}ms
                    </div>
                    <div className="mt-1 text-xs">
                      DOM: {reviewTestResult.domSource} · readiness: {reviewTestResult.readiness.status}
                    </div>
                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-white/70 p-3 text-xs text-slate-800">
                      {formatJson(reviewTestResult.resultSummary ?? reviewTestResult.error ?? reviewTestResult)}
                    </pre>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{text.agent.agentFunctionRevision}</h3>
                <p className="mt-2 text-sm text-slate-600">
                  {text.agent.agentFunctionRevisionDescription}
                </p>
                <textarea
                  value={functionRevisionInstruction}
                  onChange={(event) => setFunctionRevisionInstruction(event.target.value)}
                  placeholder={text.agent.functionRevisionPlaceholder}
                  className="mt-3 min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void requestFunctionRevision()}
                  disabled={reviewLoading !== null || !selectedReviewFunctionId || !functionRevisionInstruction.trim()}
                  className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reviewLoading === 'revision' ? `${text.agent.submitFunctionRevision}...` : text.agent.submitFunctionRevision}
                </button>
                {functionRevisionMessage && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                    {functionRevisionMessage}
                  </div>
                )}
                {reviewJob.functionRevisionTasks && reviewJob.functionRevisionTasks.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{text.agent.functionRevisionTasks}</div>
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <span>{text.agent.functionRevisionModelMode}</span>
                        <select
                          value={functionRevisionModelMode}
                          onChange={(event) => setFunctionRevisionModelMode(event.target.value as 'current-settings' | 'previous-task')}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                        >
                          <option value="current-settings">{text.agent.functionRevisionModelCurrent}</option>
                          <option value="previous-task">{text.agent.functionRevisionModelPrevious}</option>
                        </select>
                      </label>
                    </div>
                    {reviewJob.functionRevisionTasks.slice().reverse().map((task) => (
                      <div key={task.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-semibold">{task.id}</span>
                          <span className="rounded-full bg-white px-2 py-1 font-medium">{task.status}</span>
                        </div>
                        <div className="mt-2 font-medium">{task.functionId}</div>
                        {(task.model || task.aoBaseUrl || task.conversationId) && (
                          <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                            {task.model && <div>Model: <span className="font-mono">{task.model}</span></div>}
                            {task.aoBaseUrl && <div>AO URL: <span className="font-mono">{task.aoBaseUrl}</span></div>}
                            {task.conversationId && <div>AO conversation: <span className="font-mono">{task.conversationId}</span></div>}
                          </div>
                        )}
                        <div className="mt-1 whitespace-pre-wrap break-words">{task.instruction}</div>
                        {(task.status === 'queued' || task.status === 'failed' || task.status === 'awaiting_review') && (
                          <button
                            type="button"
                            onClick={() => void retryFunctionRevision(task.id)}
                            disabled={reviewLoading !== null}
                            className="mt-3 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {reviewLoading === 'revision' ? `${text.agent.runFunctionRevision}...` : text.agent.runFunctionRevision}
                          </button>
                        )}
                        {task.error && (
                          <div className="mt-2 whitespace-pre-wrap break-words rounded border border-rose-200 bg-rose-50 p-2 text-rose-700">{task.error}</div>
                        )}
                        {task.selfCheckMarkdown && (
                          <details className="mt-2 rounded border border-slate-200 bg-white p-2">
                            <summary className="cursor-pointer font-medium text-slate-700">{text.agent.functionRevisionSelfCheck}</summary>
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                              {task.selfCheckMarkdown}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{text.agent.reviewNotes}</h3>
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                  {reviewJob.reviewNotesMarkdown || text.agent.noReviewNotes}
                </pre>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{text.agent.implementationValidation}</h3>
                <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  {formatJson(reviewJob.implementationValidation ?? {})}
                </pre>
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{text.agent.implementationSource}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                  {reviewDraft ? `${reviewDraft.draft.sourceKind} · ${reviewDraft.draft.draftId}` : reviewImplementation?.sourceType ?? '-'}
                </span>
              </div>
              {reviewDraft && (
                <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                  {text.agent.editingDraftCopy}
                  {reviewDraftContent !== savedReviewDraftContent && (
                    <span className="ml-2 font-semibold">{text.agent.unsavedDraftChanges}</span>
                  )}
                </div>
              )}
              <ImplementationEditor
                content={reviewDraft ? reviewDraftContent : reviewImplementation?.content ?? ''}
                language={reviewDraft?.language ?? reviewImplementation?.language ?? 'typescript'}
                outline={reviewImplementation?.outline ?? []}
                selectedSymbolId={selectedReviewFunctionId}
                readOnly={!reviewDraft}
                onChange={reviewDraft ? setReviewDraftContent : undefined}
              />
            </div>
          </div>
        </section>
      )}

      {activeSection === 'site-adapters' && (
      <div className="grid gap-6 lg:grid-cols-[1.05fr_1.95fr]">
        <section className="overflow-hidden rounded-2xl bg-white shadow">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">{text.agent.adapters}</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {siteAdapters.map((adapter) => (
              <button
                key={adapter.id}
                onClick={() => {
                  setSelectedSiteAdapterId(adapter.id);
                  void selectAdapter(adapter.id);
                }}
                className={`flex w-full flex-col gap-3 px-6 py-4 text-left transition hover:bg-slate-50 ${
                  selectedSiteAdapterId === adapter.id ? 'bg-slate-50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-900">{adapter.id}</div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{adapter.parseMode}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs text-slate-500">
                  <div>
                    <div>{text.agent.activeVersion}</div>
                    <div className="mt-1 truncate font-medium text-slate-700">{adapter.activeVersionLabel}</div>
                  </div>
                  <div>
                    <div>{text.agent.capabilities}</div>
                    <div className="mt-1 truncate font-medium text-slate-700">
                      M {formatCapabilityValue(adapter.capabilities.metadata)} / I {formatCapabilityValue(adapter.capabilities.chapterImages)}
                    </div>
                  </div>
                  <div>
                    <div>{text.agent.versionCount}</div>
                    <div className="mt-1 font-medium text-slate-700">{adapter.versionCount}</div>
                  </div>
                </div>
              </button>
            ))}
            {siteAdapters.length === 0 && !siteAdaptersLoading && (
              <div className="px-6 py-10 text-center text-sm text-slate-500">{text.agent.noAdapters}</div>
            )}
          </div>
          {siteAdaptersError && (
            <div className="border-t border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">{siteAdaptersError}</div>
          )}
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{selectedSiteAdapter?.name ?? selectedSiteAdapter?.id ?? text.agent.adapters}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedSiteAdapter?.domains.join(', ') ?? text.agent.selectAdapter}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    selectedSiteAdapter &&
                    setPendingAction({
                      type: 'deleteAdapter',
                      adapterId: selectedSiteAdapter.id,
                      adapterName: selectedSiteAdapter.name,
                      implementationKind: selectedSiteAdapter.implementationKind,
                      sourcePath: selectedSiteAdapter.sourcePath,
                      sourceWillBeDeleted: selectedSiteAdapter.sourceWillBeDeleted,
                    })
                  }
                  disabled={!selectedSiteAdapter || actionLoading || deleteAdapterLoading}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {text.agent.deleteAdapter}
                </button>
                <button
                  onClick={() =>
                    selectedAdapter &&
                    candidateVersion &&
                    setPendingAction({ type: 'promote', adapterId: selectedAdapter.adapterId, version: candidateVersion })
                  }
                  disabled={!selectedAdapter || !candidateVersion || actionLoading}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {text.agent.promoteCandidate}
                </button>
                <button
                  onClick={() =>
                    selectedAdapter &&
                    candidateVersion &&
                    setPendingAction({ type: 'reject', adapterId: selectedAdapter.adapterId, version: candidateVersion })
                  }
                  disabled={!selectedAdapter || !candidateVersion || actionLoading}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {text.agent.rejectCandidate}
                </button>
                <button
                  onClick={() =>
                    selectedAdapter &&
                    setPendingAction({ type: 'rollback', adapterId: selectedAdapter.adapterId })
                  }
                  disabled={!selectedAdapter || !activeVersion || actionLoading}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {text.agent.rollbackActive}
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.capabilities}</div>
                <div className="mt-2 grid gap-1 text-sm font-medium text-slate-900">
                  <div>{text.agent.capabilityVerification}: {formatCapabilityValue(Boolean(selectedSiteAdapter?.capabilities.verification))}</div>
                  <div>{text.agent.capabilityMetadata}: {formatCapabilityValue(Boolean(selectedSiteAdapter?.capabilities.metadata))}</div>
                  <div>{text.agent.capabilityChapterImages}: {formatCapabilityValue(Boolean(selectedSiteAdapter?.capabilities.chapterImages))}</div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.activeVersion}</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{selectedSiteAdapter?.activeVersionLabel ?? 'current'}</div>
                <div className="mt-3 text-sm text-slate-600">{text.agent.versionCount}: {selectedSiteAdapter?.versionCount ?? 1}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.implementationKind}</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{formatImplementationKind(text, selectedSiteAdapter?.implementationKind)}</div>
                <div className="mt-3 text-sm text-slate-600">{text.agent.parseMode}: {selectedSiteAdapter?.parseMode ?? '-'}</div>
                {selectedSiteAdapter?.sourcePath && (
                  <div className="mt-3 break-all text-xs text-slate-500">
                    {text.agent.sourcePath}: <span className="font-mono">{selectedSiteAdapter.sourcePath}</span>
                  </div>
                )}
                {selectedSiteAdapter?.sourceWillBeDeleted && (
                  <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                    {text.agent.sourceWillBeDeleted}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="rounded-2xl bg-white p-6 shadow">
                <h3 className="text-lg font-semibold text-slate-900">{text.agent.versionHistory}</h3>
                <div className="mt-4 space-y-3">
                  {selectedAdapter?.versions?.versions.map((version) => {
                    const isSelected = selectedVersionId === version.version;
                    return (
                      <button
                        key={version.version}
                        onClick={() => setSelectedVersionId(version.version)}
                        className={`w-full rounded-xl border p-4 text-left transition ${
                          isSelected
                            ? 'border-slate-900 bg-slate-50 shadow-sm'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{version.version}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {text.agent.fixturesPassed}: {version.testResults?.passed ?? 0} | {text.agent.fixturesFailed}: {version.testResults?.failed ?? 0}
                            </div>
                          </div>
                          <StatusBadge text={text} value={version.status} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {version.validation?.fixtureResults?.map((fixture) => (
                            <span
                              key={`${version.version}-${fixture.fixtureName}`}
                              className={`rounded-full px-2 py-1 text-xs font-medium ${
                                fixture.valid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              {fixture.fixtureName}
                            </span>
                          )) ?? <span className="text-xs text-slate-400">{text.agent.noFixtureDetails}</span>}
                        </div>
                      </button>
                    );
                  })}
                  {!selectedAdapter?.versions?.versions.length && (
                    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                      {text.agent.noVersionHistory}
                    </div>
                  )}
                </div>
              </div>

              <VersionDetails text={text} version={selectedVersion} />
            </div>

            <div className="rounded-2xl bg-white p-6 shadow">
              <h3 className="text-lg font-semibold text-slate-900">{text.agent.repairContext}</h3>
              <dl className="mt-4 space-y-4 text-sm">
                <div>
                  <dt className="text-slate-400">{text.agent.sessionId}</dt>
                  <dd className="mt-1 font-medium text-slate-900">{selectedAdapter?.session?.sessionId ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">{text.agent.pageType}</dt>
                  <dd className="mt-1 font-medium text-slate-900">{selectedAdapter?.session?.pageType ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">{text.agent.triggerKey}</dt>
                  <dd className="mt-1 break-all font-medium text-slate-900">{selectedAdapter?.session?.triggerKey ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">{text.agent.lastFailure}</dt>
                  <dd className="mt-1 text-slate-700">{selectedAdapter?.session?.lastFailure?.reason ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">{text.agent.currentCandidate}</dt>
                  <dd className="mt-1 font-medium text-slate-900">{selectedAdapter?.session?.candidateVersion ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">{text.agent.sourceVersion}</dt>
                  <dd className="mt-1 font-medium text-slate-900">{selectedAdapter?.session?.sourceVersion ?? '-'}</dd>
                </div>
              </dl>

              <div className="mt-8 border-t border-slate-200 pt-6">
                <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">{text.agent.autoTrigger}</h4>
                {selectedAdapter?.triggerProgress ? (
                  <div className="mt-4 space-y-4 text-sm">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.failedProgress}</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900">
                          {selectedAdapter.triggerProgress.count} / {selectedAdapter.triggerProgress.threshold}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.remainingFailures}</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900">
                          {selectedAdapter.triggerProgress.remainingFailures}
                        </div>
                      </div>
                    </div>
                    <dl className="space-y-3">
                      <div>
                        <dt className="text-slate-400">{text.agent.triggerKey}</dt>
                        <dd className="mt-1 break-all font-medium text-slate-900">{selectedAdapter.triggerProgress.triggerKey}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">{text.agent.lastFailure}</dt>
                        <dd className="mt-1 text-slate-700">{selectedAdapter.triggerProgress.lastMessage}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">{text.agent.cooldown}</dt>
                        <dd className="mt-1 font-medium text-slate-900">
                          {selectedAdapter.triggerProgress.inCooldown
                            ? formatCooldown(selectedAdapter.triggerProgress.cooldownRemainingMs)
                            : text.agent.cooldownReady}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    {text.agent.noTriggerProgress}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
      )}
    </div>
  );
};
