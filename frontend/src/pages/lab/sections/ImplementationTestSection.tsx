import type {
  AdapterCapabilityDetailResponse,
  AdapterDraftDetailResponse,
  AdapterFunctionTestResponse,
  AdapterImplementationResponse,
  AdapterImplementationSymbol,
  ChallengeHandoffJobSummary,
} from '@comiccrawler/shared';
import { ImplementationDiffEditor, ImplementationEditor, type EditorLanguage } from '../../../components/ImplementationEditor';
import { AdapterFunctionResultSummary, capabilityLabels, formatLineRange } from '../widgets';

export function ImplementationTestSection(props: {
  selectedFunction: { label: string; notes?: string; inputKind?: string } | undefined;
  selectedSymbol: AdapterImplementationSymbol | undefined;
  capabilityDetail: AdapterCapabilityDetailResponse | null;
  runTest: (challengeId?: string) => void;
  loading: string | null;
  draft: AdapterDraftDetailResponse | null;
  canExecuteDraft: boolean;
  selectedFunctionAllowed: boolean;
  selectedFunctionId: string;
  url: string;
  testStatusMessage: string | null;
  implementation: AdapterImplementationResponse | null;
  isDraftMode: boolean;
  hasUnsavedDraftChanges: boolean;
  createDraft: () => void;
  saveDraft: () => void;
  reloadSavedDraft: () => void;
  resetDraft: () => void;
  discardDraft: () => void;
  draftContent: string;
  setDraftContent: (value: string) => void;
  draftViewMode: 'edit' | 'diff';
  setDraftViewMode: (mode: 'edit' | 'diff') => void;
  handleFunctionChange: (functionId: string) => void;
  editorContent: string;
  editorLanguage: EditorLanguage;
  testResult: AdapterFunctionTestResponse | null;
  challengeJob: ChallengeHandoffJobSummary | null;
  browserExecutablePath: string;
  setBrowserExecutablePath: (value: string) => void;
  browserAction: string | null;
  browserAlreadyOpen: boolean;
  openVerificationBrowser: () => void;
  continueAfterVerification: () => void;
}) {
  const {
    selectedFunction,
    selectedSymbol,
    capabilityDetail,
    runTest,
    loading,
    draft,
    canExecuteDraft,
    selectedFunctionAllowed,
    selectedFunctionId,
    url,
    testStatusMessage,
    implementation,
    isDraftMode,
    hasUnsavedDraftChanges,
    createDraft,
    saveDraft,
    reloadSavedDraft,
    resetDraft,
    discardDraft,
    draftContent,
    setDraftContent,
    draftViewMode,
    setDraftViewMode,
    handleFunctionChange,
    editorContent,
    editorLanguage,
    testResult,
    challengeJob,
    browserExecutablePath,
    setBrowserExecutablePath,
    browserAction,
    browserAlreadyOpen,
    openVerificationBrowser,
    continueAfterVerification,
  } = props;

  return (
    <section className="rounded-lg bg-white p-5 shadow">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">4. Implementation / Test</h2>
          {selectedFunction && (
            <p className="mt-1 text-sm text-gray-600">
              Test target: <span className="font-mono">{selectedFunction.label}</span>. {selectedFunction.notes} Input kind: <span className="font-medium">{selectedFunction.inputKind}</span>
            </p>
          )}
          {selectedSymbol?.startLine && (
            <p className="mt-1 text-xs text-gray-500">
              Implementation symbol: {formatLineRange(selectedSymbol)}. The full adapter artifact remains visible because helpers and constants can be shared.
            </p>
          )}
        </div>
        <button
          type="button"
          data-testid="adapter-lab-test"
          onClick={() => void runTest()}
          disabled={!selectedFunctionId || !selectedFunctionAllowed || !url || loading === 'test' || Boolean(draft && !canExecuteDraft)}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-gray-300"
        >
          {loading === 'test' ? 'Testing...' : draft ? 'Test draft' : 'Test'}
        </button>
      </div>

      {capabilityDetail && (
        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="text-sm font-medium text-gray-800">Adapter DOM strategy</div>
          <div className="mt-1 text-sm text-gray-700">
            {capabilityDetail.adapter.parseMode === 'static'
              ? 'Static fetch'
              : capabilityDetail.adapter.parseMode === 'dynamic'
                ? 'Playwright render'
                : 'Playwright render + human verification handoff'}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            This is adapter metadata. Adapter Lab uses it automatically; users do not choose crawler mode per test.
          </div>
        </div>
      )}

      {testStatusMessage && (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" data-testid="adapter-lab-test-status">
          {testStatusMessage}
        </div>
      )}

      {implementation && (
        <div className={`mt-4 rounded-md border p-3 text-sm ${
          isDraftMode ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'
        }`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-medium text-gray-900">
                {isDraftMode ? 'Editable draft' : 'Active adapter implementation'}
                {hasUnsavedDraftChanges && <span className="ml-2 text-amber-700">Unsaved changes</span>}
                {isDraftMode && !hasUnsavedDraftChanges && <span className="ml-2 text-emerald-700">Saved</span>}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {isDraftMode
                  ? canExecuteDraft
                    ? `Draft ${draft?.draft.draftId} is stored under user adapter-drafts. Tests run against this temporary draft manifest and do not modify the active adapter.`
                    : `Draft ${draft?.draft.draftId} is stored under user adapter-drafts. Project-source TypeScript draft execution is not supported yet.`
                  : 'The active adapter is read-only. Create a draft to edit and save a user-owned copy.'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!isDraftMode ? (
                <button
                  type="button"
                  onClick={() => void createDraft()}
                  disabled={loading === 'draft'}
                  className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {loading === 'draft' ? 'Creating...' : 'Create draft'}
                </button>
              ) : (
                <>
                  <div className="flex rounded-md border border-amber-300 bg-white p-0.5">
                    <button
                      type="button"
                      onClick={() => setDraftViewMode('edit')}
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        draftViewMode === 'edit' ? 'bg-amber-600 text-white' : 'text-amber-800 hover:bg-amber-50'
                      }`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftViewMode('diff')}
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        draftViewMode === 'diff' ? 'bg-amber-600 text-white' : 'text-amber-800 hover:bg-amber-50'
                      }`}
                    >
                      Diff
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveDraft()}
                    disabled={!hasUnsavedDraftChanges || loading === 'draft-save'}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-gray-300"
                  >
                    {loading === 'draft-save' ? 'Saving...' : 'Save draft'}
                  </button>
                  <button
                    type="button"
                    onClick={reloadSavedDraft}
                    disabled={!hasUnsavedDraftChanges}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:text-gray-300"
                  >
                    Reload saved
                  </button>
                  <button
                    type="button"
                    onClick={() => void resetDraft()}
                    disabled={loading === 'draft-reset'}
                    className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:text-gray-300"
                  >
                    {loading === 'draft-reset' ? 'Resetting...' : 'Reset from original'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void discardDraft()}
                    disabled={loading === 'draft-discard'}
                    className="rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:text-gray-300"
                  >
                    {loading === 'draft-discard' ? 'Discarding...' : 'Discard draft'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
          <span>{isDraftMode ? draft?.draft.sourceKind : implementation?.sourceType ?? 'implementation'}</span>
          <span>{editorLanguage}</span>
        </div>
        <div className="grid gap-3 xl:grid-cols-[220px_1fr]">
          <div className="max-h-[480px] overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2">
            <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Outline</div>
            {implementation?.outline.length ? (
              <div className="space-y-1">
                {implementation.outline.map((symbol) => {
                  const active = symbol.id === selectedFunctionId;
                  return (
                    <button
                      key={`${symbol.id}-${symbol.startLine ?? 'noline'}`}
                      type="button"
                      onClick={() => {
                        if (capabilityDetail?.functions.some((fn) => fn.id === symbol.id)) {
                          handleFunctionChange(symbol.id);
                        }
                      }}
                      className={`w-full rounded px-2 py-1 text-left text-xs ${
                        active ? 'bg-blue-100 text-blue-900' : 'text-gray-700 hover:bg-white'
                      }`}
                    >
                      <div className="truncate font-medium">{symbol.label}</div>
                      <div className="text-[11px] text-gray-500">
                        {symbol.kind}{symbol.capability ? ` · ${capabilityLabels[symbol.capability]}` : ''}{symbol.startLine ? ` · ${formatLineRange(symbol)}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="px-2 text-xs text-gray-500">No outline available.</p>
            )}
          </div>
          {isDraftMode && draftViewMode === 'diff' ? (
            <ImplementationDiffEditor
              originalContent={implementation?.content ?? ''}
              modifiedContent={draftContent}
              language={editorLanguage}
              readOnly
            />
          ) : (
            <ImplementationEditor
              content={loading === 'adapter' ? 'Loading implementation...' : editorContent}
              language={editorLanguage}
              outline={implementation?.outline ?? []}
              selectedSymbolId={selectedFunctionId}
              readOnly={!isDraftMode}
              onChange={isDraftMode ? setDraftContent : undefined}
            />
          )}
        </div>
        {implementation?.notes && <p className="mt-2 text-xs text-gray-500">{implementation.notes}</p>}
        {implementation?.filePath && <p className="mt-1 text-xs text-gray-500">Source file: {implementation.filePath}</p>}
      </div>

      {testResult && (
        <div className={`mt-4 min-w-0 rounded-md border p-4 text-sm ${
          testResult.status === 'passed'
            ? 'border-emerald-200 bg-emerald-50'
            : testResult.status === 'verification_required'
              ? 'border-amber-200 bg-amber-50'
              : 'border-red-200 bg-red-50'
        }`}>
          <div className="font-semibold">
            {testResult.status === 'verification_required'
              ? 'Verification required'
              : `Test ${testResult.ok ? 'passed' : 'did not pass'}`} - {testResult.durationMs}ms
          </div>
          <div className="mt-2 grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
            <div>DOM source: <span className="font-medium">{testResult.domSource}</span></div>
            <div>Recommended action: <span className="font-medium">{testResult.recommendedAction}</span></div>
            <div>Readiness: <span className="font-medium">{testResult.readiness.status}</span></div>
            <div>Confidence: <span className="font-medium">{testResult.readiness.confidence}</span></div>
            {testResult.fixtureId && <div>Fixture: <span className="font-medium">{testResult.fixtureId}</span></div>}
            {testResult.fixturePath && <div className="break-all sm:col-span-2">Fixture path: {testResult.fixturePath}</div>}
          </div>
          {testResult.readiness.reasons.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-gray-700">
              {testResult.readiness.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {testResult.timings && testResult.timings.length > 0 && (
            <div className="mt-3 rounded border border-gray-200 bg-white p-3 text-xs text-gray-700">
              <div className="font-semibold text-gray-900">Timing breakdown</div>
              <div className="mt-2 grid gap-1 sm:grid-cols-3">
                {testResult.timings.map((timing, index) => (
                  <div key={`${timing.step}-${index}`} className="flex justify-between gap-3 rounded bg-gray-50 px-2 py-1">
                    <span className="font-mono">{timing.step}</span>
                    <span>{timing.durationMs}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {testResult.requiresVerification && (
            <div className="mt-3 space-y-3 text-amber-900">
              <p>
                {testResult.verificationMessage ?? 'Human verification is required. Open the verification browser, complete the check, then continue this test.'}
              </p>
              {testResult.challengeDiscoveryId && (
                <div className="rounded-md bg-white/70 p-3">
                  <div className="text-xs text-gray-600">Handoff job: {testResult.challengeDiscoveryId}</div>
                  {challengeJob?.status && <div className="mt-1 text-xs text-gray-600">Status: {challengeJob.status}</div>}
                  {challengeJob?.error && <div className="mt-1 text-xs text-amber-800">{challengeJob.error}</div>}
                  <label className="mt-3 block text-xs font-medium text-gray-700">
                    Browser executable path
                    <input
                      value={browserExecutablePath}
                      onChange={(event) => setBrowserExecutablePath(event.target.value)}
                      placeholder="Auto-detected Chrome / Chromium path"
                      className="mt-1 block w-full rounded-md border-gray-300 text-xs shadow-sm"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void openVerificationBrowser()}
                      disabled={browserAction === 'open' || browserAlreadyOpen}
                      className="rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:bg-gray-300"
                    >
                      {browserAction === 'open'
                        ? 'Opening...'
                        : browserAlreadyOpen
                          ? 'Browser already opened'
                          : 'Open browser for verification'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void continueAfterVerification()}
                      disabled={browserAction === 'continue'}
                      className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
                    >
                      {browserAction === 'continue' ? 'Continuing...' : 'Continue test'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {testResult.error && <div className="mt-1 text-red-700">{testResult.error}</div>}
          {testResult.resultSummary && (
            <AdapterFunctionResultSummary summary={testResult.resultSummary} />
          )}
        </div>
      )}
    </section>
  );
}
