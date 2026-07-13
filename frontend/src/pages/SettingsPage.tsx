import React from 'react';
import { useConfigStore, type GlobalConfig } from '../store';
import { SUPPORTED_LOCALES, type LocaleCode, useI18n } from '../text/i18n';
import { api } from '../api/client';

const DEFAULT_SELECTOR_DISCOVERY_MODEL = 'opencode/deepseek-v4-flash-free';

export const SettingsPage: React.FC = () => {
  const { config, loading, error, fetchConfig, updateConfig, resetConfig, clearError } = useConfigStore();
  const [formDraft, setForm] = React.useState<Partial<GlobalConfig> | null>(null);
  const [selectorDiscoveryConfig, setSelectorDiscoveryConfig] = React.useState<any | null>(null);
  const [selectorDiscoveryBundleStatus, setSelectorDiscoveryBundleStatus] = React.useState<any | null>(null);
  const [selectorDiscoveryBundleEvaluations, setSelectorDiscoveryBundleEvaluations] = React.useState<any[]>([]);
  const [aoBaseUrl, setAoBaseUrl] = React.useState('');
  const [model, setModel] = React.useState(DEFAULT_SELECTOR_DISCOVERY_MODEL);
  const [providerJson, setProviderJson] = React.useState('');
  const [selectorDiscoveryMessage, setSelectorDiscoveryMessage] = React.useState<string | null>(null);
  const [selectorDiscoveryPreflight, setSelectorDiscoveryPreflight] = React.useState<any | null>(null);
  const [cdpTestMessage, setCdpTestMessage] = React.useState<string | null>(null);
  const [downloadDirectoryMessage, setDownloadDirectoryMessage] = React.useState<string | null>(null);
  const { text } = useI18n();
  const form = formDraft ?? config ?? {};

  React.useEffect(() => {
    fetchConfig();
    api.getSelectorDiscoveryConfig().then((response) => {
      setSelectorDiscoveryConfig(response.data);
      setAoBaseUrl(response.data.aoBaseUrl ?? '');
      setModel(response.data.model ?? DEFAULT_SELECTOR_DISCOVERY_MODEL);
    }).catch(() => undefined);
    refreshSelectorDiscoveryBundleStatus();
    refreshSelectorDiscoveryBundleEvaluations();
  }, [fetchConfig]);

  const refreshSelectorDiscoveryBundleStatus = async () => {
    try {
      const response = await api.getSelectorDiscoveryBundleStatus();
      setSelectorDiscoveryBundleStatus(response.data);
    } catch (err: any) {
      setSelectorDiscoveryBundleStatus({
        verified: false,
        error: err.response?.data?.error ?? err.message,
      });
    }
  };

  const refreshSelectorDiscoveryBundleEvaluations = async () => {
    try {
      const response = await api.getSelectorDiscoveryBundleEvaluations();
      setSelectorDiscoveryBundleEvaluations(response.data.evaluations ?? []);
    } catch {
      setSelectorDiscoveryBundleEvaluations([]);
    }
  };

  const handleChange = (section: string, key: string, value: any) => {
    setForm((previousDraft) => {
      const previous = previousDraft ?? config ?? {};
      return {
      ...previous,
      [section]: {
        ...(previous as any)[section],
        [key]: value,
      },
    };
    });
  };

  const handleNestedChange = (section: string, nested: string, key: string, value: any) => {
    setForm((previousDraft) => {
      const previous = previousDraft ?? config ?? {};
      const sectionValue = (previous as any)[section] ?? {};
      return {
        ...previous,
        [section]: {
          ...sectionValue,
          [nested]: {
            ...(sectionValue as any)[nested],
            [key]: value,
          },
        },
      };
    });
  };

  const handleSave = async () => {
    await updateConfig(form);
    setForm(null);
  };

  const handleReset = async () => {
    await resetConfig();
    setForm(null);
  };

  const handleSelectorDiscoverySave = async () => {
    setSelectorDiscoveryMessage(null);
    setSelectorDiscoveryPreflight(null);
    try {
      const response = await api.updateSelectorDiscoveryConfig({
        aoBaseUrl,
        model,
        providerDocument: JSON.parse(providerJson),
      });
      setSelectorDiscoveryConfig(response.data);
      setSelectorDiscoveryMessage('Selector discovery settings saved.');
      setProviderJson('');
    } catch (err: any) {
      setSelectorDiscoveryMessage(err.response?.data?.error ?? err.message);
    }
  };

  const handleSelectorDiscoveryClear = async () => {
    const response = await api.clearSelectorDiscoveryProvider();
    setSelectorDiscoveryConfig(response.data);
    setSelectorDiscoveryMessage('Selector discovery provider cleared.');
  };

  const handleSelectorDiscoveryTest = async () => {
    setSelectorDiscoveryMessage(null);
    setSelectorDiscoveryPreflight(null);
    try {
      const response = await api.testSelectorDiscoveryConfig();
      setSelectorDiscoveryPreflight(response.data);
      setSelectorDiscoveryMessage(`AO smoke test passed. Bundle ${response.data.bundleHash?.slice(0, 12) ?? '-'} / ${response.data.model}`);
    } catch (err: any) {
      setSelectorDiscoveryPreflight(err.response?.data?.data ?? null);
      setSelectorDiscoveryMessage(err.response?.data?.error ?? err.message);
    }
  };

  const handleCdpTest = async () => {
    setCdpTestMessage(null);
    try {
      const cdpUrl = (form as any).browser?.handoff?.cdpUrl;
      const response = await api.testChallengeDiscoveryCdp(cdpUrl);
      setCdpTestMessage(`Connected. Pages: ${response.data.pageCount}. ${response.data.pages?.[0]?.title ?? response.data.pages?.[0]?.url ?? ''}`);
    } catch (err: any) {
      setCdpTestMessage(err.response?.data?.error ?? err.message);
    }
  };

  const handleBrowseDownloadDirectory = async () => {
    setDownloadDirectoryMessage(null);
    try {
      const response = await api.browseDownloadDirectory();
      if (response.data.directory) {
        handleChange('download', 'directory', response.data.directory);
      }
    } catch (err: any) {
      setDownloadDirectoryMessage(err.response?.data?.error ?? err.message);
    }
  };

  const handleOpenDownloadDirectory = async () => {
    setDownloadDirectoryMessage(null);
    try {
      const directory = (form as any).download?.directory;
      const response = await api.openDownloadDirectory(directory);
      setDownloadDirectoryMessage(`Opened ${response.data.directory}`);
    } catch (err: any) {
      setDownloadDirectoryMessage(err.response?.data?.error ?? err.message);
    }
  };

  const latestPassedEvaluation = selectorDiscoveryBundleEvaluations.find((evaluation) => evaluation.passed);
  const bundleListCasesCommand = 'comiccrawler agent bundle-eval --list-cases';
  const bundleEvalCommand = `comiccrawler agent bundle-eval --ao-url ${aoBaseUrl || '<ao-url>'} --provider-json <provider.json> --model ${model || '<provider/model>'}`;
  const bundleEvalDryRunCommand = `${bundleEvalCommand} --dry-run`;
  const bundleFreezeCommand = latestPassedEvaluation
    ? `comiccrawler agent bundle-freeze --eval-bundle-hash ${latestPassedEvaluation.hash}`
    : 'Run bundle-eval first; no passing evaluation artifact is available yet.';

  if (loading && !config) {
    return <div className="py-8 text-center">{text.settings.loading}</div>;
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <div className="text-red-600">{error}</div>
        <button onClick={clearError} className="mt-2 text-blue-600 hover:underline">
          {text.settings.dismissError}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">{text.settings.title}</h1>

      <div className="space-y-4 rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">{text.settings.languageSection}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.languageLabel}</label>
            <select
              value={(form as any).i18n?.language ?? 'zh-TW'}
              onChange={(e) => handleChange('i18n', 'language', e.target.value as LocaleCode)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {text.language[code]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.fallbackLabel}</label>
            <select
              value={(form as any).i18n?.fallback ?? 'en'}
              onChange={(e) => handleChange('i18n', 'fallback', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="en">English</option>
              <option value="zh-TW">繁體中文</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">{text.settings.downloadSection}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.downloadDirectory}</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={(form as any).download?.directory ?? ''}
                onChange={(e) => handleChange('download', 'directory', e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              <button
                type="button"
                onClick={() => void handleBrowseDownloadDirectory()}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Browse
              </button>
              <button
                type="button"
                onClick={() => void handleOpenDownloadDirectory()}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Open
              </button>
            </div>
            {downloadDirectoryMessage && (
              <div className="mt-2 text-xs text-gray-500">{downloadDirectoryMessage}</div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.downloadConcurrency}</label>
            <input
              type="number"
              value={(form as any).download?.concurrency ?? 5}
              onChange={(e) => handleChange('download', 'concurrency', Number(e.target.value))}
              min={1}
              max={20}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.namingTemplate}</label>
            <input
              type="text"
              value={(form as any).download?.namingTemplate ?? ''}
              onChange={(e) => handleChange('download', 'namingTemplate', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.imageFormat}</label>
            <select
              value={(form as any).download?.imageFormat ?? 'original'}
              onChange={(e) => handleChange('download', 'imageFormat', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="original">{text.settings.originalFormat}</option>
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">{text.settings.networkSection}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.timeout}</label>
            <input
              type="number"
              value={(form as any).network?.timeout ?? 30000}
              onChange={(e) => handleChange('network', 'timeout', Number(e.target.value))}
              min={1000}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.retries}</label>
            <input
              type="number"
              value={(form as any).network?.retries ?? 3}
              onChange={(e) => handleChange('network', 'retries', Number(e.target.value))}
              min={0}
              max={10}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.retryDelay}</label>
            <input
              type="number"
              value={(form as any).network?.retryDelay ?? 1000}
              onChange={(e) => handleChange('network', 'retryDelay', Number(e.target.value))}
              min={0}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg bg-white p-6 shadow" data-testid="browser-crawler-settings">
        <div>
          <h2 className="text-lg font-semibold">Headless Browser Crawler</h2>
          <p className="mt-1 text-sm text-slate-500">
            Static uses direct HTTP. Headless renders pages with Playwright. Auto tries static first and falls back to headless on parsing failures.
          </p>
          <p className="mt-1 text-sm text-amber-700">
            For Cloudflare challenge pages, solve the challenge manually in a browser you control, then point ComicCrawler at a Playwright storage state file or persistent browser profile. ComicCrawler will not generate selectors from challenge pages.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">Crawler mode</label>
            <select
              data-testid="browser-mode-select"
              value={(form as any).browser?.mode ?? 'auto'}
              onChange={(e) => handleChange('browser', 'mode', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="auto">auto</option>
              <option value="static">static</option>
              <option value="headless">headless</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Wait until</label>
            <select
              data-testid="browser-wait-until-select"
              value={(form as any).browser?.waitUntil ?? 'domcontentloaded'}
              onChange={(e) => handleChange('browser', 'waitUntil', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="domcontentloaded">domcontentloaded</option>
              <option value="load">load</option>
              <option value="networkidle">networkidle</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Timeout (ms)</label>
            <input
              data-testid="browser-timeout-input"
              type="number"
              value={(form as any).browser?.timeout ?? 30000}
              onChange={(e) => handleChange('browser', 'timeout', Number(e.target.value))}
              min={1000}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Max browser instances</label>
            <input
              type="number"
              value={(form as any).browser?.maxInstances ?? 2}
              onChange={(e) => handleChange('browser', 'maxInstances', Number(e.target.value))}
              min={1}
              max={10}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Wait for selector</label>
            <input
              data-testid="browser-wait-selector-input"
              type="text"
              value={(form as any).browser?.waitForSelector ?? ''}
              onChange={(e) => handleChange('browser', 'waitForSelector', e.target.value || undefined)}
              placeholder=".page-chapter img"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Post-load delay (ms)</label>
            <input
              type="number"
              value={(form as any).browser?.postLoadDelayMs ?? 0}
              onChange={(e) => handleChange('browser', 'postLoadDelayMs', Number(e.target.value))}
              min={0}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Challenge wait (ms)</label>
            <input
              data-testid="browser-challenge-wait-input"
              type="number"
              value={(form as any).browser?.challengeWaitMs ?? 15000}
              onChange={(e) => handleChange('browser', 'challengeWaitMs', Number(e.target.value))}
              min={0}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">
              If a JavaScript challenge appears, Playwright waits this long for it to complete naturally before marking the page blocked.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={(form as any).browser?.headless ?? true}
              onChange={(e) => handleChange('browser', 'headless', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Run browser headless
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              data-testid="browser-challenge-auto-attempt-input"
              type="checkbox"
              checked={(form as any).browser?.challengeAutoAttempt ?? true}
              onChange={(e) => handleChange('browser', 'challengeAutoAttempt', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Attempt JavaScript challenge automatically
          </label>
          <div>
            <label className="block text-sm font-medium text-gray-700">Browser channel</label>
            <input
              data-testid="browser-channel-input"
              type="text"
              value={(form as any).browser?.channel ?? ''}
              onChange={(e) => handleChange('browser', 'channel', e.target.value || undefined)}
              placeholder="chrome or msedge"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-700">Storage state path</label>
            <input
              data-testid="browser-storage-state-input"
              type="text"
              value={(form as any).browser?.storageStatePath ?? ''}
              onChange={(e) => handleChange('browser', 'storageStatePath', e.target.value || undefined)}
              placeholder="D:\\path\\to\\storage-state.json"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">
              Use a Playwright storageState JSON exported after you manually pass a site challenge.
            </p>
          </div>
          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-700">Persistent user data directory</label>
            <input
              data-testid="browser-user-data-dir-input"
              type="text"
              value={(form as any).browser?.userDataDir ?? ''}
              onChange={(e) => handleChange('browser', 'userDataDir', e.target.value || undefined)}
              placeholder="D:\\path\\to\\comiccrawler-browser-profile"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">
              When set, Playwright uses a persistent browser profile and limits the browser pool to one instance for that profile.
            </p>
          </div>
          <div className="md:col-span-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-medium text-slate-800">Challenge handoff</div>
            <p className="mt-1 text-xs text-slate-500">
              Prefer HTML snapshot for safety. CDP attach reads DOM from a user-launched local browser; only localhost CDP endpoints are accepted.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Handoff mode</label>
                <select
                  data-testid="browser-handoff-mode-input"
                  value={(form as any).browser?.handoff?.mode ?? 'snapshot'}
                  onChange={(e) => handleNestedChange('browser', 'handoff', 'mode', e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                >
                  <option value="snapshot">HTML snapshot</option>
                  <option value="cdp">Attach via CDP</option>
                  <option value="managed">Managed browser</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">CDP URL</label>
                <input
                  data-testid="browser-handoff-cdp-url-input"
                  type="text"
                  value={(form as any).browser?.handoff?.cdpUrl ?? ''}
                  onChange={(e) => handleNestedChange('browser', 'handoff', 'cdpUrl', e.target.value || undefined)}
                  placeholder="http://127.0.0.1:9222"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCdpTest}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100"
              >
                Test CDP connection
              </button>
              {cdpTestMessage && <span className="text-sm text-slate-600">{cdpTestMessage}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg bg-white p-6 shadow">
        <div>
          <h2 className="text-lg font-semibold">Selector Discovery (AO)</h2>
          <p className="mt-1 text-sm text-slate-500">
            AO URL, provider JSON, and model are required. Provider secrets are accepted here but are not returned by the API.
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
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Provider JSON</label>
          <textarea
            value={providerJson}
            onChange={(e) => setProviderJson(e.target.value)}
            rows={10}
            placeholder='{ "provider": { "opencode": { "name": "OpenCode", "models": { "deepseek-v4-flash-free": { "name": "deepseek-v4-flash-free" } } } } }'
            className="mt-1 block w-full rounded-md border-gray-300 font-mono text-xs shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          <div>Configured: {selectorDiscoveryConfig?.configured ? 'yes' : 'no'}</div>
          <div>Providers: {(selectorDiscoveryConfig?.providerIds ?? []).join(', ') || '-'}</div>
          <div>Models: {(selectorDiscoveryConfig?.modelIds ?? []).join(', ') || '-'}</div>
          <div>Fingerprint: {selectorDiscoveryConfig?.providerFingerprint ?? '-'}</div>
        </div>
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
        {selectorDiscoveryMessage && <div className="text-sm text-slate-700">{selectorDiscoveryMessage}</div>}
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
            disabled={!aoBaseUrl.trim() || !model.trim() || !providerJson.trim()}
            className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            Save selector-discovery
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

      <div className="flex space-x-4">
        <button
          onClick={handleSave}
          data-testid="settings-save-button"
          className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {text.settings.save}
        </button>
        <button
          onClick={handleReset}
          className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {text.settings.reset}
        </button>
      </div>
    </div>
  );
};
