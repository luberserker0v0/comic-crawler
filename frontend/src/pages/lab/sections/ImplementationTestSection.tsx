import type { AdapterCapabilityDetailResponse, AdapterDraftDetailResponse, AdapterFunctionTestResponse,
  AdapterImplementationResponse, AdapterImplementationSymbol, ChallengeHandoffJobSummary } from '@comiccrawler/shared';
import { ImplementationDiffEditor, ImplementationEditor, type EditorLanguage } from '../../../components/ImplementationEditor';
import { AdapterFunctionResultSummary, formatLineRange } from '../widgets';
import type { useBrowserTargets } from '../useBrowserTargets';
import { BrowserTargetSection } from './BrowserTargetSection';
import { useI18n } from '../../../text/i18n';
import { formatText } from '../../../text/format';

interface ImplementationTestProps {
  selectedFunction: { label: string; notes?: string; inputKind?: string } | undefined;
  selectedSymbol: AdapterImplementationSymbol | undefined;
  capabilityDetail: AdapterCapabilityDetailResponse | null;
  runTest(challengeId?: string): void;
  loading: string | null;
  draft: AdapterDraftDetailResponse | null;
  canExecuteDraft: boolean;
  browserTargetRequired: boolean;
  selectedFunctionId: string;
  url: string;
  testStatusMessage: string | null;
  implementation: AdapterImplementationResponse | null;
  isDraftMode: boolean;
  hasUnsavedDraftChanges: boolean;
  createDraft(): void; saveDraft(): void; reloadSavedDraft(): void; resetDraft(): void; discardDraft(): void;
  draftContent: string; setDraftContent(value: string): void;
  draftViewMode: 'edit' | 'diff'; setDraftViewMode(mode: 'edit' | 'diff'): void;
  handleFunctionChange(functionId: string): void;
  editorContent: string; editorLanguage: EditorLanguage;
  testResult: AdapterFunctionTestResponse | null;
  challengeJob: ChallengeHandoffJobSummary | null;
  browserAction: string | null; browserAlreadyOpen: boolean;
  browserTargets: ReturnType<typeof useBrowserTargets>;
  openVerificationBrowser(): void; continueAfterVerification(): void;
}

export function ImplementationTestSection(props: ImplementationTestProps) {
  const { text } = useI18n();
  const labels = { common: text.lab.commonCapability, verification: text.agent.capabilityVerification,
    metadata: text.agent.capabilityMetadata, chapterImages: text.agent.capabilityChapterImages };
  return <section className="rounded-lg bg-white p-5 shadow">
    <TestHeader props={props} text={text} />
    {props.capabilityDetail && <CapabilityInfo props={props} text={text} />}
    {props.browserTargetRequired && <BrowserTargetSection options={props.browserTargets.options}
      selectedKey={props.browserTargets.selectedKey} setSelectedKey={props.browserTargets.setSelectedKey}
      loading={props.browserTargets.loading} error={props.browserTargets.error}
      refresh={props.browserTargets.refresh} />}
    {props.testStatusMessage && <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" data-testid="adapter-lab-test-status">{props.testStatusMessage}</div>}
    {props.implementation && <ImplementationBanner props={props} text={text} />}
    <EditorArea props={props} text={text} labels={labels} />
    {props.testResult && <TestResultPanel props={props} text={text} />}
  </section>;
}

type TestText = ReturnType<typeof useI18n>['text'];
type CapabilityLabels = Record<'common' | 'verification' | 'metadata' | 'chapterImages', string>;

function TestHeader({ props, text }: { props: ImplementationTestProps; text: TestText }) {
  const disabled = !props.selectedFunctionId || !props.url
    || (props.browserTargetRequired && !props.browserTargets.selectedTarget)
    || props.loading === 'test' || Boolean(props.draft && !props.canExecuteDraft);
  return <div className="flex items-start justify-between gap-4"><div>
    <h2 className="text-lg font-semibold text-gray-900">{text.lab.implementationStep}</h2>
    {props.selectedFunction && <p className="mt-1 text-sm text-gray-600">{text.lab.testTarget}: <span className="font-mono">{props.selectedFunction.label}</span>. {props.selectedFunction.notes} {text.lab.inputKind}: <span className="font-medium">{props.selectedFunction.inputKind}</span></p>}
    {props.selectedSymbol?.startLine && <p className="mt-1 text-xs text-gray-500">{text.lab.implementationSymbol}: {formatLineRange(props.selectedSymbol)}. {text.lab.sharedArtifactNote}</p>}
  </div><button type="button" data-testid="adapter-lab-test" onClick={() => void props.runTest()} disabled={disabled}
    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:bg-gray-300">
    {props.loading === 'test' ? text.lab.testing : props.draft ? text.lab.testDraft : text.lab.test}</button>
  </div>;
}

function CapabilityInfo({ props, text }: { props: ImplementationTestProps; text: TestText }) {
  return <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
    <div className="text-sm font-medium text-gray-800">{text.lab.domStrategy}</div>
    <div className="mt-1 text-sm text-gray-700">{text.lab.playwrightRender}</div>
    <div className="mt-1 text-sm text-gray-700">{text.lab.verificationHandoff}: {props.capabilityDetail!.adapter.capabilities.verification ? text.lab.supported : text.lab.unsupported}</div>
    <div className="mt-1 text-xs text-gray-500">{text.lab.domStrategyHelp}</div>
  </div>;
}

function ImplementationBanner({ props, text }: { props: ImplementationTestProps; text: TestText }) {
  const colors = props.isDraftMode ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50';
  return <div className={`mt-4 rounded-md border p-3 text-sm ${colors}`}><div className="flex flex-wrap items-start justify-between gap-3">
    <div><div className="font-medium text-gray-900">{props.isDraftMode ? text.lab.editableDraft : text.lab.activeImplementation}
      {props.hasUnsavedDraftChanges && <span className="ml-2 text-amber-700">{text.lab.unsavedChanges}</span>}
      {props.isDraftMode && !props.hasUnsavedDraftChanges && <span className="ml-2 text-emerald-700">{text.lab.saved}</span>}</div>
      <div className="mt-1 text-xs text-gray-600">{props.isDraftMode
        ? formatText(text.lab.draftTestHelp, { id: props.draft?.draft.draftId ?? '-' }) : text.lab.activeReadOnly}</div></div>
    <DraftActions props={props} text={text} />
  </div></div>;
}

function DraftActions({ props, text }: { props: ImplementationTestProps; text: TestText }) {
  if (!props.isDraftMode) return <button type="button" onClick={() => void props.createDraft()} disabled={props.loading === 'draft'}
    className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:bg-gray-300">
    {props.loading === 'draft' ? text.lab.creating : text.lab.createDraft}</button>;
  return <div className="flex flex-wrap gap-2"><DraftViewToggle props={props} text={text} />
    <SmallButton onClick={props.saveDraft} disabled={!props.hasUnsavedDraftChanges || props.loading === 'draft-save'}>{props.loading === 'draft-save' ? text.lab.saving : text.lab.saveDraft}</SmallButton>
    <SmallButton onClick={props.reloadSavedDraft} disabled={!props.hasUnsavedDraftChanges}>{text.lab.reloadSaved}</SmallButton>
    <SmallButton onClick={props.resetDraft} disabled={props.loading === 'draft-reset'}>{props.loading === 'draft-reset' ? text.lab.resetting : text.lab.resetOriginal}</SmallButton>
    <SmallButton onClick={props.discardDraft} disabled={props.loading === 'draft-discard'}>{props.loading === 'draft-discard' ? text.lab.discarding : text.lab.discardDraft}</SmallButton>
  </div>;
}

function DraftViewToggle({ props, text }: { props: ImplementationTestProps; text: TestText }) {
  return <div className="flex rounded-md border border-amber-300 bg-white p-0.5">
    {(['edit', 'diff'] as const).map((mode) => <button key={mode} type="button" onClick={() => props.setDraftViewMode(mode)}
      className={`rounded px-2 py-1 text-xs font-medium ${props.draftViewMode === mode ? 'bg-amber-600 text-white' : 'text-amber-800'}`}>
      {mode === 'edit' ? text.lab.edit : text.lab.diff}</button>)}
  </div>;
}

function SmallButton({ onClick, disabled, children }: { onClick(): void; disabled: boolean; children: React.ReactNode }) {
  return <button type="button" onClick={() => void onClick()} disabled={disabled}
    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 disabled:text-gray-300">{children}</button>;
}

function EditorArea({ props, text, labels }: { props: ImplementationTestProps; text: TestText; labels: CapabilityLabels }) {
  return <div className="mt-4"><div className="mb-2 flex items-center justify-between text-xs text-gray-500">
    <span>{props.isDraftMode ? props.draft?.draft.sourceKind : props.implementation?.sourceType ?? 'implementation'}</span>
    <span>{props.editorLanguage}</span></div>
    <div className="grid gap-3 xl:grid-cols-[220px_1fr]"><OutlinePanel props={props} text={text} labels={labels} />
      <EditorChoice props={props} text={text} /></div>
    {props.implementation?.notes && <p className="mt-2 text-xs text-gray-500">{props.implementation.notes}</p>}
    {props.implementation?.filePath && <p className="mt-1 text-xs text-gray-500">{text.lab.sourceFile}: {props.implementation.filePath}</p>}
  </div>;
}

function OutlinePanel({ props, text, labels }: { props: ImplementationTestProps; text: TestText; labels: CapabilityLabels }) {
  const outline = props.implementation?.outline ?? [];
  return <div className="max-h-[480px] overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2">
    <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{text.lab.outline}</div>
    {outline.length ? <div className="space-y-1">{outline.map((symbol) => <OutlineButton key={`${symbol.id}-${symbol.startLine ?? 'noline'}`}
      symbol={symbol} props={props} labels={labels} />)}</div> : <p className="px-2 text-xs text-gray-500">{text.lab.noOutline}</p>}
  </div>;
}

function OutlineButton({ symbol, props, labels }: { symbol: AdapterImplementationSymbol; props: ImplementationTestProps; labels: CapabilityLabels }) {
  const active = symbol.id === props.selectedFunctionId;
  const select = () => { if (props.capabilityDetail?.functions.some((fn) => fn.id === symbol.id)) props.handleFunctionChange(symbol.id); };
  return <button type="button" onClick={select}
    className={`w-full rounded px-2 py-1 text-left text-xs ${active ? 'bg-blue-100 text-blue-900' : 'text-gray-700 hover:bg-white'}`}>
    <div className="truncate font-medium">{symbol.label}</div><div className="text-[11px] text-gray-500">
      {symbol.kind}{symbol.capability ? ` · ${labels[symbol.capability]}` : ''}{symbol.startLine ? ` · ${formatLineRange(symbol)}` : ''}</div>
  </button>;
}

function EditorChoice({ props, text }: { props: ImplementationTestProps; text: TestText }) {
  if (props.isDraftMode && props.draftViewMode === 'diff') return <ImplementationDiffEditor
    originalContent={props.implementation?.content ?? ''} modifiedContent={props.draftContent}
    language={props.editorLanguage} readOnly />;
  return <ImplementationEditor content={props.loading === 'adapter' ? text.lab.loadingImplementation : props.editorContent}
    language={props.editorLanguage} outline={props.implementation?.outline ?? []}
    selectedSymbolId={props.selectedFunctionId} readOnly={!props.isDraftMode}
    onChange={props.isDraftMode ? props.setDraftContent : undefined} />;
}

function TestResultPanel({ props, text }: { props: ImplementationTestProps; text: TestText }) {
  const result = props.testResult!;
  const colors = result.status === 'passed' ? 'border-emerald-200 bg-emerald-50'
    : result.status === 'verification_required' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50';
  const title = result.status === 'verification_required' ? text.lab.verificationRequired
    : result.ok ? text.lab.testPassed : text.lab.testFailed;
  return <div className={`mt-4 min-w-0 rounded-md border p-4 text-sm ${colors}`}>
    <div className="font-semibold">{title} - {result.durationMs}ms</div>
    <ResultFacts result={result} text={text} />
    <ResultReasons result={result} />
    <ResultTimings result={result} text={text} />
    {result.requiresVerification && <VerificationControls props={props} text={text} />}
    {result.error && <div className="mt-1 text-red-700">{result.error}</div>}
    {result.resultSummary && <AdapterFunctionResultSummary summary={result.resultSummary} />}
  </div>;
}

function ResultFacts({ result, text }: { result: AdapterFunctionTestResponse; text: TestText }) {
  return <div className="mt-2 grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
    <div>{text.lab.domSource}: <b>{result.domSource}</b></div><div>{text.lab.recommendedAction}: <b>{result.recommendedAction}</b></div>
    <div>{text.lab.readiness}: <b>{result.readiness.status}</b></div><div>{text.lab.confidence}: <b>{result.readiness.confidence}</b></div>
    {result.fixtureId && <div>{text.lab.fixture}: <b>{result.fixtureId}</b></div>}
    {result.fixturePath && <div className="break-all sm:col-span-2">{text.lab.fixturePath}: {result.fixturePath}</div>}
  </div>;
}

function ResultReasons({ result }: { result: AdapterFunctionTestResponse }) {
  if (!result.readiness.reasons.length) return null;
  return <ul className="mt-2 list-disc pl-5 text-xs text-gray-700">{result.readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>;
}

function ResultTimings({ result, text }: { result: AdapterFunctionTestResponse; text: TestText }) {
  if (!result.timings?.length) return null;
  return <div className="mt-3 rounded border border-gray-200 bg-white p-3 text-xs text-gray-700">
    <div className="font-semibold text-gray-900">{text.lab.timingBreakdown}</div><div className="mt-2 grid gap-1 sm:grid-cols-3">
      {result.timings.map((timing, index) => <div key={`${timing.step}-${index}`} className="flex justify-between gap-3 rounded bg-gray-50 px-2 py-1">
        <span className="font-mono">{timing.step}</span><span>{timing.durationMs}ms</span></div>)}</div>
  </div>;
}

function VerificationControls({ props, text }: { props: ImplementationTestProps; text: TestText }) {
  const result = props.testResult!;
  return <div className="mt-3 space-y-3 text-amber-900"><p>{result.verificationMessage ?? text.lab.verificationDefault}</p>
    {result.challengeDiscoveryId && <div className="rounded-md bg-white/70 p-3">
      <div className="text-xs text-gray-600">{text.lab.handoffJob}: {result.challengeDiscoveryId}</div>
      {props.challengeJob?.status && <div className="mt-1 text-xs text-gray-600">{text.lab.status}: {props.challengeJob.status}</div>}
      {props.challengeJob?.error && <div className="mt-1 text-xs text-amber-800">{props.challengeJob.error}</div>}
      <p className="mt-3 text-xs text-gray-600">{text.lab.verificationRemote}</p><div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void props.openVerificationBrowser()} disabled={props.browserAction === 'open' || props.browserAlreadyOpen}
          className="rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white disabled:bg-gray-300">{verificationButtonLabel(props, text)}</button>
        <button type="button" onClick={() => void props.continueAfterVerification()} disabled={props.browserAction === 'continue'}
          className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:bg-gray-300">{props.browserAction === 'continue' ? text.lab.continuing : text.lab.continueTest}</button>
      </div></div>}
  </div>;
}

function verificationButtonLabel(props: ImplementationTestProps, text: TestText) {
  if (props.browserAction === 'open') return text.lab.opening;
  return props.browserAlreadyOpen ? text.lab.browserOpened : text.lab.openBrowser;
}
