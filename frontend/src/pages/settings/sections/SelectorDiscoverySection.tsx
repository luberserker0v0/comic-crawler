import { formatText } from '../../../text/format';
import { useI18n } from '../../../text/i18n';
import { DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON } from '../provider-template';

type AoModel = { id: string; name?: string; status?: string; providerId: string };
type SaveState = { state: 'idle' } | { state: 'saving' } | { state: 'saved'; at: string } | { state: 'error'; message: string };

interface SelectorDiscoverySectionProps {
  aoBaseUrl: string;
  setAoBaseUrl: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  providerJson: string;
  setProviderJson: (value: string) => void;
  selectorDiscoveryConfig: any | null;
  selectorDiscoveryBundleStatus: any | null;
  selectorDiscoveryBundleEvaluations: any[];
  selectorDiscoveryAoModels: { providers: Array<{ id: string }>; models: AoModel[] } | null;
  selectorDiscoveryAoModelsLoading: boolean;
  selectorDiscoveryMessage: string | null;
  selectorDiscoveryPreflight: any | null;
  selectorDiscoverySaveState: SaveState;
  refreshSelectorDiscoveryBundleStatus: () => void;
  refreshSelectorDiscoveryBundleEvaluations: () => void;
  handleLoadDefaultSelectorDiscoveryProvider: () => void;
  handleSelectorDiscoveryClear: () => void;
  handleSelectorDiscoveryTest: () => void;
  handleRefreshSelectorDiscoveryAoModels: () => void;
}

export function SelectorDiscoverySection(props: SelectorDiscoverySectionProps) {
  return <div className="space-y-4 rounded-lg bg-white p-6 shadow">
    <SectionIntro />
    <ConnectionFields {...props} />
    <ProviderEditor {...props} />
    <SavedConfig {...props} />
    <AvailableModels {...props} />
    <ConfigWarnings {...props} />
    <BundleStatus {...props} />
    <OperationGuide {...props} />
    <PreflightResults {...props} />
    <SectionActions {...props} />
  </div>;
}

function SectionIntro() {
  const { text } = useI18n();
  const t = text.settings.selector;
  return <div>
    <h2 className="text-lg font-semibold">{t.title}</h2>
    <p className="mt-1 text-sm text-slate-500">{t.description}</p>
    <p className="mt-1 text-sm text-slate-500">{text.settings.selectorDiscoveryIndependentSave}</p>
    <p className="mt-1 text-sm text-amber-700">{t.tokenPathHelp}</p>
  </div>;
}

function ConnectionFields(props: SelectorDiscoverySectionProps) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    <AoUrlField {...props} />
    <ModelField {...props} />
  </div>;
}

function AoUrlField(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  return <div>
    <label className="block text-sm font-medium text-gray-700">{text.settings.selector.aoUrl}</label>
    <input type="text" value={props.aoBaseUrl} onChange={(event) => props.setAoBaseUrl(event.target.value)}
      placeholder="http://127.0.0.1:32768"
      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm" />
  </div>;
}

function ModelField(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const t = text.settings.selector;
  const models = props.selectorDiscoveryAoModels?.models ?? [];
  return <div>
    <label className="block text-sm font-medium text-gray-700">{t.model}</label>
    <ModelInput {...props} />
    <datalist id="selector-discovery-ao-models">{models.map((item) => <ModelOption key={item.id} item={item} />)}</datalist>
    {models.length > 0 && <p className="mt-1 text-xs text-slate-500">
      {formatText(t.modelsListed, { providers: props.selectorDiscoveryAoModels?.providers.length ?? 0, models: models.length })}
    </p>}
  </div>;
}

function ModelInput(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const t = text.settings.selector;
  return <div className="mt-1 flex gap-2">
    <input type="text" value={props.model} onChange={(event) => props.setModel(event.target.value)}
      list="selector-discovery-ao-models"
      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm" />
    <button type="button" onClick={props.handleRefreshSelectorDiscoveryAoModels}
      disabled={!props.aoBaseUrl.trim() || props.selectorDiscoveryAoModelsLoading}
      title={props.aoBaseUrl.trim() ? t.modelRefreshHelp : t.enterAoFirst}
      className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
      {props.selectorDiscoveryAoModelsLoading ? t.loading : t.refreshModels}
    </button>
  </div>;
}

function ModelOption({ item }: { item: AoModel }) {
  const { text } = useI18n();
  const label = item.name ? `${item.name} (${item.status ?? text.settings.selector.unknown})` : item.status ?? item.providerId;
  return <option value={item.id}>{label}</option>;
}

function ProviderEditor(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const t = text.settings.selector;
  return <div>
    <div className="flex items-center justify-between gap-3">
      <label className="block text-sm font-medium text-gray-700">{t.providerJson}</label>
      <button type="button" onClick={props.handleLoadDefaultSelectorDiscoveryProvider}
        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">{t.loadTemplate}</button>
    </div>
    <textarea value={props.providerJson} onChange={(event) => props.setProviderJson(event.target.value)} rows={10}
      placeholder={DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON}
      className="mt-1 block w-full rounded-md border-gray-300 font-mono text-xs shadow-sm focus:border-blue-500 focus:ring-blue-500" />
    {props.selectorDiscoveryConfig?.configured && !props.providerJson.trim() &&
      <p className="mt-1 text-xs text-slate-500">{t.hiddenProvider}</p>}
  </div>;
}

function SavedConfig(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const t = text.settings.selector;
  const config = props.selectorDiscoveryConfig;
  return <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
    <div>{t.configured}: {config?.configured ? t.yes : t.no}</div>
    <div>{t.providers}: {(config?.providerIds ?? []).join(', ') || '-'}</div>
    <div>{t.models}: {(config?.modelIds ?? []).join(', ') || '-'}</div>
    <div>{t.fingerprint}: {config?.providerFingerprint ?? '-'}</div>
  </div>;
}

function AvailableModels(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const t = text.settings.selector;
  const models = props.selectorDiscoveryAoModels?.models ?? [];
  if (!props.selectorDiscoveryAoModels) return null;
  return <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
    <div className="font-medium">{t.availableModels}</div>
    <div className="mt-1 text-xs">{t.availableModelsSource}</div>
    <ModelsTable models={models} />
    {models.length > 0 && !models.some((item) => item.id === props.model) &&
      <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{t.modelMissingAo}</div>}
  </div>;
}

function ModelsTable({ models }: { models: AoModel[] }) {
  const { text } = useI18n();
  const t = text.settings.selector;
  return <div className="mt-2 max-h-52 overflow-auto rounded bg-white">
    <table className="min-w-full text-left text-xs">
      <thead className="bg-slate-50 text-slate-500"><tr>
        {[t.provider, t.model, t.name, t.status].map((label) => <th key={label} className="px-2 py-1 font-medium">{label}</th>)}
      </tr></thead>
      <tbody>{models.slice(0, 80).map((item) => <ModelRow key={item.id} item={item} />)}</tbody>
    </table>
    {models.length > 80 && <div className="border-t border-slate-100 px-2 py-1 text-xs text-slate-500">
      {formatText(t.showingModels, { count: models.length })}
    </div>}
  </div>;
}

function ModelRow({ item }: { item: AoModel }) {
  return <tr className="border-t border-slate-100">
    <td className="px-2 py-1 font-mono">{item.providerId}</td><td className="px-2 py-1 font-mono">{item.id}</td>
    <td className="px-2 py-1">{item.name ?? '-'}</td><td className="px-2 py-1">{item.status ?? '-'}</td>
  </tr>;
}

function ConfigWarnings(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const t = text.settings.selector;
  const config = props.selectorDiscoveryConfig;
  return <>
    {config?.configured && !(config.modelIds ?? []).includes(props.model) &&
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t.modelMissingSaved}</div>}
    {(config?.warnings ?? []).length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      <div className="font-medium">{t.providerDiagnostics}</div>
      <ul className="mt-2 list-disc space-y-1 pl-5">{config.warnings.map((warning: string) => <li key={warning}>{warning}</li>)}</ul>
    </div>}
  </>;
}

function BundleStatus(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const t = text.settings.selector;
  const status = props.selectorDiscoveryBundleStatus;
  return <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
    <PanelHeader title={t.bundleRelease} help={t.bundleReleaseHelp} button={t.refresh} onClick={props.refreshSelectorDiscoveryBundleStatus} />
    <dl className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
      <StatusItem label={t.mode} value={status?.mode} />
      <VerifiedStatus verified={Boolean(status?.verified)} />
      <StatusItem label={t.release} value={status?.release} />
      <StatusItem label={t.frozenAt} value={status?.activeRelease?.frozenAt} />
      <StatusItem label={t.expectedSha} value={status?.expectedSha256} wide mono />
      <StatusItem label={t.actualSha} value={status?.actualSha256} wide mono />
      <StatusItem label={t.activeRoot} value={status?.activeRoot} wide mono />
      {status?.activeRelease?.evalBundleHash && <StatusItem label={t.evalHash} value={status.activeRelease.evalBundleHash} wide mono />}
      {status?.error && <StatusItem label={t.statusNote} value={status.error} wide warning />}
    </dl>
  </div>;
}

function PanelHeader({ title, help, button, onClick }: { title: string; help: string; button: string; onClick: () => void }) {
  return <div className="flex items-center justify-between gap-3"><div>
    <div className="font-medium text-slate-800">{title}</div><p className="mt-1 text-xs text-slate-500">{help}</p>
  </div><button type="button" onClick={onClick}
    className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">{button}</button>
  </div>;
}

function StatusItem({ label, value, wide, mono, warning }: { label: string; value?: string; wide?: boolean; mono?: boolean; warning?: boolean }) {
  const style = `${wide ? 'md:col-span-2' : ''} ${mono ? 'break-all font-mono' : ''} ${warning ? 'text-amber-700' : ''}`;
  return <div className={wide ? 'md:col-span-2' : ''}><dt className="text-slate-400">{label}</dt><dd className={style}>{value ?? '-'}</dd></div>;
}

function VerifiedStatus({ verified }: { verified: boolean }) {
  const { text } = useI18n();
  const t = text.settings.selector;
  return <div><dt className="text-slate-400">{t.verified}</dt>
    <dd className={verified ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>{verified ? t.yes : t.no}</dd></div>;
}

function OperationGuide(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const t = text.settings.selector;
  return <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3 text-sm">
    <PanelHeader title={t.operationGuide} help={t.operationGuideHelp} button={t.refreshEvals}
      onClick={props.refreshSelectorDiscoveryBundleEvaluations} />
    <div className="mt-3 space-y-3">
      <CommandList {...props} />
      <EvaluationHistory evaluations={props.selectorDiscoveryBundleEvaluations} />
    </div>
  </div>;
}

function CommandList(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const t = text.settings.selector;
  const latest = props.selectorDiscoveryBundleEvaluations.find((item) => item.passed);
  const evaluate = `comiccrawler agent bundle-eval --ao-url ${props.aoBaseUrl || '<ao-url>'} --provider-json <provider.json> --model ${props.model || '<provider/model>'}`;
  const commands = [
    [t.listCases, 'comiccrawler agent bundle-eval --list-cases'], [t.previewPlan, `${evaluate} --dry-run`],
    [t.runEvaluation, evaluate], [t.freezeEvaluation, latest ? `comiccrawler agent bundle-freeze --eval-bundle-hash ${latest.hash}` : t.runEvalFirst],
  ];
  return <>{commands.map(([label, command]) => <Command key={label} label={label} command={command} />)}</>;
}

function Command({ label, command }: { label: string; command: string }) {
  return <div><div className="text-xs font-medium text-indigo-900">{label}</div>
    <pre className="mt-1 overflow-auto rounded bg-white p-2 text-xs text-slate-800">{command}</pre></div>;
}

function EvaluationHistory({ evaluations }: { evaluations: any[] }) {
  const { text } = useI18n();
  const t = text.settings.selector;
  const latest = evaluations.find((item) => item.passed);
  if (evaluations.length === 0) return <div className="text-xs text-indigo-800">{t.noEvaluations}</div>;
  return <div>
    <div className="text-xs font-medium text-indigo-900">{t.recentEvaluations}</div>
    <EvaluationTable evaluations={evaluations} />
    {latest && <div className="mt-2 text-xs text-indigo-800">{t.latestPassing}: <span className="font-mono">{latest.path}</span></div>}
  </div>;
}

function EvaluationTable({ evaluations }: { evaluations: any[] }) {
  const { text } = useI18n();
  const t = text.settings.selector;
  const headers = [t.result, t.policy, t.hash, t.runs, t.created, t.job];
  return <div className="mt-2 max-h-56 overflow-auto rounded bg-white"><table className="min-w-full text-left text-xs">
    <thead className="bg-slate-50 text-slate-500"><tr>{headers.map((label) => <th key={label} className="px-2 py-1 font-medium">{label}</th>)}</tr></thead>
    <tbody>{evaluations.map((evaluation) => <EvaluationRow key={evaluation.hash} evaluation={evaluation} />)}</tbody>
  </table></div>;
}

function EvaluationRow({ evaluation }: { evaluation: any }) {
  const { text } = useI18n();
  const t = text.settings.selector;
  return <tr className="border-t border-slate-100">
    <td className={evaluation.passed ? 'px-2 py-1 text-emerald-700' : 'px-2 py-1 text-red-700'}>{evaluation.passed ? t.passed : t.failed}</td>
    <td className={evaluation.policy?.passed ? 'px-2 py-1 text-emerald-700' : 'px-2 py-1 text-amber-700'}>{evaluation.policy?.passed ? t.passed : t.failed}</td>
    <td className="px-2 py-1 font-mono"><span title={evaluation.hash}>{evaluation.hash.slice(0, 12)}</span></td>
    <td className="px-2 py-1 text-slate-600">{evaluation.caseCount ?? '-'} / {evaluation.runCount ?? '-'}</td>
    <td className="px-2 py-1 text-slate-600">{evaluation.createdAt ?? '-'}</td>
    <td className="px-2 py-1 font-mono text-slate-600">{evaluation.jobId ?? '-'}</td>
  </tr>;
}

function PreflightResults(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const steps = props.selectorDiscoveryPreflight?.steps ?? [];
  return <>
    {props.selectorDiscoveryMessage && <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">{props.selectorDiscoveryMessage}</div>}
    {steps.length > 0 && <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
      <div className="font-medium text-slate-800">{text.settings.selector.preflightSteps}</div>
      <ol className="mt-2 space-y-2">{steps.map((step: any, index: number) => <PreflightStep key={`${step.name}-${index}`} step={step} />)}</ol>
    </div>}
  </>;
}

function PreflightStep({ step }: { step: any }) {
  return <li className={step.ok ? 'text-emerald-700' : 'text-red-700'}>
    <span className="font-mono text-xs">{step.ok ? '✓' : '✗'} {step.name}</span>
    {step.error && <div className="mt-1 whitespace-pre-wrap break-words text-xs">{step.error}</div>}
    {step.detail && <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">{JSON.stringify(step.detail, null, 2)}</pre>}
  </li>;
}

function SectionActions(props: SelectorDiscoverySectionProps) {
  const { text } = useI18n();
  const t = text.settings.selector;
  return <div className="flex items-center gap-3">
    <SaveState state={props.selectorDiscoverySaveState} />
    <button onClick={props.handleSelectorDiscoveryTest} disabled={!props.selectorDiscoveryConfig?.configured}
      className="inline-flex justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-50">{t.testAo}</button>
    <button onClick={props.handleSelectorDiscoveryClear}
      className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">{t.clearProvider}</button>
  </div>;
}

function SaveState({ state }: { state: SaveState }) {
  const { text } = useI18n();
  const t = text.settings.selector;
  const style = state.state === 'error' ? 'text-sm text-red-700' : state.state === 'saved' ? 'text-sm text-emerald-700' : 'text-sm text-slate-500';
  const message = state.state === 'saving' ? t.saving : state.state === 'saved' ? formatText(t.savedAt, { time: state.at })
    : state.state === 'error' ? state.message : t.autoSaveIdle;
  return <span className={style}>{message}</span>;
}
