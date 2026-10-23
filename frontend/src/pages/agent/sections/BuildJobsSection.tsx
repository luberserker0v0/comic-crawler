import { useState } from 'react';
import type { SelectorDiscoveryJobSummary } from '@comiccrawler/shared';
import { useI18n } from '../../../text/i18n';
import {
  StatusBadge, canRetryBuildJob, canReviewBuildJob, formatBuildJobMode,
  formatBuildJobTarget, formatDateTime, groupBuildJobsIntoThreads, type BuildJobThread,
} from '../widgets';

type ReviewLoading = 'load' | 'test' | 'approve' | 'reject' | 'edit' | 'save' | 'revision' | null;
type SetKeys = (next: Set<string>) => void;

interface BuildJobsSectionProps {
  buildJobs: SelectorDiscoveryJobSummary[];
  buildJobsLoading: boolean;
  buildJobsError: string | null;
  reviewError: string | null;
  retryingBuildJobId: string | null;
  deletingBuildJobId: string | null;
  reviewLoading: ReviewLoading;
  fetchBuildJobs: () => Promise<void>;
  retryBuildJob: (id: string) => Promise<void>;
  deleteBuildJob: (id: string) => Promise<void>;
  openReviewJob: (id: string) => Promise<void>;
}

interface ThreadCardProps extends Pick<BuildJobsSectionProps,
  'retryingBuildJobId' | 'deletingBuildJobId' | 'reviewLoading' | 'retryBuildJob' |
  'deleteBuildJob' | 'openReviewJob'> {
  thread: BuildJobThread;
  collapsed: boolean;
  expandedAttempts: Set<string>;
  onToggleThread: () => void;
  onToggleAttempt: (id: string) => void;
}

type AttemptProps = Pick<BuildJobsSectionProps,
  'retryingBuildJobId' | 'deletingBuildJobId' | 'reviewLoading' | 'retryBuildJob' |
  'deleteBuildJob' | 'openReviewJob'> & {
    job: SelectorDiscoveryJobSummary;
  };

export function BuildJobsSection(props: BuildJobsSectionProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggles = createToggles(collapsed, setCollapsed, expanded, setExpanded);
  const threads = groupBuildJobsIntoThreads(props.buildJobs);
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow">
      <BuildJobsHeader {...props} />
      <BuildJobsErrors {...props} />
      <BuildJobThreads {...props} threads={threads} collapsed={collapsed} expanded={expanded} {...toggles} />
    </section>
  );
}

function createToggles(collapsed: Set<string>, setCollapsed: SetKeys, expanded: Set<string>, setExpanded: SetKeys) {
  return {
    onToggleThread: (key: string) => toggleKey(collapsed, setCollapsed, key),
    onToggleAttempt: (key: string) => toggleKey(expanded, setExpanded, key),
  };
}

function toggleKey(keys: Set<string>, setKeys: SetKeys, key: string) {
  const next = new Set(keys);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  setKeys(next);
}

function BuildJobsHeader(props: BuildJobsSectionProps) {
  const { text } = useI18n();
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{text.agent.buildJobs}</h2>
        <p className="mt-1 text-sm text-slate-500">{text.agent.buildJobsDescription}</p>
        <p className="mt-1 text-xs text-slate-400">{text.agent.buildJobTaskBoundary}</p>
      </div>
      <button type="button" onClick={() => void props.fetchBuildJobs()} disabled={props.buildJobsLoading}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
        {props.buildJobsLoading ? `${text.agent.refresh}...` : text.agent.refresh}
      </button>
    </div>
  );
}

function BuildJobsErrors(props: BuildJobsSectionProps) {
  return <>
    {props.buildJobsError && <ErrorBanner message={props.buildJobsError} />}
    {props.reviewError && <ErrorBanner message={props.reviewError} />}
  </>;
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="border-b border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">{message}</div>;
}

function BuildJobThreads(props: BuildJobsSectionProps & {
  threads: BuildJobThread[]; collapsed: Set<string>; expanded: Set<string>;
  onToggleThread: (key: string) => void; onToggleAttempt: (key: string) => void;
}) {
  const { text } = useI18n();
  return <div className="divide-y divide-slate-100">
    {props.threads.map((thread) => <BuildJobThreadCard key={thread.key} thread={thread}
      collapsed={props.collapsed.has(thread.key)} expandedAttempts={props.expanded}
      onToggleThread={() => props.onToggleThread(thread.key)} onToggleAttempt={props.onToggleAttempt}
      retryingBuildJobId={props.retryingBuildJobId} reviewLoading={props.reviewLoading}
      deletingBuildJobId={props.deletingBuildJobId} retryBuildJob={props.retryBuildJob}
      deleteBuildJob={props.deleteBuildJob} openReviewJob={props.openReviewJob} />)}
    {props.threads.length === 0 && !props.buildJobsLoading &&
      <div className="px-6 py-10 text-center text-sm text-slate-500">{text.agent.noBuildJobs}</div>}
  </div>;
}

function BuildJobThreadCard(props: ThreadCardProps) {
  const [latest, ...olderAttempts] = props.thread.attempts;
  return (
    <div className="px-6 py-4">
      <ThreadSummary {...props} />
      {!props.collapsed && <div className="mt-2">
        <ThreadMetadata thread={props.thread} />
        {latest && <div className="mt-3 rounded-xl border border-slate-200"><BuildJobAttemptDetails {...props} job={latest} /></div>}
        <OlderAttempts {...props} jobs={olderAttempts} />
      </div>}
    </div>
  );
}

function ThreadSummary(props: ThreadCardProps) {
  const { text } = useI18n();
  const { thread } = props;
  return <button type="button" onClick={props.onToggleThread} className="flex w-full flex-wrap items-center gap-2 text-left">
    <span className="inline-block w-4 text-xs text-slate-400">{props.collapsed ? '▶' : '▼'}</span>
    <span className="font-mono text-sm font-semibold text-slate-900">{thread.hostname}</span>
    <StatusBadge text={text} value={thread.latest.status} />
    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
      {thread.attempts.length} {text.agent.buildJobAttempts}
    </span>
    {thread.latest.phase && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{thread.latest.phase}</span>}
    <span className="text-xs text-slate-500">{formatDateTime(thread.latest.updatedAt)}</span>
  </button>;
}

function ThreadMetadata({ thread }: { thread: BuildJobThread }) {
  const { text } = useI18n();
  return <>
    <div className="break-all text-sm text-slate-700">{thread.normalizedUrl}</div>
    <div className="mt-1 text-xs text-slate-500">
      {thread.latest.target ? formatBuildJobTarget(text, thread.latest) : '-'} {' · '}
      {thread.latest.promotionMode ? formatBuildJobMode(text, thread.latest) : '-'}
    </div>
  </>;
}

function OlderAttempts(props: ThreadCardProps & { jobs: SelectorDiscoveryJobSummary[] }) {
  if (props.jobs.length === 0) return null;
  return <div className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3">
    {props.jobs.map((job) => <OlderAttempt key={job.id} {...props} job={job} />)}
  </div>;
}

function OlderAttempt(props: ThreadCardProps & { job: SelectorDiscoveryJobSummary }) {
  const { text } = useI18n();
  const expanded = props.expandedAttempts.has(props.job.id);
  return <div className="rounded-lg bg-slate-50">
    <button type="button" onClick={() => props.onToggleAttempt(props.job.id)}
      className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left" title={text.agent.buildJobAttemptDetails}>
      <span className="inline-block w-4 shrink-0 text-xs text-slate-400">{expanded ? '▼' : '▶'}</span>
      <StatusBadge text={text} value={props.job.status} />
      <span className="truncate font-mono text-xs text-slate-600">{props.job.id}</span>
      <span className="shrink-0 text-xs text-slate-500">{formatDateTime(props.job.updatedAt)}</span>
    </button>
    {expanded && <div className="border-t border-slate-200"><BuildJobAttemptDetails {...props} /></div>}
  </div>;
}

function BuildJobAttemptDetails(props: AttemptProps) {
  return <div className="px-3 py-3">
    <AttemptHeader job={props.job} />
    <div className="mt-2 break-all text-sm text-slate-700">{props.job.normalizedUrl ?? props.job.url}</div>
    <div className="mt-1 text-xs text-slate-500">{props.job.hostname}</div>
    <AttemptMetadata job={props.job} />
    <AttemptDiagnostics job={props.job} />
    <AttemptActions {...props} />
  </div>;
}

function AttemptHeader({ job }: { job: SelectorDiscoveryJobSummary }) {
  const { text } = useI18n();
  return <div className="flex flex-wrap items-center gap-2">
    <span className="font-mono text-sm font-semibold text-slate-900">{job.id}</span>
    <StatusBadge text={text} value={job.status} />
    {job.phase && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{job.phase}</span>}
    {job.retriedFromId && <span className="truncate font-mono text-xs text-slate-400" title={job.retriedFromId}>↳ {job.retriedFromId}</span>}
  </div>;
}

function AttemptMetadata({ job }: { job: SelectorDiscoveryJobSummary }) {
  const { text } = useI18n();
  const rows = [
    [text.agent.buildJobTarget, job.target ? formatBuildJobTarget(text, job) : '-'],
    [text.agent.buildJobMode, job.promotionMode ? formatBuildJobMode(text, job) : '-'],
    [text.agent.buildJobAdapter, job.adapterName ?? job.adapterId ?? job.baseAdapterId ?? '-'],
    [text.agent.buildJobUpdated, formatDateTime(job.updatedAt)],
    [text.agent.buildJobModel, job.model ?? '-'], [text.agent.buildJobAoUrl, job.aoBaseUrl ?? '-'],
  ];
  return <div className="mt-2 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
    {rows.map(([label, value]) => <MetadataItem key={label} label={label} value={value} />)}
  </div>;
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
    <div className="mt-1 break-all font-medium text-slate-800">{value}</div></div>;
}

function AttemptDiagnostics({ job }: { job: SelectorDiscoveryJobSummary }) {
  const { text } = useI18n();
  return <>
    {job.error && <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
      <span className="font-medium">{text.agent.buildJobError}: </span>{String(job.error)}
    </div>}
    {Boolean(job.implementationValidation) && <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <span className="font-medium">{text.agent.implementationValidation}: </span>
      <span className="font-mono">{JSON.stringify(job.implementationValidation)}</span>
    </div>}
  </>;
}

function AttemptActions(props: AttemptProps) {
  return <div className="mt-3 flex flex-wrap gap-2">
    {canRetryBuildJob(props.job) && <RetryButton {...props} />}
    {canReviewBuildJob(props.job) && <ReviewButton {...props} />}
    {!['queued', 'running'].includes(props.job.status) && <DeleteBuildJobButton {...props} />}
  </div>;
}

function RetryButton(props: AttemptProps) {
  const { text } = useI18n();
  const loading = props.retryingBuildJobId === props.job.id;
  return <button type="button" onClick={() => void props.retryBuildJob(props.job.id)} disabled={loading}
    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
    {loading ? `${text.agent.retryBuild}...` : text.agent.retryBuild}
  </button>;
}

function ReviewButton(props: AttemptProps) {
  const { text } = useI18n();
  return <button type="button" onClick={() => void props.openReviewJob(props.job.id)} disabled={props.reviewLoading === 'load'}
    className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
    {props.reviewLoading === 'load' ? `${text.agent.reviewAdapterDraft}...` : text.agent.reviewAdapterDraft}
  </button>;
}

function DeleteBuildJobButton(props: AttemptProps) {
  const { text } = useI18n();
  const promoted = props.job.status === 'promoted';
  const label = promoted ? text.agent.clearBuildJobRecord : text.agent.deleteBuildJob;
  const confirmation = promoted ? text.agent.clearBuildJobRecordConfirm : text.agent.deleteBuildJobConfirm;
  const loading = props.deletingBuildJobId === props.job.id;
  const remove = () => window.confirm(confirmation) && void props.deleteBuildJob(props.job.id);
  return <button type="button" onClick={remove} disabled={loading}
    className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">
    {loading ? `${label}...` : label}
  </button>;
}
