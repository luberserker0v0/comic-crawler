import React, { useEffect, useMemo, useState } from 'react';
import type {
  AdapterCapabilityDetailResponse,
  AdapterFunctionCapability,
  AdapterFunctionSourceResponse,
  AdapterFunctionTestResponse,
  AdapterResolveResponse,
  ChallengeHandoffJobSummary,
} from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../api/client';

const capabilityLabels: Record<AdapterFunctionCapability, string> = {
  common: 'Common',
  verification: 'Verification handoff',
  metadata: 'Manga metadata',
  chapterImages: 'Chapter images',
};

const capabilityOrder: AdapterFunctionCapability[] = ['common', 'verification', 'metadata', 'chapterImages'];

type AdapterChoice = NonNullable<AdapterResolveResponse['adapter']>;

export const AdapterLabPage: React.FC = () => {
  const [url, setUrl] = useState('');
  const [resolveResult, setResolveResult] = useState<AdapterResolveResponse | null>(null);
  const [adapterChoices, setAdapterChoices] = useState<AdapterChoice[]>([]);
  const [selectedAdapterId, setSelectedAdapterId] = useState('');
  const [capabilityDetail, setCapabilityDetail] = useState<AdapterCapabilityDetailResponse | null>(null);
  const [selectedCapability, setSelectedCapability] = useState<AdapterFunctionCapability>('common');
  const [selectedFunctionId, setSelectedFunctionId] = useState('');
  const [source, setSource] = useState<AdapterFunctionSourceResponse | null>(null);
  const [testResult, setTestResult] = useState<AdapterFunctionTestResponse | null>(null);
  const [challengeJob, setChallengeJob] = useState<ChallengeHandoffJobSummary | null>(null);
  const [browserExecutablePath, setBrowserExecutablePath] = useState('');
  const [browserAction, setBrowserAction] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const functionsForCapability = useMemo(() => {
    return capabilityDetail?.functions.filter((item) => item.capability === selectedCapability) ?? [];
  }, [capabilityDetail, selectedCapability]);

  const selectedFunction = useMemo(() => {
    return capabilityDetail?.functions.find((item) => item.id === selectedFunctionId);
  }, [capabilityDetail, selectedFunctionId]);

  const challengeDiscoveryId = testResult?.challengeDiscoveryId;

  useEffect(() => {
    if (!challengeDiscoveryId) {
      setChallengeJob(null);
      setBrowserExecutablePath('');
      return;
    }

    let cancelled = false;
    api.getChallengeDiscovery(challengeDiscoveryId)
      .then((response) => {
        if (!cancelled) setChallengeJob(response.data);
      })
      .catch(() => undefined);
    api.getChallengeBrowserOptions()
      .then((response) => {
        if (cancelled) return;
        const first = response.data?.browsers?.[0];
        if (first?.executablePath) {
          setBrowserExecutablePath((current) => current || first.executablePath);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [challengeDiscoveryId]);

  async function resolveUrl() {
    setError(null);
    setLoading('resolve');
    setResolveResult(null);
    setAdapterChoices([]);
    setCapabilityDetail(null);
    setSource(null);
    setTestResult(null);
    setChallengeJob(null);
    try {
      const response = await api.resolveAdapter({ url, mode: url.includes('/mangaread/') ? 'chapters' : 'all' });
      setResolveResult(response.data);
      const choices = [response.data.adapter, response.data.matchedAdapter].filter(Boolean) as AdapterChoice[];
      const unique = choices.filter((choice, index) => choices.findIndex((item) => item.id === choice.id) === index);
      setAdapterChoices(unique);
      if (unique[0]) {
        setSelectedAdapterId(unique[0].id);
        await loadAdapter(unique[0].id);
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function loadAdapter(adapterId: string) {
    setError(null);
    setLoading('adapter');
    setCapabilityDetail(null);
    setSource(null);
    setTestResult(null);
    setChallengeJob(null);
    try {
      const response = await api.getAdapterCapabilities(adapterId);
      setCapabilityDetail(response.data);
      const firstCapability = capabilityOrder.find((capability) =>
        response.data.functions.some((fn) => fn.capability === capability)
      ) ?? 'common';
      const firstFunction = response.data.functions.find((fn) => fn.capability === firstCapability);
      setSelectedCapability(firstCapability);
      setSelectedFunctionId(firstFunction?.id ?? '');
      if (firstFunction) {
        await loadSource(adapterId, firstFunction.id);
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function loadSource(adapterId = selectedAdapterId, functionId = selectedFunctionId) {
    if (!adapterId || !functionId) return;
    setError(null);
    setLoading('source');
    setSource(null);
    setTestResult(null);
    setChallengeJob(null);
    try {
      const response = await api.getAdapterFunctionSource(adapterId, functionId);
      setSource(response.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function runTest(challengeId?: string) {
    if (!selectedAdapterId || !selectedFunctionId) return;
    setError(null);
    setLoading('test');
    setTestResult(null);
    try {
      const response = await api.testAdapterFunction(selectedAdapterId, selectedFunctionId, {
        url,
        challengeDiscoveryId: challengeId,
      });
      setTestResult(response.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function openVerificationBrowser() {
    if (!challengeDiscoveryId) return;
    setError(null);
    setBrowserAction('open');
    try {
      const response = await api.openChallengeDiscoveryExternalBrowser(challengeDiscoveryId, {
        executablePath: browserExecutablePath || undefined,
      });
      setChallengeJob(response.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBrowserAction(null);
    }
  }

  async function continueAfterVerification() {
    if (!challengeDiscoveryId) return;
    setError(null);
    setBrowserAction('continue');
    try {
      const response = await api.completeChallengeDiscoveryHumanVerification(challengeDiscoveryId);
      setChallengeJob(response.data);
      if (response.data.status === 'ready') {
        await runTest(challengeDiscoveryId);
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBrowserAction(null);
    }
  }

  function handleAdapterChange(adapterId: string) {
    setSelectedAdapterId(adapterId);
    void loadAdapter(adapterId);
  }

  function handleCapabilityChange(capability: AdapterFunctionCapability) {
    setSelectedCapability(capability);
    const firstFunction = capabilityDetail?.functions.find((fn) => fn.capability === capability);
    setSelectedFunctionId(firstFunction?.id ?? '');
    if (firstFunction) void loadSource(selectedAdapterId, firstFunction.id);
  }

  function handleFunctionChange(functionId: string) {
    setSelectedFunctionId(functionId);
    void loadSource(selectedAdapterId, functionId);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-blue-600">Adapter Lab</p>
        <h1 className="text-2xl font-bold text-gray-900">Adapter test lab</h1>
        <p className="mt-2 text-sm text-gray-600">
          Enter a URL, resolve the matching adapter, inspect its fine-grained capability functions, and run a live test.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded-lg bg-white p-5 shadow">
        <label htmlFor="adapter-lab-url" className="block text-sm font-medium text-gray-700">
          Website or chapter URL
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="adapter-lab-url"
            data-testid="adapter-lab-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://kuronavi.one/manga/example"
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
          <button
            type="button"
            data-testid="adapter-lab-resolve"
            onClick={resolveUrl}
            disabled={!url || loading === 'resolve'}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {loading === 'resolve' ? 'Resolving...' : 'Resolve'}
          </button>
        </div>
        {resolveResult && (
          <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
            <div>Status: <span className="font-medium">{resolveResult.status}</span></div>
            <div>Host: {resolveResult.hostname}</div>
            <div>Required: Metadata {resolveResult.requiredCapabilities.metadata ? 'O' : 'X'} / Images {resolveResult.requiredCapabilities.chapterImages ? 'O' : 'X'}</div>
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <section className="space-y-4 rounded-lg bg-white p-5 shadow">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">1. Adapter</h2>
            {adapterChoices.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">Resolve a URL to choose an adapter.</p>
            ) : (
              <select
                value={selectedAdapterId}
                onChange={(event) => handleAdapterChange(event.target.value)}
                className="mt-2 block w-full rounded-md border-gray-300 text-sm shadow-sm"
              >
                {adapterChoices.map((adapter) => (
                  <option key={adapter.id} value={adapter.id}>
                    {adapter.name} ({adapter.id})
                  </option>
                ))}
              </select>
            )}
          </div>

          {capabilityDetail && (
            <>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">2. Capability</h2>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {capabilityOrder.map((capability) => {
                    const implemented = capabilityDetail.functions.some((fn) => fn.capability === capability && fn.implemented);
                    return (
                      <button
                        key={capability}
                        type="button"
                        onClick={() => handleCapabilityChange(capability)}
                        className={`rounded-md border px-3 py-2 text-left text-sm ${
                          selectedCapability === capability ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                        }`}
                      >
                        <span className="font-medium">{capabilityLabels[capability]}</span>
                        <span className={implemented ? 'ml-2 text-emerald-700' : 'ml-2 text-rose-700'}>
                          {implemented ? 'O' : 'X'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-gray-900">3. Function</h2>
                <div className="mt-2 space-y-2">
                  {functionsForCapability.map((fn) => (
                    <button
                      key={fn.id}
                      type="button"
                      onClick={() => handleFunctionChange(fn.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                        selectedFunctionId === fn.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="font-mono text-xs">{fn.label}</div>
                      <div className={fn.implemented ? 'text-emerald-700' : 'text-rose-700'}>
                        {fn.implemented ? 'Implemented' : 'Not implemented'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>

        <section className="rounded-lg bg-white p-5 shadow">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">4. Source / Test</h2>
              {selectedFunction && (
                <p className="mt-1 text-sm text-gray-600">
                  {selectedFunction.notes} Input kind: <span className="font-medium">{selectedFunction.inputKind}</span>
                </p>
              )}
            </div>
            <button
              type="button"
              data-testid="adapter-lab-test"
              onClick={() => void runTest()}
              disabled={!selectedFunctionId || !url || loading === 'test'}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-gray-300"
            >
              {loading === 'test' ? 'Testing...' : 'Test'}
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
              <span>{source?.sourceKind ?? 'source'}</span>
              <span>{source?.language ?? ''}</span>
            </div>
            <pre className="max-h-[480px] overflow-auto rounded-md bg-gray-950 p-4 text-xs text-gray-100">
              {loading === 'source' ? 'Loading source...' : source?.source ?? 'Select a function to view source.'}
            </pre>
            {source?.notes && <p className="mt-2 text-xs text-gray-500">{source.notes}</p>}
          </div>

          {testResult && (
            <div className={`mt-4 rounded-md border p-4 text-sm ${
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
                          disabled={browserAction === 'open'}
                          className="rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:bg-gray-300"
                        >
                          {browserAction === 'open' ? 'Opening...' : 'Open browser for verification'}
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
                <pre className="mt-3 overflow-auto rounded bg-white p-3 text-xs text-gray-800">
                  {JSON.stringify(testResult.resultSummary, null, 2)}
                </pre>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
