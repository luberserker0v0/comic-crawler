import { useI18n } from '../../../text/i18n';
import { DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON } from '../provider-template';

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
  refreshSelectorDiscoveryBundleStatus: () => void;
  refreshSelectorDiscoveryBundleEvaluations: () => void;
  handleSelectorDiscoverySave: () => void;
  handleLoadDefaultSelectorDiscoveryProvider: () => void;
  handleSelectorDiscoveryClear: () => void;
  handleSelectorDiscoveryTest: () => void;
  handleRefreshSelectorDiscoveryAoModels: () => void;
}) {
  const { text } = useI18n();
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
    refreshSelectorDiscoveryBundleStatus,
    refreshSelectorDiscoveryBundleEvaluations,
    handleSelectorDiscoverySave,
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
    : 'Run bundle-eval first; no passing evaluation artifact is available yet.';

  return (
    <div className="space-y-4 rounded-lg bg-white p-6 shadow">
      <div>
        <h2 className="text-lg font-semibold">Selector Discovery (AO)</h2>
        <p className="mt-1 text-sm text-slate-500">
          AO URL, provider JSON, and model are required. Provider secrets are accepted here but are not returned by the API.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {text.settings.selectorDiscoveryIndependentSave}
        </p>
        <p className="mt-1 text-sm text-amber-700">
          Token file references must be readable by AO/OpenCode, not just by ComicCrawler. If AO runs in Docker, use a mounted AO-visible path.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">AO URL</label>
          <input
            type="text"
            value={aoBaseUrl}
            onChange={(e) => setAoBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:32768"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Model</label>
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
              disabled={!selectorDiscoveryConfig?.configured || selectorDiscoveryAoModelsLoading}
              className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {selectorDiscoveryAoModelsLoading ? 'Loading...' : 'Refresh AO models'}
            </button>
          </div>
          <datalist id="selector-discovery-ao-models">
            {aoModelOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name ? `${item.name} (${item.status ?? 'unknown'})` : item.status ?? item.providerId}
              </option>
            ))}
          </datalist>
          {aoModelOptions.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              AO listed {selectorDiscoveryAoModels?.providers.length ?? 0} providers and {aoModelOptions.length} models from a temporary conversation.
            </p>
          )}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between gap-3">
          <label className="block text-sm font-medium text-gray-700">Provider JSON</label>
          <button
            type="button"
            onClick={handleLoadDefaultSelectorDiscoveryProvider}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Load default provider template
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
            The saved provider JSON is intentionally hidden because it may contain secrets. Use the template button to replace it, then save.
          </p>
        )}
      </div>
      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
        <div>Configured: {selectorDiscoveryConfig?.configured ? 'yes' : 'no'}</div>
        <div>Providers: {(selectorDiscoveryConfig?.providerIds ?? []).join(', ') || '-'}</div>
        <div>Models: {(selectorDiscoveryConfig?.modelIds ?? []).join(', ') || '-'}</div>
        <div>Fingerprint: {selectorDiscoveryConfig?.providerFingerprint ?? '-'}</div>
      </div>
      {selectorDiscoveryAoModels && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <div className="font-medium">AO available providers/models</div>
          <div className="mt-1 text-xs">
            Source: temporary AO conversation. Provider options and secrets are not displayed.
          </div>
          <div className="mt-2 max-h-52 overflow-auto rounded bg-white">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-1 font-medium">Provider</th>
                  <th className="px-2 py-1 font-medium">Model</th>
                  <th className="px-2 py-1 font-medium">Name</th>
                  <th className="px-2 py-1 font-medium">Status</th>
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
                Showing first 80 of {aoModelOptions.length} models.
              </div>
            )}
          </div>
          {aoModelOptions.length > 0 && !aoModelOptions.some((item) => item.id === model) && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              The current model is not in AO's provider list. Pick one from the datalist above before saving.
            </div>
          )}
        </div>
      )}
      {selectorDiscoveryConfig?.configured && !(selectorDiscoveryConfig.modelIds ?? []).includes(model) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          The selected model is not present in the saved provider summary. Refresh AO models or save an updated provider document before running adapter builds.
        </div>
      )}
      {(selectorDiscoveryConfig?.warnings ?? []).length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="font-medium">Provider diagnostics</div>
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
            <div className="font-medium text-slate-800">AO Bundle Release</div>
            <p className="mt-1 text-xs text-slate-500">
              Runtime uses draft while no active release is frozen. Frozen releases are verified by SHA-256 before use.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshSelectorDiscoveryBundleStatus}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
          <div>
            <dt className="text-slate-400">Mode</dt>
            <dd className="font-medium">{selectorDiscoveryBundleStatus?.mode ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Verified</dt>
            <dd className={selectorDiscoveryBundleStatus?.verified ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>
              {selectorDiscoveryBundleStatus?.verified ? 'yes' : 'no'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Release</dt>
            <dd>{selectorDiscoveryBundleStatus?.release ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Frozen at</dt>
            <dd>{selectorDiscoveryBundleStatus?.activeRelease?.frozenAt ?? '-'}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-slate-400">Expected SHA-256</dt>
            <dd className="break-all font-mono">{selectorDiscoveryBundleStatus?.expectedSha256 ?? '-'}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-slate-400">Actual SHA-256</dt>
            <dd className="break-all font-mono">{selectorDiscoveryBundleStatus?.actualSha256 ?? '-'}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-slate-400">Active root</dt>
            <dd className="break-all font-mono">{selectorDiscoveryBundleStatus?.activeRoot ?? '-'}</dd>
          </div>
          {selectorDiscoveryBundleStatus?.activeRelease?.evalBundleHash && (
            <div className="md:col-span-2">
              <dt className="text-slate-400">Eval bundle hash</dt>
              <dd className="break-all font-mono">{selectorDiscoveryBundleStatus.activeRelease.evalBundleHash}</dd>
            </div>
          )}
          {selectorDiscoveryBundleStatus?.error && (
            <div className="md:col-span-2">
              <dt className="text-slate-400">Status note</dt>
              <dd className="text-amber-700">{selectorDiscoveryBundleStatus.error}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-indigo-900">Release operation guide</div>
            <p className="mt-1 text-xs text-indigo-800">
              Long-running AO eval and release freeze stay in CLI for now. The UI shows safe command templates and recent artifacts.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshSelectorDiscoveryBundleEvaluations}
            className="rounded-md border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm hover:bg-indigo-50"
          >
            Refresh evals
          </button>
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-xs font-medium text-indigo-900">-1. List eval cases</div>
            <pre className="mt-1 overflow-auto rounded bg-white p-2 text-xs text-slate-800">{bundleListCasesCommand}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-indigo-900">0. Preview eval plan</div>
            <pre className="mt-1 overflow-auto rounded bg-white p-2 text-xs text-slate-800">{bundleEvalDryRunCommand}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-indigo-900">1. Run bundle evaluation</div>
            <pre className="mt-1 overflow-auto rounded bg-white p-2 text-xs text-slate-800">{bundleEvalCommand}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-indigo-900">2. Freeze passing evaluation</div>
            <pre className="mt-1 overflow-auto rounded bg-white p-2 text-xs text-slate-800">{bundleFreezeCommand}</pre>
          </div>
          {selectorDiscoveryBundleEvaluations.length > 0 ? (
            <div>
              <div className="text-xs font-medium text-indigo-900">Recent bundle evaluations</div>
              <div className="mt-2 max-h-56 overflow-auto rounded bg-white">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1 font-medium">Result</th>
                      <th className="px-2 py-1 font-medium">Policy</th>
                      <th className="px-2 py-1 font-medium">Hash</th>
                      <th className="px-2 py-1 font-medium">Runs</th>
                      <th className="px-2 py-1 font-medium">Created</th>
                      <th className="px-2 py-1 font-medium">Job</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectorDiscoveryBundleEvaluations.map((evaluation) => (
                      <tr key={evaluation.hash} className="border-t border-slate-100">
                        <td className={evaluation.passed ? 'px-2 py-1 text-emerald-700' : 'px-2 py-1 text-red-700'}>
                          {evaluation.passed ? 'passed' : 'failed'}
                        </td>
                        <td className={evaluation.policy?.passed ? 'px-2 py-1 text-emerald-700' : 'px-2 py-1 text-amber-700'}>
                          {evaluation.policy?.passed ? 'passed' : 'failed'}
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
                  Latest passing eval artifact: <span className="font-mono">{latestPassedEvaluation.path}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-indigo-800">
              No bundle evaluation artifacts found under data/agent-workspaces/bundle-evaluations.
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
          <div className="font-medium text-slate-800">AO preflight steps</div>
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
      <div className="flex gap-3">
        <button
          onClick={handleSelectorDiscoverySave}
          disabled={!aoBaseUrl.trim() || !model.trim() || (!selectorDiscoveryConfig?.configured && !providerJson.trim())}
          className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {text.settings.saveAoSettings}
        </button>
        <button
          onClick={handleSelectorDiscoveryTest}
          disabled={!selectorDiscoveryConfig?.configured}
          className="inline-flex justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-50"
        >
          Test AO
        </button>
        <button
          onClick={handleSelectorDiscoveryClear}
          className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          Clear provider
        </button>
      </div>
    </div>
  );
}
