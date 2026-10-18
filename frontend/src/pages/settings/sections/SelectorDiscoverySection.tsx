import { useI18n } from '../../../text/i18n';
import { DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON } from '../provider-template';
import { formatText } from '../../../text/format';

export function SelectorDiscoverySection(props: {
  aoBaseUrl: string;
  setAoBaseUrl: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  providerJson: string;
  setProviderJson: (value: string) => void;
  selectorDiscoveryConfig: any | null;
  selectorDiscoveryBundleStatus: any | null;
  selectorDiscoveryBundleEvaluations: any[];
  selectorDiscoveryAoModels: { providers: Array<{ id: string }>; models: Array<{ id: string; name?: string; status?: string; providerId: string }> } | null;
  selectorDiscoveryAoModelsLoading: boolean;
  selectorDiscoveryMessage: string | null;
  selectorDiscoveryPreflight: any | null;
  selectorDiscoverySaveState: { state: 'idle' } | { state: 'saving' } | { state: 'saved'; at: string } | { state: 'error'; message: string };
  refreshSelectorDiscoveryBundleStatus: () => void;
  refreshSelectorDiscoveryBundleEvaluations: () => void;
  handleLoadDefaultSelectorDiscoveryProvider: () => void;
  handleSelectorDiscoveryClear: () => void;
  handleSelectorDiscoveryTest: () => void;
  handleRefreshSelectorDiscoveryAoModels: () => void;
}) {
  const { text } = useI18n();
  const t = text.settings.selector;
  const {
    aoBaseUrl,
    setAoBaseUrl,
    model,
    setModel,
    providerJson,
    setProviderJson,
    selectorDiscoveryConfig,
    selectorDiscoveryBundleStatus,
    selectorDiscoveryBundleEvaluations,
    selectorDiscoveryAoModels,
    selectorDiscoveryAoModelsLoading,
    selectorDiscoveryMessage,
    selectorDiscoveryPreflight,
    selectorDiscoverySaveState,
    refreshSelectorDiscoveryBundleStatus,
    refreshSelectorDiscoveryBundleEvaluations,
    handleLoadDefaultSelectorDiscoveryProvider,
    handleSelectorDiscoveryClear,
    handleSelectorDiscoveryTest,
    handleRefreshSelectorDiscoveryAoModels,
  } = props;

  const aoModelOptions = selectorDiscoveryAoModels?.models ?? [];
  const latestPassedEvaluation = selectorDiscoveryBundleEvaluations.find((evaluation) => evaluation.passed);
  const bundleListCasesCommand = 'comiccrawler agent bundle-eval --list-cases';
  const bundleEvalCommand = `comiccrawler agent bundle-eval --ao-url ${aoBaseUrl || '<ao-url>'} --provider-json <provider.json> --model ${model || '<provider/model>'}`;
  const bundleEvalDryRunCommand = `${bundleEvalCommand} --dry-run`;
  const bundleFreezeCommand = latestPassedEvaluation
    ? `comiccrawler agent bundle-freeze --eval-bundle-hash ${latestPassedEvaluation.hash}`
    : t.runEvalFirst;

  return (
    <div className="space-y-4 rounded-lg bg-white p-6 shadow">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {t.description}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {text.settings.selectorDiscoveryIndependentSave}
        </p>
        <p className="mt-1 text-sm text-amber-700">
          {t.tokenPathHelp}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">{t.aoUrl}</label>
          <input
            type="text"
            value={aoBaseUrl}
            onChange={(e) => setAoBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:32768"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{t.model}</label>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="selector-discovery-ao-models"
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
            <button
              type="button"
              onClick={handleRefreshSelectorDiscoveryAoModels}
              disabled={!aoBaseUrl.trim() || selectorDiscoveryAoModelsLoading}
              title={aoBaseUrl.trim() ? t.modelRefreshHelp : t.enterAoFirst}
              className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {selectorDiscoveryAoModelsLoading ? t.loading : t.refreshModels}
            </button>
          </div>
          <datalist id="selector-discovery-ao-models">
            {aoModelOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name ? `${item.name} (${item.status ?? t.unknown})` : item.status ?? item.providerId}
              </option>
            ))}
          </datalist>
          {aoModelOptions.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {formatText(t.modelsListed, { providers: selectorDiscoveryAoModels?.providers.length ?? 0, models: aoModelOptions.length })}
            </p>
          )}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between gap-3">
          <label className="block text-sm font-medium text-gray-700">{t.providerJson}</label>
          <button
            type="button"
            onClick={handleLoadDefaultSelectorDiscoveryProvider}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {t.loadTemplate}
          </button>
        </div>
        <textarea
          value={providerJson}
          onChange={(e) => setProviderJson(e.target.value)}
          rows={10}
          placeholder={DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON}
          className="mt-1 block w-full rounded-md border-gray-300 font-mono text-xs shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
        {selectorDiscoveryConfig?.configured && !providerJson.trim() && (
          <p className="mt-1 text-xs text-slate-500">
            {t.hiddenProvider}
          </p>
        )}
      </div>
      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
        <div>{t.configured}: {selectorDiscoveryConfig?.configured ? t.yes : t.no}</div>
        <div>{t.providers}: {(selectorDiscoveryConfig?.providerIds ?? []).join(', ') || '-'}</div>
        <div>{t.models}: {(selectorDiscoveryConfig?.modelIds ?? []).join(', ') || '-'}</div>
        <div>{t.fingerprint}: {selectorDiscoveryConfig?.providerFingerprint ?? '-'}</div>
      </div>
      {selectorDiscoveryAoModels && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <div className="font-medium">{t.availableModels}</div>
          <div className="mt-1 text-xs">
            {t.availableModelsSource}
          </div>
          <div className="mt-2 max-h-52 overflow-auto rounded bg-white">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-1 font-medium">{t.provider}</th>
                  <th className="px-2 py-1 font-medium">{t.model}</th>
                  <th className="px-2 py-1 font-medium">{t.name}</th>
                  <th className="px-2 py-1 font-medium">{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {aoModelOptions.slice(0, 80).map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-2 py-1 font-mono">{item.providerId}</td>
                    <td className="px-2 py-1 font-mono">{item.id}</td>
                    <td className="px-2 py-1">{item.name ?? '-'}</td>
                    <td className="px-2 py-1">{item.status ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {aoModelOptions.length > 80 && (
              <div className="border-t border-slate-100 px-2 py-1 text-xs text-slate-500">
                {formatText(t.showingModels, { count: aoModelOptions.length })}
              </div>
            )}
          </div>
          {aoModelOptions.length > 0 && !aoModelOptions.some((item) => item.id === model) && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              {t.modelMissingAo}
            </div>
          )}
        </div>
      )}
      {selectorDiscoveryConfig?.configured && !(selectorDiscoveryConfig.modelIds ?? []).includes(model) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t.modelMissingSaved}
        </div>
      )}
      {(selectorDiscoveryConfig?.warnings ?? []).length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="font-medium">{t.providerDiagnostics}</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {selectorDiscoveryConfig.warnings.map((warning: string) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-slate-800">{t.bundleRelease}</div>
            <p className="mt-1 text-xs text-slate-500">
              {t.bundleReleaseHelp}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshSelectorDiscoveryBundleStatus}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {t.refresh}
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
          <div>
            <dt className="text-slate-400">{t.mode}</dt>
            <dd className="font-medium">{selectorDiscoveryBundleStatus?.mode ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">{t.verified}</dt>
            <dd className={selectorDiscoveryBundleStatus?.verified ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>
              {selectorDiscoveryBundleStatus?.verified ? t.yes : t.no}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">{t.release}</dt>
            <dd>{selectorDiscoveryBundleStatus?.release ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">{t.frozenAt}</dt>
            <dd>{selectorDiscoveryBundleStatus?.activeRelease?.frozenAt ?? '-'}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-slate-400">{t.expectedSha}</dt>
            <dd className="break-all font-mono">{selectorDiscoveryBundleStatus?.expectedSha256 ?? '-'}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-slate-400">{t.actualSha}</dt>
            <dd className="break-all font-mono">{selectorDiscoveryBundleStatus?.actualSha256 ?? '-'}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-slate-400">{t.activeRoot}</dt>
            <dd className="break-all font-mono">{selectorDiscoveryBundleStatus?.activeRoot ?? '-'}</dd>
          </div>
          {selectorDiscoveryBundleStatus?.activeRelease?.evalBundleHash && (
            <div className="md:col-span-2">
              <dt className="text-slate-400">{t.evalHash}</dt>
              <dd className="break-all font-mono">{selectorDiscoveryBundleStatus.activeRelease.evalBundleHash}</dd>
            </div>
          )}
          {selectorDiscoveryBundleStatus?.error && (
            <div className="md:col-span-2">
              <dt className="text-slate-400">{t.statusNote}</dt>
              <dd className="text-amber-700">{selectorDiscoveryBundleStatus.error}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-indigo-900">{t.operationGuide}</div>
            <p className="mt-1 text-xs text-indigo-800">
              {t.operationGuideHelp}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshSelectorDiscoveryBundleEvaluations}
            className="rounded-md border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm hover:bg-indigo-50"
          >
            {t.refreshEvals}
          </button>
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-xs font-medium text-indigo-900">{t.listCases}</div>
            <pre className="mt-1 overflow-auto rounded bg-white p-2 text-xs text-slate-800">{bundleListCasesCommand}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-indigo-900">{t.previewPlan}</div>
            <pre className="mt-1 overflow-auto rounded bg-white p-2 text-xs text-slate-800">{bundleEvalDryRunCommand}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-indigo-900">{t.runEvaluation}</div>
            <pre className="mt-1 overflow-auto rounded bg-white p-2 text-xs text-slate-800">{bundleEvalCommand}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-indigo-900">{t.freezeEvaluation}</div>
            <pre className="mt-1 overflow-auto rounded bg-white p-2 text-xs text-slate-800">{bundleFreezeCommand}</pre>
          </div>
          {selectorDiscoveryBundleEvaluations.length > 0 ? (
            <div>
              <div className="text-xs font-medium text-indigo-900">{t.recentEvaluations}</div>
              <div className="mt-2 max-h-56 overflow-auto rounded bg-white">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1 font-medium">{t.result}</th>
                      <th className="px-2 py-1 font-medium">{t.policy}</th>
                      <th className="px-2 py-1 font-medium">{t.hash}</th>
                      <th className="px-2 py-1 font-medium">{t.runs}</th>
                      <th className="px-2 py-1 font-medium">{t.created}</th>
                      <th className="px-2 py-1 font-medium">{t.job}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectorDiscoveryBundleEvaluations.map((evaluation) => (
                      <tr key={evaluation.hash} className="border-t border-slate-100">
                        <td className={evaluation.passed ? 'px-2 py-1 text-emerald-700' : 'px-2 py-1 text-red-700'}>
                          {evaluation.passed ? t.passed : t.failed}
                        </td>
                        <td className={evaluation.policy?.passed ? 'px-2 py-1 text-emerald-700' : 'px-2 py-1 text-amber-700'}>
                          {evaluation.policy?.passed ? t.passed : t.failed}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          <span title={evaluation.hash}>{evaluation.hash.slice(0, 12)}</span>
                        </td>
                        <td className="px-2 py-1 text-slate-600">
                          {evaluation.caseCount ?? '-'} / {evaluation.runCount ?? '-'}
                        </td>
                        <td className="px-2 py-1 text-slate-600">{evaluation.createdAt ?? '-'}</td>
                        <td className="px-2 py-1 font-mono text-slate-600">{evaluation.jobId ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {latestPassedEvaluation && (
                <div className="mt-2 text-xs text-indigo-800">
                  {t.latestPassing}: <span className="font-mono">{latestPassedEvaluation.path}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-indigo-800">
              {t.noEvaluations}
            </div>
          )}
        </div>
      </div>
      {selectorDiscoveryMessage && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
          {selectorDiscoveryMessage}
        </div>
      )}
      {selectorDiscoveryPreflight?.steps?.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
          <div className="font-medium text-slate-800">{t.preflightSteps}</div>
          <ol className="mt-2 space-y-2">
            {selectorDiscoveryPreflight.steps.map((step: any, index: number) => (
              <li key={`${step.name}-${index}`} className={step.ok ? 'text-emerald-700' : 'text-red-700'}>
                <span className="font-mono text-xs">{step.ok ? '✓' : '✗'} {step.name}</span>
                {step.error && <div className="mt-1 whitespace-pre-wrap break-words text-xs">{step.error}</div>}
                {step.detail && (
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                    {JSON.stringify(step.detail, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="flex items-center gap-3">
        <span
          className={
            selectorDiscoverySaveState.state === 'error'
              ? 'text-sm text-red-700'
              : selectorDiscoverySaveState.state === 'saved'
                ? 'text-sm text-emerald-700'
                : 'text-sm text-slate-500'
          }
        >
          {selectorDiscoverySaveState.state === 'saving' && t.saving}
          {selectorDiscoverySaveState.state === 'saved' && formatText(t.savedAt, { time: selectorDiscoverySaveState.at })}
          {selectorDiscoverySaveState.state === 'error' && selectorDiscoverySaveState.message}
          {selectorDiscoverySaveState.state === 'idle' && t.autoSaveIdle}
        </span>
        <button
          onClick={handleSelectorDiscoveryTest}
          disabled={!selectorDiscoveryConfig?.configured}
          className="inline-flex justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-50"
        >
          {t.testAo}
        </button>
        <button
          onClick={handleSelectorDiscoveryClear}
          className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          {t.clearProvider}
        </button>
      </div>
    </div>
  );
}
