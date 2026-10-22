import type {
  AdapterCapabilityDetailResponse, AdapterDraftDetailResponse, AdapterFunctionTestResponse,
  AdapterImplementationResponse, SelectorDiscoveryJobSummary,
} from '@comiccrawler/shared';
import { ImplementationEditor } from '../../../components/ImplementationEditor';
import { useI18n } from '../../../text/i18n';
import { defaultTestUrlForFunction, formatBuildJobMode, formatBuildJobTarget, formatDateTime, formatJson } from '../widgets';

type ReviewLoading = 'load' | 'test' | 'approve' | 'reject' | 'edit' | 'save' | 'revision' | null;
type RevisionMode = 'current-settings' | 'previous-task';
type RevisionTask = NonNullable<SelectorDiscoveryJobSummary['functionRevisionTasks']>[number];

interface ReviewPanelProps {
  reviewJob: SelectorDiscoveryJobSummary;
  reviewImplementation: AdapterImplementationResponse | null;
  reviewCapabilities: AdapterCapabilityDetailResponse | null;
  reviewDraft: AdapterDraftDetailResponse | null;
  reviewDraftContent: string;
  setReviewDraftContent: (value: string) => void;
  savedReviewDraftContent: string;
  selectedReviewFunctionId: string;
  setSelectedReviewFunctionId: (value: string) => void;
  reviewTestUrl: string;
  setReviewTestUrl: (value: string) => void;
  reviewTestResult: AdapterFunctionTestResponse | null;
  setReviewTestResult: (value: AdapterFunctionTestResponse | null) => void;
  functionRevisionInstruction: string;
  setFunctionRevisionInstruction: (value: string) => void;
  functionRevisionModelMode: RevisionMode;
  setFunctionRevisionModelMode: (value: RevisionMode) => void;
  functionRevisionMessage: string | null;
  reviewError: string | null;
  reviewLoading: ReviewLoading;
  createEditableReviewDraft: () => void;
  saveEditableReviewDraft: () => void;
  resetEditableReviewDraft: () => void;
  requestFunctionRevision: () => void;
  retryFunctionRevision: (revisionTaskId: string) => void;
  runReviewFunctionTest: () => void;
  approveReviewJob: () => void;
  rejectReviewJob: () => void;
  closeReview: () => void;
}

export function ReviewPanel(props: ReviewPanelProps) {
  return <section id="review-panel" className="overflow-hidden rounded-2xl bg-white shadow">
    <ReviewHeader {...props} />
    {props.reviewError && <div className="border-b border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">{props.reviewError}</div>}
    <div className="grid gap-6 p-6 xl:grid-cols-[0.85fr_1.15fr]">
      <ReviewDetails {...props} />
      <SourcePanel {...props} />
    </div>
  </section>;
}

function ReviewHeader(props: ReviewPanelProps) {
  const { text } = useI18n();
  const title = props.reviewCapabilities?.adapter.name ?? props.reviewJob.adapterName ?? props.reviewJob.id;
  return <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 lg:flex-row lg:items-start lg:justify-between">
    <div>
      <p className="text-sm font-medium uppercase tracking-[0.25em] text-indigo-500">{text.agent.reviewPanelEyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 break-all text-sm text-slate-500">{props.reviewJob.normalizedUrl}</p>
    </div>
    <ReviewActions {...props} />
  </div>;
}

function ReviewActions(props: ReviewPanelProps) {
  return <div className="flex flex-wrap gap-2">
    <DraftActions {...props} />
    <ApproveButton {...props} />
    <RejectButton {...props} />
    <CloseButton {...props} />
  </div>;
}

function DraftActions(props: ReviewPanelProps) {
  const { text } = useI18n();
  if (!props.reviewDraft) return <button type="button" onClick={() => void props.createEditableReviewDraft()}
    disabled={props.reviewLoading !== null || !props.reviewJob.adapterImplementationTs}
    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
    {props.reviewLoading === 'edit' ? `${text.agent.editDraftCopy}...` : text.agent.editDraftCopy}
  </button>;
  return <>
    <button type="button" onClick={() => void props.saveEditableReviewDraft()}
      disabled={props.reviewLoading !== null || props.reviewDraftContent === props.savedReviewDraftContent}
      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
      {props.reviewLoading === 'save' ? `${text.agent.saveDraftCopy}...` : text.agent.saveDraftCopy}
    </button>
    <ResetDraftButton {...props} />
  </>;
}

function ResetDraftButton(props: ReviewPanelProps) {
  const { text } = useI18n();
  const original = props.reviewImplementation?.content ?? '';
  return <button type="button" onClick={props.resetEditableReviewDraft}
    disabled={props.reviewLoading !== null || props.reviewDraftContent === original}
    className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50">
    {text.agent.resetDraftCopy}
  </button>;
}

function ApproveButton(props: ReviewPanelProps) {
  const { text } = useI18n();
  const invalid = (props.reviewJob.implementationValidation as { valid?: boolean } | undefined)?.valid === false;
  const disabled = props.reviewLoading !== null || Boolean(props.reviewDraft) || props.reviewJob.status !== 'awaiting_review' || invalid;
  return <button type="button" onClick={() => void props.approveReviewJob()} disabled={disabled}
    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
    {props.reviewLoading === 'approve' ? `${text.agent.approveAdapter}...` : text.agent.approveAdapter}
  </button>;
}

function RejectButton(props: ReviewPanelProps) {
  const { text } = useI18n();
  return <button type="button" onClick={() => void props.rejectReviewJob()}
    disabled={props.reviewLoading !== null || props.reviewJob.status !== 'awaiting_review'}
    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
    {props.reviewLoading === 'reject' ? `${text.agent.rejectDraft}...` : text.agent.rejectDraft}
  </button>;
}

function CloseButton(props: ReviewPanelProps) {
  const { text } = useI18n();
  return <button type="button" onClick={props.closeReview}
    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
    {text.agent.closeReview}
  </button>;
}

function ReviewDetails(props: ReviewPanelProps) {
  return <div className="space-y-4">
    <JobSummary job={props.reviewJob} />
    <FunctionsCard {...props} />
    <FunctionTestCard {...props} />
    <FunctionRevisionCard {...props} />
    <ReviewNotes job={props.reviewJob} />
    <ValidationDetails job={props.reviewJob} />
  </div>;
}

function JobSummary({ job }: { job: SelectorDiscoveryJobSummary }) {
  const { text } = useI18n();
  const entries = [
    [text.agent.jobId, job.id], [text.agent.buildJobTarget, formatBuildJobTarget(text, job)],
    [text.agent.buildJobMode, formatBuildJobMode(text, job)], [text.agent.buildJobUpdated, formatDateTime(job.updatedAt)],
  ];
  return <ReviewCard title={text.agent.reviewJobSummary}>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      {entries.map(([label, value]) => <SummaryItem key={label} label={label} value={value} />)}
    </dl>
  </ReviewCard>;
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-400">{label}</dt><dd className="mt-1 break-all font-medium text-slate-900">{value}</dd></div>;
}

function FunctionsCard(props: ReviewPanelProps) {
  const { text } = useI18n();
  return <ReviewCard title={text.agent.capabilitiesAndFunctions}>
    <div className="mt-3 grid gap-2 text-sm">
      {props.reviewCapabilities?.functions.map((fn) => <FunctionOption key={fn.id} {...props} fn={fn} />) ??
        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">{text.agent.loadingReview}</div>}
    </div>
  </ReviewCard>;
}

function FunctionOption(props: ReviewPanelProps & { fn: AdapterCapabilityDetailResponse['functions'][number] }) {
  const { text } = useI18n();
  const selected = props.selectedReviewFunctionId === props.fn.id;
  const style = `${selected ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'} ${props.fn.implemented ? '' : 'opacity-50'}`;
  return <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${style}`}>
    <input type="radio" name="review-function" value={props.fn.id} checked={selected}
      disabled={!props.fn.implemented} onChange={() => selectFunction(props)} className="mt-1" />
    <span>
      <span className="block font-medium text-slate-900">{props.fn.label}</span>
      <span className="mt-1 block text-xs text-slate-500">{props.fn.capability} · {props.fn.implemented ? text.agent.implemented : text.agent.notImplemented}</span>
    </span>
  </label>;
}

function selectFunction(props: ReviewPanelProps & { fn: AdapterCapabilityDetailResponse['functions'][number] }) {
  props.setSelectedReviewFunctionId(props.fn.id);
  props.setReviewTestUrl(defaultTestUrlForFunction(props.reviewJob, props.fn.id));
  props.setReviewTestResult(null);
}

function FunctionTestCard(props: ReviewPanelProps) {
  const { text } = useI18n();
  const disabled = props.reviewLoading !== null || !props.selectedReviewFunctionId || !props.reviewTestUrl.trim();
  return <ReviewCard title={text.agent.runDraftFunctionTest}>
    <label className="mt-3 block text-sm">
      <span className="font-medium text-slate-700">{text.agent.testUrl}</span>
      <input value={props.reviewTestUrl} onChange={(event) => props.setReviewTestUrl(event.target.value)}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" />
    </label>
    <button type="button" onClick={() => void props.runReviewFunctionTest()} disabled={disabled}
      className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
      {props.reviewLoading === 'test' ? `${text.agent.runTests}...` : text.agent.runTests}
    </button>
    {props.reviewTestResult && <TestResult result={props.reviewTestResult} />}
  </ReviewCard>;
}

function TestResult({ result }: { result: AdapterFunctionTestResponse }) {
  const { text } = useI18n();
  const style = result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800';
  return <div className={`mt-4 rounded-lg border p-3 text-sm ${style}`}>
    <div className="font-semibold">{result.ok ? text.agent.testPassed : text.agent.testFailed} · {result.status} · {result.durationMs}ms</div>
    <div className="mt-1 text-xs">DOM: {result.domSource} · readiness: {result.readiness.status}</div>
    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-white/70 p-3 text-xs text-slate-800">
      {formatJson(result.resultSummary ?? result.error ?? result)}
    </pre>
  </div>;
}

function FunctionRevisionCard(props: ReviewPanelProps) {
  const { text } = useI18n();
  const disabled = props.reviewLoading !== null || !props.selectedReviewFunctionId || !props.functionRevisionInstruction.trim();
  return <ReviewCard title={text.agent.agentFunctionRevision}>
    <p className="mt-2 text-sm text-slate-600">{text.agent.agentFunctionRevisionDescription}</p>
    <textarea value={props.functionRevisionInstruction}
      onChange={(event) => props.setFunctionRevisionInstruction(event.target.value)}
      placeholder={text.agent.functionRevisionPlaceholder}
      className="mt-3 min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
    <button type="button" onClick={() => void props.requestFunctionRevision()} disabled={disabled}
      className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
      {props.reviewLoading === 'revision' ? `${text.agent.submitFunctionRevision}...` : text.agent.submitFunctionRevision}
    </button>
    {props.functionRevisionMessage && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{props.functionRevisionMessage}</div>}
    <RevisionTasks {...props} />
  </ReviewCard>;
}

function RevisionTasks(props: ReviewPanelProps) {
  const { text } = useI18n();
  const tasks = props.reviewJob.functionRevisionTasks;
  if (!tasks?.length) return null;
  return <div className="mt-4 space-y-2">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{text.agent.functionRevisionTasks}</div>
      <RevisionModelMode {...props} />
    </div>
    {tasks.slice().reverse().map((task) => <RevisionTaskCard key={task.id} {...props} task={task} />)}
  </div>;
}

function RevisionModelMode(props: ReviewPanelProps) {
  const { text } = useI18n();
  return <label className="flex items-center gap-2 text-xs text-slate-600">
    <span>{text.agent.functionRevisionModelMode}</span>
    <select value={props.functionRevisionModelMode}
      onChange={(event) => props.setFunctionRevisionModelMode(event.target.value as RevisionMode)}
      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
      <option value="current-settings">{text.agent.functionRevisionModelCurrent}</option>
      <option value="previous-task">{text.agent.functionRevisionModelPrevious}</option>
    </select>
  </label>;
}

function RevisionTaskCard(props: ReviewPanelProps & { task: RevisionTask }) {
  const { task } = props;
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-mono font-semibold">{task.id}</span>
      <span className="rounded-full bg-white px-2 py-1 font-medium">{task.status}</span>
    </div>
    <div className="mt-2 font-medium">{task.functionId}</div>
    <RevisionTaskMetadata task={task} />
    <div className="mt-1 whitespace-pre-wrap break-words">{task.instruction}</div>
    <RetryRevisionButton {...props} />
    {task.error && <div className="mt-2 whitespace-pre-wrap break-words rounded border border-rose-200 bg-rose-50 p-2 text-rose-700">{task.error}</div>}
    <RevisionSelfCheck task={task} />
  </div>;
}

function RevisionTaskMetadata({ task }: { task: RevisionTask }) {
  const { text } = useI18n();
  if (!task.model && !task.aoBaseUrl && !task.conversationId) return null;
  return <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
    {task.model && <div>{text.agent.buildJobModel}: <span className="font-mono">{task.model}</span></div>}
    {task.aoBaseUrl && <div>{text.agent.buildJobAoUrl}: <span className="font-mono">{task.aoBaseUrl}</span></div>}
    {task.conversationId && <div>{text.agent.aoConversation}: <span className="font-mono">{task.conversationId}</span></div>}
  </div>;
}

function RetryRevisionButton(props: ReviewPanelProps & { task: RevisionTask }) {
  const { text } = useI18n();
  const retryable = ['queued', 'failed', 'awaiting_review'].includes(props.task.status);
  if (!retryable) return null;
  return <button type="button" onClick={() => void props.retryFunctionRevision(props.task.id)} disabled={props.reviewLoading !== null}
    className="mt-3 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
    {props.reviewLoading === 'revision' ? `${text.agent.runFunctionRevision}...` : text.agent.runFunctionRevision}
  </button>;
}

function RevisionSelfCheck({ task }: { task: RevisionTask }) {
  const { text } = useI18n();
  if (!task.selfCheckMarkdown) return null;
  return <details className="mt-2 rounded border border-slate-200 bg-white p-2">
    <summary className="cursor-pointer font-medium text-slate-700">{text.agent.functionRevisionSelfCheck}</summary>
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">{task.selfCheckMarkdown}</pre>
  </details>;
}

function ReviewNotes({ job }: { job: SelectorDiscoveryJobSummary }) {
  const { text } = useI18n();
  return <ReviewCard title={text.agent.reviewNotes}>
    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{job.reviewNotesMarkdown || text.agent.noReviewNotes}</pre>
  </ReviewCard>;
}

function ValidationDetails({ job }: { job: SelectorDiscoveryJobSummary }) {
  const { text } = useI18n();
  return <ReviewCard title={text.agent.implementationValidation}>
    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{formatJson(job.implementationValidation ?? {})}</pre>
  </ReviewCard>;
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 p-4">
    <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</h3>{children}
  </div>;
}

function SourcePanel(props: ReviewPanelProps) {
  return <div>
    <SourceHeader {...props} />
    <DraftNotice {...props} />
    <ImplementationEditor content={props.reviewDraft ? props.reviewDraftContent : props.reviewImplementation?.content ?? ''}
      language={props.reviewDraft?.language ?? props.reviewImplementation?.language ?? 'typescript'}
      outline={props.reviewImplementation?.outline ?? []} selectedSymbolId={props.selectedReviewFunctionId}
      readOnly={!props.reviewDraft} onChange={props.reviewDraft ? props.setReviewDraftContent : undefined} />
  </div>;
}

function SourceHeader(props: ReviewPanelProps) {
  const { text } = useI18n();
  const source = props.reviewDraft ? `${props.reviewDraft.draft.sourceKind} · ${props.reviewDraft.draft.draftId}` : props.reviewImplementation?.sourceType ?? '-';
  return <div className="mb-3 flex items-center justify-between">
    <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{text.agent.implementationSource}</h3>
    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">{source}</span>
  </div>;
}

function DraftNotice(props: ReviewPanelProps) {
  const { text } = useI18n();
  if (!props.reviewDraft) return null;
  return <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
    {text.agent.editingDraftCopy}
    {props.reviewDraftContent !== props.savedReviewDraftContent && <span className="ml-2 font-semibold">{text.agent.unsavedDraftChanges}</span>}
  </div>;
}
