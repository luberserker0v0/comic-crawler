import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '../store';
import type { AgentVersionSummary } from '../store';
import { useWebSocket } from '../hooks';
import { useLocalStorage } from '../hooks';
import { formatText, useI18n } from '../text/i18n';

const badgeClassByStatus: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  candidate: 'bg-amber-100 text-amber-700',
  rolled_back: 'bg-rose-100 text-rose-700',
  rejected: 'bg-slate-100 text-slate-700',
  awaiting_review: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-rose-100 text-rose-700',
  in_progress: 'bg-blue-100 text-blue-700',
  running: 'bg-blue-100 text-blue-700',
};

type PendingAction =
  | { type: 'promote'; adapterId: string; version: string }
  | { type: 'reject'; adapterId: string; version: string }
  | { type: 'rollback'; adapterId: string; version?: string };

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
  return text.agent.pendingActions.rollbackTitle;
}

function formatActionDescription(text: ReturnType<typeof useI18n>['text'], action: PendingAction): string {
  if (action.type === 'promote') {
    return formatText(text.agent.pendingActions.promoteDescription, action);
  }

  if (action.type === 'reject') {
    return formatText(text.agent.pendingActions.rejectDescription, action);
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

export const AgentPage: React.FC = () => {
  const {
    adapters,
    selectedAdapterId,
    selectedAdapter,
    loading,
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

  const runPendingAction = async () => {
    if (!pendingAction) return;

    if (pendingAction.type === 'promote') {
      await promoteCandidate(pendingAction.adapterId, pendingAction.version);
    } else if (pendingAction.type === 'reject') {
      await rejectCandidate(pendingAction.adapterId, pendingAction.version);
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
                disabled={actionLoading}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading ? text.agent.pendingActions.working : text.agent.pendingActions.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.05fr_1.95fr]">
        <section className="overflow-hidden rounded-2xl bg-white shadow">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">{text.agent.adapters}</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {adapters.map((adapter) => (
              <button
                key={adapter.adapterId}
                onClick={() => selectAdapter(adapter.adapterId)}
                className={`flex w-full flex-col gap-3 px-6 py-4 text-left transition hover:bg-slate-50 ${
                  selectedAdapterId === adapter.adapterId ? 'bg-slate-50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-900">{adapter.adapterId}</div>
                  <StatusBadge text={text} value={adapter.sessionStatus} />
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs text-slate-500">
                  <div>
                    <div>{text.agent.activeVersion}</div>
                    <div className="mt-1 truncate font-medium text-slate-700">{adapter.activeVersion ?? '-'}</div>
                  </div>
                  <div>
                    <div>{text.agent.candidate}</div>
                    <div className="mt-1 truncate font-medium text-slate-700">{adapter.latestCandidate ?? '-'}</div>
                  </div>
                  <div>
                    <div>{text.agent.versionCount}</div>
                    <div className="mt-1 font-medium text-slate-700">{adapter.versionCount}</div>
                  </div>
                </div>
              </button>
            ))}
            {adapters.length === 0 && !loading && (
              <div className="px-6 py-10 text-center text-sm text-slate-500">{text.agent.noAdapters}</div>
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{selectedAdapter?.adapterId ?? text.agent.adapters}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedAdapter?.session?.triggerKey ?? text.agent.selectAdapter}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
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
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.session}</div>
                <div className="mt-2"><StatusBadge text={text} value={selectedAdapter?.session?.status} /></div>
                <div className="mt-3 text-sm text-slate-600">
                  {formatText(text.agent.attemptSummary, {
                    current: selectedAdapter?.session?.currentAttempt ?? 0,
                    max: selectedAdapter?.session?.maxAttempts ?? 0,
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.activeVersion}</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{activeVersion ?? '-'}</div>
                <div className="mt-3 text-sm text-slate-600">
                  {text.agent.source}: {selectedAdapter?.activeVersion?.basedOnVersion ?? text.agent.runtimeBaseline}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.candidate}</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{candidateVersion ?? '-'}</div>
                <div className="mt-3 text-sm text-slate-600">{text.agent.repairMode}: {selectedAdapter?.latestCandidate?.repairMode ?? '-'}</div>
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
    </div>
  );
};
