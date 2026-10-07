import React, { useEffect, useMemo, useState } from 'react';
import type {
  AdapterCapabilityDetailResponse,
  AdapterFunctionCapability,
  AdapterImplementationResponse,
  AdapterFunctionTestResponse,
  AdapterResolveResponse,
  ChallengeHandoffJobSummary,
} from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../api/client';
import {
  capabilityOrder,
  getUrlKind,
  isCapabilityAllowedForUrlKind,
  urlKindDescription,
  type AdapterChoice,
} from './lab/widgets';
import { useDraftFlow } from './lab/useDraftFlow';
import { ResolveSection } from './lab/sections/ResolveSection';
import { AdapterSelectSection } from './lab/sections/AdapterSelectSection';
import { ImplementationTestSection } from './lab/sections/ImplementationTestSection';

export const AdapterLabPage: React.FC = () => {
  const [url, setUrl] = useState('');
  const [resolveResult, setResolveResult] = useState<AdapterResolveResponse | null>(null);
  const [adapterChoices, setAdapterChoices] = useState<AdapterChoice[]>([]);
  const [selectedAdapterId, setSelectedAdapterId] = useState('');
  const [capabilityDetail, setCapabilityDetail] = useState<AdapterCapabilityDetailResponse | null>(null);
  const [selectedCapability, setSelectedCapability] = useState<AdapterFunctionCapability>('common');
  const [selectedFunctionId, setSelectedFunctionId] = useState('');
  const [implementation, setImplementation] = useState<AdapterImplementationResponse | null>(null);
  const [testResult, setTestResult] = useState<AdapterFunctionTestResponse | null>(null);
  const [challengeJob, setChallengeJob] = useState<ChallengeHandoffJobSummary | null>(null);
  const [verifiedChallengeId, setVerifiedChallengeId] = useState<string | null>(null);
  const [browserExecutablePath, setBrowserExecutablePath] = useState('');
  const [browserAction, setBrowserAction] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [testStatusMessage, setTestStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    setDrafts,
    draft,
    setDraft,
    draftContent,
    setDraftContent,
    setSavedDraftContent,
    draftViewMode,
    setDraftViewMode,
    draftsForSelectedAdapter,
    isDraftMode,
    hasUnsavedDraftChanges,
    canExecuteDraft,
    clearDraftState,
    createDraft,
    openDraft,
    saveDraft,
    reloadSavedDraft,
    resetDraft,
    discardDraft,
  } = useDraftFlow({ selectedAdapterId, setLoading, setError });
  const urlKind = useMemo(() => getUrlKind(url), [url]);
  const selectedCapabilityAllowed = isCapabilityAllowedForUrlKind(selectedCapability, urlKind);

  const functionsForCapability = useMemo(() => {
    if (!selectedCapabilityAllowed) return [];
    return capabilityDetail?.functions.filter((item) => item.capability === selectedCapability) ?? [];
  }, [capabilityDetail, selectedCapability, selectedCapabilityAllowed]);

  const selectedFunction = useMemo(() => {
    return capabilityDetail?.functions.find((item) => item.id === selectedFunctionId);
  }, [capabilityDetail, selectedFunctionId]);
  const selectedFunctionAllowed = selectedFunction
    ? isCapabilityAllowedForUrlKind(selectedFunction.capability, urlKind)
    : false;

  const selectedSymbol = useMemo(() => {
    return implementation?.outline.find((item) => item.id === selectedFunctionId);
  }, [implementation, selectedFunctionId]);

  const editorContent = draft ? draftContent : implementation?.content ?? '';
  const editorLanguage = draft?.language ?? implementation?.language ?? 'markdown';

  const challengeDiscoveryId = testResult?.challengeDiscoveryId;
  const browserAlreadyOpen = challengeJob?.status === 'external_browser_open'
    || challengeJob?.status === 'external_browser_opening'
    || challengeJob?.status === 'ready';

  /* eslint-disable react-hooks/set-state-in-effect -- TODO(frontend-effect-cleanup): challenge-status fetch with sync reset; remodel to render-time derivation */
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
  /* eslint-enable react-hooks/set-state-in-effect */

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
        isCapabilityAllowedForUrlKind(capability, getUrlKind(url)) &&
        response.data.functions.some((fn) => fn.capability === capability && fn.implemented)
      ) ?? 'common';
      const firstFunction = response.data.functions.find((fn) => fn.capability === firstCapability && fn.implemented);
      setSelectedCapability(firstCapability);
      setSelectedFunctionId(firstFunction?.id ?? '');
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
    if (!selectedFunctionAllowed) {
      setError(urlKind === 'manga'
        ? 'This is a manga catalog URL. Use a chapter URL to test Chapter Images.'
        : urlKind === 'chapter'
          ? 'This is a chapter URL. Use a manga catalog URL to test Metadata.'
          : 'Enter a manga catalog URL or chapter URL before testing adapter functions.');
      return;
    }
    if (draft && !canExecuteDraft) {
      setError('Project-source TypeScript draft execution is not supported yet. Save the draft, then test the active adapter or wait for TS draft sandbox support.');
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
    if (!isCapabilityAllowedForUrlKind(capability, urlKind)) {
      setError(urlKindDescription(urlKind));
      return;
    }
    setSelectedCapability(capability);
    const firstFunction = capabilityDetail?.functions.find((fn) => fn.capability === capability && fn.implemented);
    setSelectedFunctionId(firstFunction?.id ?? '');
    setTestResult(null);
  }

  function handleFunctionChange(functionId: string) {
    const fn = capabilityDetail?.functions.find((item) => item.id === functionId);
    if (fn && !isCapabilityAllowedForUrlKind(fn.capability, urlKind)) {
      setError(urlKindDescription(urlKind));
      return;
    }
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

      <ResolveSection
        url={url}
        setUrl={setUrl}
        resolveResult={resolveResult}
        resolveUrl={resolveUrl}
        loading={loading}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <AdapterSelectSection
          adapterChoices={adapterChoices}
          selectedAdapterId={selectedAdapterId}
          handleAdapterChange={handleAdapterChange}
          draftsForSelectedAdapter={draftsForSelectedAdapter}
          draft={draft}
          openDraft={openDraft}
          loading={loading}
          capabilityDetail={capabilityDetail}
          urlKind={urlKind}
          selectedCapability={selectedCapability}
          handleCapabilityChange={handleCapabilityChange}
          selectedCapabilityAllowed={selectedCapabilityAllowed}
          functionsForCapability={functionsForCapability}
          selectedFunctionId={selectedFunctionId}
          handleFunctionChange={handleFunctionChange}
        />

        <ImplementationTestSection
          selectedFunction={selectedFunction}
          selectedSymbol={selectedSymbol}
          capabilityDetail={capabilityDetail}
          runTest={runTest}
          loading={loading}
          draft={draft}
          canExecuteDraft={canExecuteDraft}
          selectedFunctionAllowed={selectedFunctionAllowed}
          selectedFunctionId={selectedFunctionId}
          url={url}
          testStatusMessage={testStatusMessage}
          implementation={implementation}
          isDraftMode={isDraftMode}
          hasUnsavedDraftChanges={hasUnsavedDraftChanges}
          createDraft={createDraft}
          saveDraft={saveDraft}
          reloadSavedDraft={reloadSavedDraft}
          resetDraft={resetDraft}
          discardDraft={discardDraft}
          draftContent={draftContent}
          setDraftContent={setDraftContent}
          draftViewMode={draftViewMode}
          setDraftViewMode={setDraftViewMode}
          handleFunctionChange={handleFunctionChange}
          editorContent={editorContent}
          editorLanguage={editorLanguage}
          testResult={testResult}
          challengeJob={challengeJob}
          browserExecutablePath={browserExecutablePath}
          setBrowserExecutablePath={setBrowserExecutablePath}
          browserAction={browserAction}
          browserAlreadyOpen={browserAlreadyOpen}
          openVerificationBrowser={openVerificationBrowser}
          continueAfterVerification={continueAfterVerification}
        />
      </div>
    </div>
  );
};
