import { useI18n } from '../../../text/i18n';
import type {
  AdapterCapabilityDetailResponse,
  AdapterDraftDetailResponse,
  AdapterFunctionTestResponse,
  AdapterImplementationResponse,
  SelectorDiscoveryJobSummary,
} from '@comiccrawler/shared';
import { ImplementationEditor } from '../../../components/ImplementationEditor';
import { defaultTestUrlForFunction, formatBuildJobMode, formatBuildJobTarget, formatDateTime, formatJson } from '../widgets';

export function ReviewPanel(props: {
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
  functionRevisionModelMode: 'current-settings' | 'previous-task';
  setFunctionRevisionModelMode: (value: 'current-settings' | 'previous-task') => void;
  functionRevisionMessage: string | null;
  reviewError: string | null;
  reviewLoading: 'load' | 'test' | 'approve' | 'reject' | 'edit' | 'save' | 'revision' | null;
  createEditableReviewDraft: () => void;
  saveEditableReviewDraft: () => void;
  resetEditableReviewDraft: () => void;
  requestFunctionRevision: () => void;
  retryFunctionRevision: (revisionTaskId: string) => void;
  runReviewFunctionTest: () => void;
  approveReviewJob: () => void;
  rejectReviewJob: () => void;
  closeReview: () => void;
}) {
  const { text } = useI18n();
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
    createEditableReviewDraft,
    saveEditableReviewDraft,
    resetEditableReviewDraft,
    requestFunctionRevision,
    retryFunctionRevision,
    runReviewFunctionTest,
    approveReviewJob,
    rejectReviewJob,
    closeReview,
  } = props;

  return (
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
                onClick={() => resetEditableReviewDraft()}
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
  );
}
