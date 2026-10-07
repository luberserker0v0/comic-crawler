import { useI18n } from '../../../text/i18n';
import type { AdapterListItem } from '@comiccrawler/shared';
import type { AgentAdapterDetail, AgentVersionSummary } from '../../../store';
import { StatusBadge, VersionDetails, formatCapabilityValue, formatCooldown, formatImplementationKind, type PendingAction } from '../widgets';

export function SiteAdaptersSection(props: {
  siteAdapters: AdapterListItem[];
  siteAdaptersLoading: boolean;
  siteAdaptersError: string | null;
  selectedSiteAdapterId: string | null;
  setSelectedSiteAdapterId: (value: string | null) => void;
  selectAdapter: (adapterId: string) => void;
  selectedSiteAdapter: AdapterListItem | null;
  selectedAdapter: AgentAdapterDetail | null;
  candidateVersion: string | undefined;
  activeVersion: string | undefined;
  actionLoading: boolean;
  deleteAdapterLoading: boolean;
  setPendingAction: (value: PendingAction | null) => void;
  selectedVersionId: string | null;
  setSelectedVersionId: (value: string | null) => void;
  selectedVersion: AgentVersionSummary | null;
}) {
  const { text } = useI18n();
  const {
    siteAdapters,
    siteAdaptersLoading,
    siteAdaptersError,
    selectedSiteAdapterId,
    setSelectedSiteAdapterId,
    selectAdapter,
    selectedSiteAdapter,
    selectedAdapter,
    candidateVersion,
    activeVersion,
    actionLoading,
    deleteAdapterLoading,
    setPendingAction,
    selectedVersionId,
    setSelectedVersionId,
    selectedVersion,
  } = props;

  return (
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
  );
}
