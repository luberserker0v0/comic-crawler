import type { AdapterListItem } from '@comiccrawler/shared';
import type { AgentAdapterDetail, AgentVersionSummary } from '../../../store';
import { useI18n } from '../../../text/i18n';
import {
  StatusBadge, VersionDetails, formatCapabilityValue, formatCooldown,
  formatImplementationKind, type PendingAction,
} from '../widgets';

interface SiteAdaptersSectionProps {
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
}

export function SiteAdaptersSection(props: SiteAdaptersSectionProps) {
  return <div className="grid gap-6 lg:grid-cols-[1.05fr_1.95fr]">
    <AdapterList {...props} />
    <section className="space-y-6">
      <AdapterOverview {...props} />
      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <VersionHistory {...props} />
        <RepairContext adapter={props.selectedAdapter} />
      </div>
    </section>
  </div>;
}

function AdapterList(props: SiteAdaptersSectionProps) {
  const { text } = useI18n();
  return <section className="overflow-hidden rounded-2xl bg-white shadow">
    <div className="border-b border-slate-200 px-6 py-4"><h2 className="text-lg font-semibold text-slate-900">{text.agent.adapters}</h2></div>
    <div className="divide-y divide-slate-100">
      {props.siteAdapters.map((adapter) => <AdapterListItemView key={adapter.id} {...props} adapter={adapter} />)}
      {props.siteAdapters.length === 0 && !props.siteAdaptersLoading &&
        <div className="px-6 py-10 text-center text-sm text-slate-500">{text.agent.noAdapters}</div>}
    </div>
    {props.siteAdaptersError && <div className="border-t border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">{props.siteAdaptersError}</div>}
  </section>;
}

function AdapterListItemView(props: SiteAdaptersSectionProps & { adapter: AdapterListItem }) {
  const { text } = useI18n();
  const selected = props.selectedSiteAdapterId === props.adapter.id;
  return <button onClick={() => selectAdapter(props)}
    className={`flex w-full flex-col gap-3 px-6 py-4 text-left transition hover:bg-slate-50 ${selected ? 'bg-slate-50' : ''}`}>
    <div className="flex items-center justify-between">
      <div className="text-sm font-semibold text-slate-900">{props.adapter.id}</div>
      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{props.adapter.parseMode}</span>
    </div>
    <div className="grid grid-cols-3 gap-3 text-xs text-slate-500">
      <ListMetric label={text.agent.activeVersion} value={props.adapter.activeVersionLabel} />
      <ListMetric label={text.agent.capabilities} value={`M ${formatCapabilityValue(props.adapter.capabilities.metadata)} / I ${formatCapabilityValue(props.adapter.capabilities.chapterImages)}`} />
      <ListMetric label={text.agent.versionCount} value={String(props.adapter.versionCount)} />
    </div>
  </button>;
}

function selectAdapter(props: SiteAdaptersSectionProps & { adapter: AdapterListItem }) {
  props.setSelectedSiteAdapterId(props.adapter.id);
  void props.selectAdapter(props.adapter.id);
}

function ListMetric({ label, value }: { label: string; value: string }) {
  return <div><div>{label}</div><div className="mt-1 truncate font-medium text-slate-700">{value}</div></div>;
}

function AdapterOverview(props: SiteAdaptersSectionProps) {
  return <div className="rounded-2xl bg-white p-6 shadow">
    <OverviewHeader {...props} />
    <div className="mt-6 grid gap-4 md:grid-cols-3">
      <CapabilitiesCard adapter={props.selectedSiteAdapter} />
      <VersionCard adapter={props.selectedSiteAdapter} />
      <ImplementationCard adapter={props.selectedSiteAdapter} />
    </div>
  </div>;
}

function OverviewHeader(props: SiteAdaptersSectionProps) {
  const { text } = useI18n();
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <h2 className="text-xl font-semibold text-slate-900">{props.selectedSiteAdapter?.name ?? props.selectedSiteAdapter?.id ?? text.agent.adapters}</h2>
      <p className="mt-1 text-sm text-slate-500">{props.selectedSiteAdapter?.domains.join(', ') ?? text.agent.selectAdapter}</p>
    </div>
    <AdapterActions {...props} />
  </div>;
}

function AdapterActions(props: SiteAdaptersSectionProps) {
  return <div className="flex flex-wrap gap-2">
    <DeleteAdapterButton {...props} />
    <VersionActionButton {...props} type="promote" />
    <VersionActionButton {...props} type="reject" />
    <RollbackButton {...props} />
  </div>;
}

function DeleteAdapterButton(props: SiteAdaptersSectionProps) {
  const { text } = useI18n();
  return <button onClick={() => requestDelete(props)} disabled={!props.selectedSiteAdapter || props.actionLoading || props.deleteAdapterLoading}
    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
    {text.agent.deleteAdapter}
  </button>;
}

function requestDelete(props: SiteAdaptersSectionProps) {
  const item = props.selectedSiteAdapter;
  if (!item) return;
  props.setPendingAction({
    type: 'deleteAdapter', adapterId: item.id, adapterName: item.name,
    implementationKind: item.implementationKind, sourcePath: item.sourcePath,
    sourceWillBeDeleted: item.sourceWillBeDeleted,
  });
}

function VersionActionButton(props: SiteAdaptersSectionProps & { type: 'promote' | 'reject' }) {
  const { text } = useI18n();
  const label = props.type === 'promote' ? text.agent.promoteCandidate : text.agent.rejectCandidate;
  const color = props.type === 'promote' ? 'bg-emerald-600' : 'bg-amber-500';
  return <button onClick={() => requestVersionAction(props)}
    disabled={!props.selectedAdapter || !props.candidateVersion || props.actionLoading}
    className={`rounded-lg ${color} px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50`}>
    {label}
  </button>;
}

function requestVersionAction(props: SiteAdaptersSectionProps & { type: 'promote' | 'reject' }) {
  if (!props.selectedAdapter || !props.candidateVersion) return;
  props.setPendingAction({
    type: props.type, adapterId: props.selectedAdapter.adapterId, version: props.candidateVersion,
  });
}

function RollbackButton(props: SiteAdaptersSectionProps) {
  const { text } = useI18n();
  return <button onClick={() => requestRollback(props)} disabled={!props.selectedAdapter || !props.activeVersion || props.actionLoading}
    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
    {text.agent.rollbackActive}
  </button>;
}

function requestRollback(props: SiteAdaptersSectionProps) {
  if (props.selectedAdapter) props.setPendingAction({ type: 'rollback', adapterId: props.selectedAdapter.adapterId });
}

function CapabilitiesCard({ adapter }: { adapter: AdapterListItem | null }) {
  const { text } = useI18n();
  return <OverviewCard title={text.agent.capabilities}>
    <div className="mt-2 grid gap-1 text-sm font-medium text-slate-900">
      <div>{text.agent.capabilityVerification}: {formatCapabilityValue(Boolean(adapter?.capabilities.verification))}</div>
      <div>{text.agent.capabilityMetadata}: {formatCapabilityValue(Boolean(adapter?.capabilities.metadata))}</div>
      <div>{text.agent.capabilityChapterImages}: {formatCapabilityValue(Boolean(adapter?.capabilities.chapterImages))}</div>
    </div>
  </OverviewCard>;
}

function VersionCard({ adapter }: { adapter: AdapterListItem | null }) {
  const { text } = useI18n();
  return <OverviewCard title={text.agent.activeVersion}>
    <div className="mt-2 text-sm font-semibold text-slate-900">{adapter?.activeVersionLabel ?? 'current'}</div>
    <div className="mt-3 text-sm text-slate-600">{text.agent.versionCount}: {adapter?.versionCount ?? 1}</div>
  </OverviewCard>;
}

function ImplementationCard({ adapter }: { adapter: AdapterListItem | null }) {
  const { text } = useI18n();
  return <OverviewCard title={text.agent.implementationKind}>
    <div className="mt-2 text-sm font-semibold text-slate-900">{formatImplementationKind(text, adapter?.implementationKind)}</div>
    <div className="mt-3 text-sm text-slate-600">{text.agent.parseMode}: {adapter?.parseMode ?? '-'}</div>
    {adapter?.sourcePath && <div className="mt-3 break-all text-xs text-slate-500">{text.agent.sourcePath}: <span className="font-mono">{adapter.sourcePath}</span></div>}
    {adapter?.sourceWillBeDeleted && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{text.agent.sourceWillBeDeleted}</div>}
  </OverviewCard>;
}

function OverviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 p-4">
    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{title}</div>{children}
  </div>;
}

function VersionHistory(props: SiteAdaptersSectionProps) {
  const { text } = useI18n();
  const versions = props.selectedAdapter?.versions?.versions ?? [];
  return <div className="space-y-6">
    <div className="rounded-2xl bg-white p-6 shadow">
      <h3 className="text-lg font-semibold text-slate-900">{text.agent.versionHistory}</h3>
      <div className="mt-4 space-y-3">
        {versions.map((version) => <VersionItem key={version.version} {...props} version={version} />)}
        {versions.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{text.agent.noVersionHistory}</div>}
      </div>
    </div>
    <VersionDetails text={text} version={props.selectedVersion} />
  </div>;
}

function VersionItem(props: SiteAdaptersSectionProps & { version: AgentVersionSummary }) {
  const { text } = useI18n();
  const { version } = props;
  const selected = props.selectedVersionId === version.version;
  const style = selected ? 'border-slate-900 bg-slate-50 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50';
  return <button onClick={() => props.setSelectedVersionId(version.version)} className={`w-full rounded-xl border p-4 text-left transition ${style}`}>
    <div className="flex items-start justify-between gap-3"><div>
      <div className="text-sm font-semibold text-slate-900">{version.version}</div>
      <div className="mt-1 text-xs text-slate-500">{text.agent.fixturesPassed}: {version.testResults?.passed ?? 0} | {text.agent.fixturesFailed}: {version.testResults?.failed ?? 0}</div>
    </div><StatusBadge text={text} value={version.status} /></div>
    <FixtureBadges version={version} />
  </button>;
}

function FixtureBadges({ version }: { version: AgentVersionSummary }) {
  const { text } = useI18n();
  const fixtures = version.validation?.fixtureResults;
  return <div className="mt-3 flex flex-wrap gap-2">
    {fixtures?.map((fixture) => <span key={`${version.version}-${fixture.fixtureName}`}
      className={`rounded-full px-2 py-1 text-xs font-medium ${fixture.valid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
      {fixture.fixtureName}
    </span>) ?? <span className="text-xs text-slate-400">{text.agent.noFixtureDetails}</span>}
  </div>;
}

function RepairContext({ adapter }: { adapter: AgentAdapterDetail | null }) {
  const { text } = useI18n();
  const session = adapter?.session;
  return <div className="rounded-2xl bg-white p-6 shadow">
    <h3 className="text-lg font-semibold text-slate-900">{text.agent.repairContext}</h3>
    <dl className="mt-4 space-y-4 text-sm">
      <Detail label={text.agent.sessionId} value={session?.sessionId} />
      <Detail label={text.agent.pageType} value={session?.pageType} />
      <Detail label={text.agent.triggerKey} value={session?.triggerKey} breakAll />
      <Detail label={text.agent.lastFailure} value={session?.lastFailure?.reason} />
      <Detail label={text.agent.currentCandidate} value={session?.candidateVersion} />
      <Detail label={text.agent.sourceVersion} value={session?.sourceVersion} />
    </dl>
    <TriggerProgress adapter={adapter} />
  </div>;
}

function Detail({ label, value, breakAll = false }: { label: string; value?: string; breakAll?: boolean }) {
  return <div><dt className="text-slate-400">{label}</dt>
    <dd className={`mt-1 font-medium text-slate-900 ${breakAll ? 'break-all' : ''}`}>{value ?? '-'}</dd></div>;
}

function TriggerProgress({ adapter }: { adapter: AgentAdapterDetail | null }) {
  const { text } = useI18n();
  return <div className="mt-8 border-t border-slate-200 pt-6">
    <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">{text.agent.autoTrigger}</h4>
    {adapter?.triggerProgress ? <TriggerProgressDetails progress={adapter.triggerProgress} /> :
      <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">{text.agent.noTriggerProgress}</div>}
  </div>;
}

function TriggerProgressDetails({ progress }: { progress: NonNullable<AgentAdapterDetail['triggerProgress']> }) {
  const { text } = useI18n();
  const cooldown = progress.inCooldown ? formatCooldown(progress.cooldownRemainingMs) : text.agent.cooldownReady;
  return <div className="mt-4 space-y-4 text-sm">
    <div className="grid gap-4 md:grid-cols-2">
      <ProgressMetric label={text.agent.failedProgress} value={`${progress.count} / ${progress.threshold}`} />
      <ProgressMetric label={text.agent.remainingFailures} value={String(progress.remainingFailures)} />
    </div>
    <dl className="space-y-3">
      <Detail label={text.agent.triggerKey} value={progress.triggerKey} breakAll />
      <Detail label={text.agent.lastFailure} value={progress.lastMessage} />
      <Detail label={text.agent.cooldown} value={cooldown} />
    </dl>
  </div>;
}

function ProgressMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 p-4">
    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{label}</div>
    <div className="mt-2 text-lg font-semibold text-slate-900">{value}</div>
  </div>;
}
