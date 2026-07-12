import React, { useEffect, useMemo, useState } from 'react';
import type {
  AdapterCapabilityDetailResponse,
  AdapterDraftDetailResponse,
  AdapterDraftSummary,
  AdapterFunctionCapability,
  AdapterImplementationResponse,
  AdapterImplementationSymbol,
  AdapterFunctionTestResponse,
  AdapterResolveResponse,
  ChallengeHandoffJobSummary,
} from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../api/client';
import { ImplementationDiffEditor, ImplementationEditor } from '../components/ImplementationEditor';

const capabilityLabels: Record<AdapterFunctionCapability, string> = {
  common: 'Common',
  verification: 'Verification handoff',
  metadata: 'Manga metadata',
  chapterImages: 'Chapter images',
};

const capabilityOrder: AdapterFunctionCapability[] = ['common', 'verification', 'metadata', 'chapterImages'];

type AdapterChoice = NonNullable<AdapterResolveResponse['adapter']>;

function formatLineRange(symbol: AdapterImplementationSymbol): string {
  if (!symbol.startLine) return '';
  if (!symbol.endLine || symbol.endLine === symbol.startLine) return `L${symbol.startLine}`;
  return `L${symbol.startLine}-L${symbol.endLine}`;
}

interface ChapterSummaryItem {
  id?: string;
  title?: string;
  url?: string;
  number?: number;
}

function isChapterSummaryItem(value: unknown): value is ChapterSummaryItem {
  return typeof value === 'object' && value !== null && (
    'title' in value || 'url' in value || 'id' in value || 'number' in value
  );
}

function getChapterSummaryItems(summary: Record<string, unknown> | undefined): ChapterSummaryItem[] {
  if (!summary || !Array.isArray(summary.chapters)) return [];
  return summary.chapters.filter(isChapterSummaryItem);
}

function renderChapterRows(chapters: ChapterSummaryItem[]) {
  return chapters.map((chapter, index) => (
    <li key={`${chapter.id ?? chapter.url ?? index}`} className="rounded border border-gray-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-gray-900">
          {chapter.title || chapter.id || `Chapter ${index + 1}`}
        </span>
        {typeof chapter.number === 'number' && (
          <span className="text-[11px] uppercase tracking-wide text-gray-500">#{chapter.number}</span>
        )}
      </div>
      {chapter.url && (
        <div className="mt-1 break-all text-xs text-gray-600">{chapter.url}</div>
      )}
    </li>
  ));
}

const AdapterFunctionResultSummary: React.FC<{ summary: Record<string, unknown> }> = ({ summary }) => {
  const chapters = getChapterSummaryItems(summary);
  if (chapters.length > 0) {
    const chapterCount = typeof summary.chapterCount === 'number' ? summary.chapterCount : chapters.length;
    return (
      <div className="mt-3 rounded bg-white p-3 text-xs text-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">Extracted chapters</div>
            <div className="text-gray-600">{chapterCount} chapters returned by the adapter function.</div>
          </div>
        </div>
        <ol className="mt-3 space-y-2">{renderChapterRows(chapters.slice(0, 5))}</ol>
        {chapters.length > 5 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-blue-700">
              Show all {chapters.length} chapters
            </summary>
            <ol className="mt-3 max-h-96 space-y-2 overflow-auto pr-1">
              {renderChapterRows(chapters)}
            </ol>
          </details>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-gray-600">Raw result JSON</summary>
          <pre className="mt-2 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-800">
            {JSON.stringify(summary, null, 2)}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <pre className="mt-3 overflow-auto rounded bg-white p-3 text-xs text-gray-800">
      {JSON.stringify(summary, null, 2)}
    </pre>
  );
};

export const AdapterLabPage: React.FC = () => {
  const [url, setUrl] = useState('');
  const [resolveResult, setResolveResult] = useState<AdapterResolveResponse | null>(null);
  const [adapterChoices, setAdapterChoices] = useState<AdapterChoice[]>([]);
  const [selectedAdapterId, setSelectedAdapterId] = useState('');
  const [capabilityDetail, setCapabilityDetail] = useState<AdapterCapabilityDetailResponse | null>(null);
  const [selectedCapability, setSelectedCapability] = useState<AdapterFunctionCapability>('common');
  const [selectedFunctionId, setSelectedFunctionId] = useState('');
  const [implementation, setImplementation] = useState<AdapterImplementationResponse | null>(null);
  const [drafts, setDrafts] = useState<AdapterDraftSummary[]>([]);
  const [draft, setDraft] = useState<AdapterDraftDetailResponse | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [savedDraftContent, setSavedDraftContent] = useState('');
  const [testResult, setTestResult] = useState<AdapterFunctionTestResponse | null>(null);
  const [draftViewMode, setDraftViewMode] = useState<'edit' | 'diff'>('edit');
  const [challengeJob, setChallengeJob] = useState<ChallengeHandoffJobSummary | null>(null);
  const [verifiedChallengeId, setVerifiedChallengeId] = useState<string | null>(null);
  const [browserExecutablePath, setBrowserExecutablePath] = useState('');
  const [browserAction, setBrowserAction] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [testStatusMessage, setTestStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const functionsForCapability = useMemo(() => {
    return capabilityDetail?.functions.filter((item) => item.capability === selectedCapability) ?? [];
  }, [capabilityDetail, selectedCapability]);

  const selectedFunction = useMemo(() => {
    return capabilityDetail?.functions.find((item) => item.id === selectedFunctionId);
  }, [capabilityDetail, selectedFunctionId]);

  const selectedSymbol = useMemo(() => {
    return implementation?.outline.find((item) => item.id === selectedFunctionId);
  }, [implementation, selectedFunctionId]);

  const isDraftMode = Boolean(draft);
  const hasUnsavedDraftChanges = Boolean(draft && draftContent !== savedDraftContent);
  const canExecuteDraft = draft?.draft.sourceKind === 'dynamic-manifest';
  const editorContent = draft ? draftContent : implementation?.content ?? '';
  const editorLanguage = draft?.language ?? implementation?.language ?? 'markdown';
  const draftsForSelectedAdapter = useMemo(() => (
    drafts.filter((item) => item.baseAdapterId === selectedAdapterId)
  ), [drafts, selectedAdapterId]);

  const challengeDiscoveryId = testResult?.challengeDiscoveryId;
  const browserAlreadyOpen = challengeJob?.status === 'external_browser_open'
    || challengeJob?.status === 'external_browser_opening'
    || challengeJob?.status === 'ready';

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
    setImplementation(null);
    setDrafts([]);
    clearDraftState();
    setTestResult(null);
    setChallengeJob(null);
    setVerifiedChallengeId(null);
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
    setImplementation(null);
    clearDraftState();
    setTestResult(null);
    setChallengeJob(null);
    setVerifiedChallengeId(null);
    try {
      const response = await api.getAdapterCapabilities(adapterId);
      const implementationResponse = await api.getAdapterImplementation(adapterId);
      const draftListResponse = await api.getAdapterDrafts();
      setCapabilityDetail(response.data);
      setImplementation(implementationResponse.data);
      setDrafts(draftListResponse.data.drafts);
      const firstCapability = capabilityOrder.find((capability) =>
        response.data.functions.some((fn) => fn.capability === capability)
      ) ?? 'common';
      const firstFunction = response.data.functions.find((fn) => fn.capability === firstCapability);
      setSelectedCapability(firstCapability);
      setSelectedFunctionId(firstFunction?.id ?? '');
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  function clearDraftState() {
    setDraft(null);
    setDraftContent('');
    setSavedDraftContent('');
    setDraftViewMode('edit');
  }

  async function createDraft() {
    if (!selectedAdapterId) return;
    setError(null);
    setLoading('draft');
    try {
      const response = await api.createAdapterDraft(selectedAdapterId);
      setDraft(response.data);
      setDraftContent(response.data.content);
      setSavedDraftContent(response.data.content);
      setDrafts((current) => [response.data.draft, ...current.filter((item) => item.draftId !== response.data.draft.draftId)]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function openDraft(draftId: string) {
    setError(null);
    setLoading('draft-open');
    try {
      const response = await api.getAdapterDraft(draftId);
      setDraft(response.data);
      setDraftContent(response.data.content);
      setSavedDraftContent(response.data.content);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setError(null);
    setLoading('draft-save');
    try {
      const response = await api.saveAdapterDraftContent(draft.draft.draftId, { content: draftContent });
      setDraft(response.data);
      setDraftContent(response.data.content);
      setSavedDraftContent(response.data.content);
      setDrafts((current) => [response.data.draft, ...current.filter((item) => item.draftId !== response.data.draft.draftId)]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  function reloadSavedDraft() {
    setDraftContent(savedDraftContent);
  }

  async function resetDraft() {
    if (!draft) return;
    setError(null);
    setLoading('draft-reset');
    try {
      const response = await api.resetAdapterDraft(draft.draft.draftId);
      setDraft(response.data);
      setDraftContent(response.data.content);
      setSavedDraftContent(response.data.content);
      setDrafts((current) => [response.data.draft, ...current.filter((item) => item.draftId !== response.data.draft.draftId)]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function discardDraft() {
    if (!draft) return;
    setError(null);
    setLoading('draft-discard');
    try {
      await api.discardAdapterDraft(draft.draft.draftId);
      setDrafts((current) => current.filter((item) => item.draftId !== draft.draft.draftId));
      clearDraftState();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function runTest(challengeId?: string) {
    if (!selectedAdapterId || !selectedFunctionId) {
      setError('Select an adapter and function before running the test.');
      return;
    }
    if (draft && !canExecuteDraft) {
      setError('Built-in TypeScript draft execution is not supported yet. Save the draft, then test the active adapter or wait for TS draft sandbox support.');
      return;
    }
    const adapterDomStrategy = capabilityDetail?.adapter.parseMode === 'dynamic' || capabilityDetail?.adapter.parseMode === 'interactive'
      ? 'Playwright render'
      : 'Static fetch';
    const challengeIdForTest = challengeId ?? (
      capabilityDetail?.adapter.parseMode === 'dynamic' || capabilityDetail?.adapter.parseMode === 'interactive'
        ? verifiedChallengeId ?? undefined
        : undefined
    );
    setError(null);
    setLoading('test');
    setTestStatusMessage(challengeIdForTest
      ? 'Continuing with the verified browser page, then running the selected extraction function...'
      : draft
        ? 'Testing the saved dynamic manifest draft. Unsaved changes will be saved before the test.'
        : `Using adapter DOM strategy: ${adapterDomStrategy}. If verification is detected, handoff will be shown here.`);
    setTestResult(null);
    try {
      let draftIdForTest = draft?.draft.draftId;
      if (draft && hasUnsavedDraftChanges) {
        const saved = await api.saveAdapterDraftContent(draft.draft.draftId, { content: draftContent });
        setDraft(saved.data);
        setDraftContent(saved.data.content);
        setSavedDraftContent(saved.data.content);
        setDrafts((current) => [saved.data.draft, ...current.filter((item) => item.draftId !== saved.data.draft.draftId)]);
        draftIdForTest = saved.data.draft.draftId;
      }
      const request = {
        url,
        challengeDiscoveryId: challengeIdForTest,
      };
      const response = draftIdForTest
        ? await api.testAdapterDraftFunction(draftIdForTest, selectedFunctionId, request)
        : await api.testAdapterFunction(selectedAdapterId, selectedFunctionId, request);
      setTestResult(response.data);
      setTestStatusMessage(null);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(null);
      setTestStatusMessage(null);
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
      const response = await api.completeChallengeDiscoveryHumanVerification(challengeDiscoveryId, {
        settle: false,
        allowNavigate: false,
      });
      setChallengeJob(response.data);
      if (response.data.status === 'ready') {
        setVerifiedChallengeId(challengeDiscoveryId);
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
    setVerifiedChallengeId(null);
    void loadAdapter(adapterId);
  }

  function handleCapabilityChange(capability: AdapterFunctionCapability) {
    setSelectedCapability(capability);
    const firstFunction = capabilityDetail?.functions.find((fn) => fn.capability === capability);
    setSelectedFunctionId(firstFunction?.id ?? '');
    setTestResult(null);
  }

  function handleFunctionChange(functionId: string) {
    setSelectedFunctionId(functionId);
    setTestResult(null);
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

          {selectedAdapterId && draftsForSelectedAdapter.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <h3 className="text-sm font-semibold text-amber-950">Saved drafts</h3>
              <div className="mt-2 space-y-2">
                {draftsForSelectedAdapter.map((item) => (
                  <button
                    key={item.draftId}
                    type="button"
                    onClick={() => void openDraft(item.draftId)}
                    disabled={loading === 'draft-open'}
                    className={`w-full rounded border px-2 py-2 text-left text-xs ${
                      draft?.draft.draftId === item.draftId
                        ? 'border-amber-500 bg-white text-amber-950'
                        : 'border-amber-200 bg-white/70 text-amber-900 hover:bg-white'
                    }`}
                  >
                    <div className="font-mono">{item.draftId}</div>
                    <div className="mt-1 text-amber-700">{item.sourceKind} · updated {new Date(item.updatedAt).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

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
              disabled={!selectedFunctionId || !url || loading === 'test' || Boolean(draft && !canExecuteDraft)}
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
                        : `Draft ${draft?.draft.draftId} is stored under user adapter-drafts. Built-in TypeScript draft execution is not supported yet.`
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
      </div>
    </div>
  );
};
