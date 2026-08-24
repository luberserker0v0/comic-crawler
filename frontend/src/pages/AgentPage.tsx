import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '../store';
import type { AgentVersionSummary } from '../store';
import { useWebSocket } from '../hooks';
import { useLocalStorage } from '../hooks';
import { formatText, useI18n } from '../text/i18n';
import { api, getApiErrorMessage } from '../api/client';
import { ImplementationEditor } from '../components/ImplementationEditor';
import type {
  AdapterListItem,
  AdapterCapabilityDetailResponse,
  AdapterDraftDetailResponse,
  AdapterFunctionTestResponse,
  AdapterImplementationResponse,
  SelectorDiscoveryJobSummary,
} from '@comiccrawler/shared';

const badgeClassByStatus: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  candidate: 'bg-amber-100 text-amber-700',
  rolled_back: 'bg-rose-100 text-rose-700',
  rejected: 'bg-slate-100 text-slate-700',
  awaiting_review: 'bg-amber-100 text-amber-700',
  promoted: 'bg-green-100 text-green-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-rose-100 text-rose-700',
  in_progress: 'bg-blue-100 text-blue-700',
  running: 'bg-blue-100 text-blue-700',
  queued: 'bg-blue-100 text-blue-700',
  configuration_required: 'bg-amber-100 text-amber-700',
  known_adapter: 'bg-slate-100 text-slate-700',
};

type PendingAction =
  | { type: 'promote'; adapterId: string; version: string }
  | { type: 'reject'; adapterId: string; version: string }
  | { type: 'rollback'; adapterId: string; version?: string }
  | { type: 'deleteAdapter'; adapterId: string; adapterName?: string };

function getBadgeLabel(
  text: ReturnType<typeof useI18n>['text'],
  value: string | null | undefined
): string {
  if (!value) {
    return '-';
  }

  return text.agent.statusLabels[value as keyof typeof text.agent.statusLabels] ?? value;
}

function StatusBadge({
  text,
  value,
}: {
  text: ReturnType<typeof useI18n>['text'];
  value: string | null | undefined;
}) {
  if (!value) {
    return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">-</span>;
  }

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${badgeClassByStatus[value] ?? 'bg-slate-100 text-slate-700'}`}>
      {getBadgeLabel(text, value)}
    </span>
  );
}

function formatActionTitle(text: ReturnType<typeof useI18n>['text'], action: PendingAction): string {
  if (action.type === 'promote') return text.agent.pendingActions.promoteTitle;
  if (action.type === 'reject') return text.agent.pendingActions.rejectTitle;
  if (action.type === 'deleteAdapter') return text.agent.pendingActions.deleteAdapterTitle;
  return text.agent.pendingActions.rollbackTitle;
}

function formatActionDescription(text: ReturnType<typeof useI18n>['text'], action: PendingAction): string {
  if (action.type === 'promote') {
    return formatText(text.agent.pendingActions.promoteDescription, action);
  }

  if (action.type === 'reject') {
    return formatText(text.agent.pendingActions.rejectDescription, action);
  }

  if (action.type === 'deleteAdapter') {
    return formatText(text.agent.pendingActions.deleteAdapterDescription, {
      adapterId: action.adapterId,
      adapterName: action.adapterName ?? action.adapterId,
    });
  }

  return action.version
    ? formatText(text.agent.pendingActions.rollbackDescriptionWithVersion, action as Required<PendingAction>)
    : formatText(text.agent.pendingActions.rollbackDescriptionWithoutVersion, action);
}

function VersionDetails({
  text,
  version,
}: {
  text: ReturnType<typeof useI18n>['text'];
  version: AgentVersionSummary | null | undefined;
}) {
  if (!version) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        {text.agent.versionDetailsEmpty}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{version.version}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {text.agent.repairMode}: {version.repairMode ?? '-'} | {text.agent.basedOn}: {version.basedOnVersion ?? text.agent.runtimeBaseline}
          </p>
        </div>
        <StatusBadge text={text} value={version.status} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.validation}</div>
          <div className="mt-2 text-sm font-semibold text-slate-900">
            {version.validation?.syntaxValid === false ? text.agent.syntaxFailed : text.agent.syntaxPassed}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.fixturesPassed}</div>
          <div className="mt-2 text-sm font-semibold text-slate-900">{version.testResults?.passed ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.fixturesFailed}</div>
          <div className="mt-2 text-sm font-semibold text-slate-900">{version.testResults?.failed ?? 0}</div>
        </div>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">{text.agent.fixtureResults}</h4>
        <div className="mt-3 space-y-3">
          {version.validation?.fixtureResults?.map((fixture) => (
            <div key={`${version.version}-${fixture.fixtureName}`} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">{fixture.fixtureName}</div>
                <StatusBadge text={text} value={fixture.valid ? 'valid' : 'invalid'} />
              </div>
              {fixture.errors.length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm text-rose-700">
                  {fixture.errors.map((error) => (
                    <li key={`${fixture.fixtureName}-${error}`} className="rounded-lg bg-rose-50 px-3 py-2">
                      {error}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {text.agent.fixtureMatched}
                </div>
              )}
            </div>
          )) ?? (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              {text.agent.noFixtureDetails}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatCooldown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function isActiveBuildJob(job: SelectorDiscoveryJobSummary): boolean {
  return job.status === 'queued' || job.status === 'running';
}

function canRetryBuildJob(job: SelectorDiscoveryJobSummary): boolean {
  return job.status === 'invalid' || job.status === 'failed';
}

function canReviewBuildJob(job: SelectorDiscoveryJobSummary): boolean {
  return job.status === 'awaiting_review' && Boolean(job.adapterImplementationTs?.trim());
}

function formatBuildJobTarget(text: ReturnType<typeof useI18n>['text'], job: SelectorDiscoveryJobSummary): string {
  return job.target === 'chapter-only' ? text.agent.buildJobChapterOnly : text.agent.buildJobFull;
}

function formatBuildJobMode(text: ReturnType<typeof useI18n>['text'], job: SelectorDiscoveryJobSummary): string {
  return job.promotionMode === 'augment' ? text.agent.buildJobAugment : text.agent.buildJobCreate;
}

function formatDateTime(value: string | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function extractRepresentativeChapterUrl(job: SelectorDiscoveryJobSummary): string | undefined {
  const source = [job.phase1Markdown, job.candidateMarkdown, job.reviewNotesMarkdown].filter(Boolean).join('\n');
  const explicit = /Representative Chapter URL[\s\S]*?(https?:\/\/[^\s)<>"']+)/i.exec(source)?.[1];
  if (explicit) return explicit;
  return /https?:\/\/[^\s)<>"']*\/(?:chapter|mangaread)[^\s)<>"']*/i.exec(source)?.[0];
}

function defaultTestUrlForFunction(job: SelectorDiscoveryJobSummary, functionId: string): string {
  if (functionId === 'extractChapterImageUrls') {
    return extractRepresentativeChapterUrl(job) ?? job.normalizedUrl ?? job.url;
  }
  return job.normalizedUrl ?? job.url;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatCapabilityValue(value: boolean): string {
  return value ? 'O' : 'X';
}

function formatImplementationKind(text: ReturnType<typeof useI18n>['text'], kind: AdapterListItem['implementationKind']): string {
  if (!kind) return '-';
  return text.agent.implementationKinds[kind as keyof typeof text.agent.implementationKinds] ?? kind;
}

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
  const [activeSection, setActiveSection] = useLocalStorage<'site-adapters' | 'build-jobs'>('agent:active-section', 'site-adapters');
  const [siteAdapters, setSiteAdapters] = useState<AdapterListItem[]>([]);
  const [siteAdaptersLoading, setSiteAdaptersLoading] = useState(false);
  const [siteAdaptersError, setSiteAdaptersError] = useState<string | null>(null);
  const [selectedSiteAdapterId, setSelectedSiteAdapterId] = useLocalStorage<string | null>('agent:selected-site-adapter', null);
  const [deleteAdapterLoading, setDeleteAdapterLoading] = useState(false);
  const [buildJobs, setBuildJobs] = useState<SelectorDiscoveryJobSummary[]>([]);
  const [buildJobsLoading, setBuildJobsLoading] = useState(false);
  const [buildJobsError, setBuildJobsError] = useState<string | null>(null);
  const [retryingBuildJobId, setRetryingBuildJobId] = useState<string | null>(null);
  const [reviewJob, setReviewJob] = useState<SelectorDiscoveryJobSummary | null>(null);
  const [reviewImplementation, setReviewImplementation] = useState<AdapterImplementationResponse | null>(null);
  const [reviewCapabilities, setReviewCapabilities] = useState<AdapterCapabilityDetailResponse | null>(null);
  const [reviewDraft, setReviewDraft] = useState<AdapterDraftDetailResponse | null>(null);
  const [reviewDraftContent, setReviewDraftContent] = useState('');
  const [savedReviewDraftContent, setSavedReviewDraftContent] = useState('');
  const [selectedReviewFunctionId, setSelectedReviewFunctionId] = useState('');
  const [reviewTestUrl, setReviewTestUrl] = useState('');
  const [reviewTestResult, setReviewTestResult] = useState<AdapterFunctionTestResponse | null>(null);
  const [functionRevisionInstruction, setFunctionRevisionInstruction] = useState('');
  const [functionRevisionModelMode, setFunctionRevisionModelMode] = useState<'current-settings' | 'previous-task'>('current-settings');
  const [functionRevisionMessage, setFunctionRevisionMessage] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState<'load' | 'test' | 'approve' | 'reject' | 'edit' | 'save' | 'revision' | null>(null);
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

  const fetchSiteAdapters = useCallback(async () => {
    setSiteAdaptersLoading(true);
    try {
      const response = await api.getAdapters();
      const items = [...(response.data ?? [])].sort((a, b) => a.id.localeCompare(b.id));
      setSiteAdapters(items);
      setSiteAdaptersError(null);
      if (!selectedSiteAdapterId && items.length > 0) {
        setSelectedSiteAdapterId(items[0]!.id);
      }
    } catch (error) {
      setSiteAdaptersError(getApiErrorMessage(error));
    } finally {
      setSiteAdaptersLoading(false);
    }
  }, [selectedSiteAdapterId, setSelectedSiteAdapterId]);

  const fetchBuildJobs = useCallback(async () => {
    setBuildJobsLoading(true);
    try {
      const response = await api.listSelectorDiscoveries();
      const jobs = [...(response.data.jobs ?? [])].sort((a, b) => (
        new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime()
      ));
      setBuildJobs(jobs);
      setBuildJobsError(null);
    } catch (error) {
      setBuildJobsError(getApiErrorMessage(error));
    } finally {
      setBuildJobsLoading(false);
    }
  }, []);

  const retryBuildJob = useCallback(async (id: string) => {
    setRetryingBuildJobId(id);
    try {
      await api.retrySelectorDiscovery(id);
      await fetchBuildJobs();
    } catch (error) {
      setBuildJobsError(getApiErrorMessage(error));
    } finally {
      setRetryingBuildJobId(null);
    }
  }, [fetchBuildJobs]);

  const openReviewJob = useCallback(async (id: string) => {
    setReviewLoading('load');
    setReviewError(null);
    setReviewTestResult(null);
    try {
      const [jobResponse, implementationResponse, capabilitiesResponse] = await Promise.all([
        api.getSelectorDiscovery(id),
        api.getSelectorDiscoveryImplementation(id),
        api.getSelectorDiscoveryCapabilities(id),
      ]);
      const implementedFunctions = capabilitiesResponse.data.functions.filter((item) => item.implemented);
      const firstFunctionId = implementedFunctions[0]?.id ?? '';
      setReviewJob(jobResponse.data);
      setReviewImplementation(implementationResponse.data);
      setReviewCapabilities(capabilitiesResponse.data);
      setReviewDraft(null);
      setReviewDraftContent('');
      setSavedReviewDraftContent('');
      setFunctionRevisionInstruction('');
      setFunctionRevisionMessage(null);
      setSelectedReviewFunctionId(firstFunctionId);
      setReviewTestUrl(firstFunctionId ? defaultTestUrlForFunction(jobResponse.data, firstFunctionId) : jobResponse.data.normalizedUrl);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, []);

  const createEditableReviewDraft = useCallback(async () => {
    if (!reviewJob) return;
    setReviewLoading('edit');
    setReviewError(null);
    setReviewTestResult(null);
    try {
      const response = await api.createSelectorDiscoveryDraft(reviewJob.id);
      setReviewDraft(response.data);
      setReviewDraftContent(response.data.content);
      setSavedReviewDraftContent(response.data.content);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [reviewJob]);

  const saveEditableReviewDraft = useCallback(async () => {
    if (!reviewDraft) return;
    setReviewLoading('save');
    setReviewError(null);
    try {
      const response = await api.saveAdapterDraftContent(reviewDraft.draft.draftId, { content: reviewDraftContent });
      setReviewDraft(response.data);
      setReviewDraftContent(response.data.content);
      setSavedReviewDraftContent(response.data.content);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [reviewDraft, reviewDraftContent]);

  const resetEditableReviewDraft = useCallback(() => {
    const source = reviewImplementation?.content ?? '';
    setReviewDraftContent(source);
    setReviewTestResult(null);
  }, [reviewImplementation]);

  const requestFunctionRevision = useCallback(async () => {
    if (!reviewJob || !selectedReviewFunctionId) return;
    setReviewLoading('revision');
    setReviewError(null);
    setFunctionRevisionMessage(null);
    try {
      const response = await api.requestSelectorDiscoveryFunctionRevision(reviewJob.id, selectedReviewFunctionId, {
        functionId: selectedReviewFunctionId,
        instruction: functionRevisionInstruction,
        currentSource: reviewDraft ? reviewDraftContent : reviewImplementation?.content,
      });
      setReviewJob(response.data);
      setFunctionRevisionInstruction('');
      const latest = response.data.functionRevisionTasks?.at(-1);
      setFunctionRevisionMessage(latest
        ? `${text.agent.functionRevisionCreated}: ${latest.id}`
        : text.agent.functionRevisionCreated);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [functionRevisionInstruction, reviewJob, selectedReviewFunctionId, text.agent.functionRevisionCreated]);

  const retryFunctionRevision = useCallback(async (revisionTaskId: string) => {
    if (!reviewJob) return;
    setReviewLoading('revision');
    setReviewError(null);
    setFunctionRevisionMessage(null);
    try {
      const response = await api.retrySelectorDiscoveryFunctionRevision(reviewJob.id, revisionTaskId, {
        currentSource: reviewDraft ? reviewDraftContent : reviewImplementation?.content,
        modelMode: functionRevisionModelMode,
      });
      setReviewJob(response.data);
      setFunctionRevisionMessage(`${text.agent.functionRevisionRetryStarted}: ${revisionTaskId}`);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [functionRevisionModelMode, reviewDraft, reviewDraftContent, reviewImplementation, reviewJob, text.agent.functionRevisionRetryStarted]);

  const runReviewFunctionTest = useCallback(async () => {
    if (!reviewJob || !selectedReviewFunctionId || !reviewTestUrl.trim()) return;
    setReviewLoading('test');
    setReviewError(null);
    try {
      if (reviewDraft) {
        let draftId = reviewDraft.draft.draftId;
        if (reviewDraftContent !== savedReviewDraftContent) {
          const saved = await api.saveAdapterDraftContent(reviewDraft.draft.draftId, { content: reviewDraftContent });
          setReviewDraft(saved.data);
          setReviewDraftContent(saved.data.content);
          setSavedReviewDraftContent(saved.data.content);
          draftId = saved.data.draft.draftId;
        }
        const draftResponse = await api.testAdapterDraftFunction(draftId, selectedReviewFunctionId, {
          url: reviewTestUrl.trim(),
        });
        setReviewTestResult(draftResponse.data);
        return;
      }
      const response = await api.testSelectorDiscoveryFunction(reviewJob.id, selectedReviewFunctionId, {
        url: reviewTestUrl.trim(),
      });
      setReviewTestResult(response.data);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [reviewDraft, reviewDraftContent, reviewJob, savedReviewDraftContent, selectedReviewFunctionId, reviewTestUrl]);

  const approveReviewJob = useCallback(async () => {
    if (!reviewJob) return;
    setReviewLoading('approve');
    setReviewError(null);
    try {
      await api.promoteSelectorDiscovery(reviewJob.id);
      await Promise.all([fetchBuildJobs(), fetchAdapters(), fetchSiteAdapters()]);
      const refreshed = await api.getSelectorDiscovery(reviewJob.id);
      setReviewJob(refreshed.data);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [fetchAdapters, fetchBuildJobs, fetchSiteAdapters, reviewJob]);

  const rejectReviewJob = useCallback(async () => {
    if (!reviewJob) return;
    setReviewLoading('reject');
    setReviewError(null);
    try {
      const response = await api.rejectSelectorDiscovery(reviewJob.id);
      await fetchBuildJobs();
      setReviewJob(response.data);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [fetchBuildJobs, reviewJob]);

  useEffect(() => {
    void fetchBuildJobs();
  }, [fetchBuildJobs]);

  useEffect(() => {
    void fetchSiteAdapters();
  }, [fetchSiteAdapters]);

  useEffect(() => {
    if (siteAdapters.length === 0) {
      return;
    }
    if (!selectedSiteAdapterId || !siteAdapters.some((adapter) => adapter.id === selectedSiteAdapterId)) {
      setSelectedSiteAdapterId(siteAdapters[0]!.id);
    }
  }, [selectedSiteAdapterId, setSelectedSiteAdapterId, siteAdapters]);

  useEffect(() => {
    if (!buildJobs.some(isActiveBuildJob)) {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchBuildJobs();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [buildJobs, fetchBuildJobs]);

  useEffect(() => {
    if (!reviewJob?.functionRevisionTasks?.some((task) => task.status === 'queued' || task.status === 'running')) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const [jobResponse, implementationResponse] = await Promise.all([
          api.getSelectorDiscovery(reviewJob.id),
          api.getSelectorDiscoveryImplementation(reviewJob.id),
        ]);
        setReviewJob(jobResponse.data);
        setReviewImplementation(implementationResponse.data);
        if (!reviewDraft) {
          setReviewDraftContent('');
          setSavedReviewDraftContent('');
        }
      } catch {
        // Keep the current review panel visible; explicit actions will surface errors.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [reviewDraft, reviewJob]);

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
  const selectedSiteAdapter = useMemo(
    () => siteAdapters.find((adapter) => adapter.id === selectedSiteAdapterId) ?? null,
    [selectedSiteAdapterId, siteAdapters]
  );

  const runPendingAction = async () => {
    if (!pendingAction) return;

    if (pendingAction.type === 'promote') {
      await promoteCandidate(pendingAction.adapterId, pendingAction.version);
    } else if (pendingAction.type === 'reject') {
      await rejectCandidate(pendingAction.adapterId, pendingAction.version);
    } else if (pendingAction.type === 'deleteAdapter') {
      setDeleteAdapterLoading(true);
      try {
        await api.deleteAdapter(pendingAction.adapterId);
        await Promise.all([fetchSiteAdapters(), fetchAdapters()]);
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

      {pendingAction && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-amber-900">{formatActionTitle(text, pendingAction)}</h2>
              <p className="mt-1 text-sm text-amber-800">{formatActionDescription(text, pendingAction)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setPendingAction(null)}
                className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900"
              >
                {text.agent.pendingActions.cancel}
              </button>
              <button
                onClick={runPendingAction}
                disabled={actionLoading || deleteAdapterLoading}
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
                onClick={() => {
                  setReviewJob(null);
                  setReviewImplementation(null);
                  setReviewCapabilities(null);
                  setReviewDraft(null);
                  setReviewDraftContent('');
                  setSavedReviewDraftContent('');
                  setFunctionRevisionInstruction('');
                  setFunctionRevisionMessage(null);
                  setReviewTestResult(null);
                  setReviewError(null);
                }}
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
                    setPendingAction({ type: 'deleteAdapter', adapterId: selectedSiteAdapter.id, adapterName: selectedSiteAdapter.name })
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
