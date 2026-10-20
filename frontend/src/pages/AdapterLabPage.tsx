import React, { useEffect, useMemo, useState } from 'react';
import type { AdapterCapabilityDetailResponse, AdapterFunctionCapability, AdapterImplementationResponse,
  AdapterFunctionTestResponse, AdapterResolveResponse, ChallengeHandoffJobSummary } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../api/client';
import { capabilityOrder, getUrlKind, isCapabilityAllowedForUrlKind, urlKindDescription,
  type AdapterChoice } from './lab/widgets';
import { useDraftFlow } from './lab/useDraftFlow';
import { ResolveSection } from './lab/sections/ResolveSection';
import { AdapterSelectSection } from './lab/sections/AdapterSelectSection';
import { ImplementationTestSection } from './lab/sections/ImplementationTestSection';
import { useI18n } from '../text/i18n';
import { formatText } from '../text/format';

export const AdapterLabPage: React.FC = () => <AdapterLabView model={useAdapterLabModel()} />;

function useAdapterLabModel() {
  const state = useAdapterLabState();
  const text = useI18n().text;
  const draft = useDraftFlow({ selectedAdapterId: state.selectedAdapterId,
    setLoading: state.setLoading, setError: state.setError });
  const derived = useLabDerived(state, draft);
  useChallengeJob(derived.challengeDiscoveryId, state.setChallengeJob);
  const context = { state, draft, derived, text };
  return { state, draft, derived, text, resolveUrl: () => resolveUrl(context),
    runTest: (id?: string) => runTest(context, id),
    openVerificationBrowser: () => openVerificationBrowser(context),
    continueAfterVerification: () => continueAfterVerification(context),
    handleAdapterChange: (id: string) => handleAdapterChange(context, id),
    handleCapabilityChange: (capability: AdapterFunctionCapability) => handleCapabilityChange(context, capability),
    handleFunctionChange: (id: string) => handleFunctionChange(context, id) };
}

function useAdapterLabState() {
  const [url, setUrl] = useState(''), [resolveResult, setResolveResult] = useState<AdapterResolveResponse | null>(null);
  const [adapterChoices, setAdapterChoices] = useState<AdapterChoice[]>([]), [selectedAdapterId, setSelectedAdapterId] = useState('');
  const [capabilityDetail, setCapabilityDetail] = useState<AdapterCapabilityDetailResponse | null>(null);
  const [selectedCapability, setSelectedCapability] = useState<AdapterFunctionCapability>('common');
  const [selectedFunctionId, setSelectedFunctionId] = useState('');
  const [implementation, setImplementation] = useState<AdapterImplementationResponse | null>(null);
  const [testResult, setTestResult] = useState<AdapterFunctionTestResponse | null>(null);
  const [challengeJob, setChallengeJob] = useState<ChallengeHandoffJobSummary | null>(null);
  const [verifiedChallengeId, setVerifiedChallengeId] = useState<string | null>(null);
  const [browserAction, setBrowserAction] = useState<string | null>(null), [loading, setLoading] = useState<string | null>(null);
  const [testStatusMessage, setTestStatusMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  return { url, setUrl, resolveResult, setResolveResult, adapterChoices, setAdapterChoices, selectedAdapterId,
    setSelectedAdapterId, capabilityDetail, setCapabilityDetail, selectedCapability, setSelectedCapability,
    selectedFunctionId, setSelectedFunctionId, implementation, setImplementation, testResult, setTestResult,
    challengeJob, setChallengeJob, verifiedChallengeId, setVerifiedChallengeId, browserAction, setBrowserAction,
    loading, setLoading, testStatusMessage, setTestStatusMessage, error, setError };
}

type LabState = ReturnType<typeof useAdapterLabState>;
type DraftFlow = ReturnType<typeof useDraftFlow>;

function useLabDerived(state: LabState, draft: DraftFlow) {
  const urlKind = useMemo(() => getUrlKind(state.url), [state.url]);
  const selectedCapabilityAllowed = isCapabilityAllowedForUrlKind(state.selectedCapability, urlKind);
  const functionsForCapability = useMemo(() => selectedCapabilityAllowed
    ? state.capabilityDetail?.functions.filter((item) => item.capability === state.selectedCapability) ?? [] : [],
  [state.capabilityDetail, state.selectedCapability, selectedCapabilityAllowed]);
  const selectedFunction = useMemo(() => state.capabilityDetail?.functions.find(
    (item) => item.id === state.selectedFunctionId), [state.capabilityDetail, state.selectedFunctionId]);
  const selectedSymbol = useMemo(() => state.implementation?.outline.find(
    (item) => item.id === state.selectedFunctionId), [state.implementation, state.selectedFunctionId]);
  return { urlKind, selectedCapabilityAllowed, functionsForCapability, selectedFunction, selectedSymbol,
    selectedFunctionAllowed: selectedFunction ? isCapabilityAllowedForUrlKind(selectedFunction.capability, urlKind) : false,
    editorContent: draft.draft ? draft.draftContent : state.implementation?.content ?? '',
    editorLanguage: draft.draft?.language ?? state.implementation?.language ?? 'markdown',
    challengeDiscoveryId: state.testResult?.challengeDiscoveryId,
    browserAlreadyOpen: ['browser_open', 'ready'].includes(state.challengeJob?.status ?? '') };
}

type LabDerived = ReturnType<typeof useLabDerived>;
type LabContext = { state: LabState; draft: DraftFlow; derived: LabDerived; text: ReturnType<typeof useI18n>['text'] };

function useChallengeJob(challengeId: string | undefined, setChallengeJob: (job: ChallengeHandoffJobSummary | null) => void) {
  useEffect(() => {
    if (!challengeId) { setChallengeJob(null); return; }
    let cancelled = false;
    void api.getChallengeDiscovery(challengeId).then((response) => {
      if (!cancelled) setChallengeJob(response.data);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [challengeId, setChallengeJob]);
}

async function resolveUrl(context: LabContext) {
  resetForResolve(context);
  try {
    const response = await api.resolveAdapter({ url: context.state.url,
      mode: context.state.url.includes('/mangaread/') ? 'chapters' : 'all' });
    context.state.setResolveResult(response.data);
    const choices = uniqueAdapterChoices(response.data);
    context.state.setAdapterChoices(choices);
    if (choices[0]) { context.state.setSelectedAdapterId(choices[0].id); await loadAdapter(context, choices[0].id); }
  } catch (error) {
    context.state.setError(getApiErrorMessage(error));
  } finally {
    context.state.setLoading(null);
  }
}

function resetForResolve(context: LabContext) {
  const { state, draft } = context;
  state.setError(null); state.setLoading('resolve'); state.setResolveResult(null); state.setAdapterChoices([]);
  state.setCapabilityDetail(null); state.setImplementation(null); draft.setDrafts([]); draft.clearDraftState();
  state.setTestResult(null); state.setChallengeJob(null); state.setVerifiedChallengeId(null);
}

function uniqueAdapterChoices(result: AdapterResolveResponse) {
  const choices = [result.adapter, result.matchedAdapter].filter(Boolean) as AdapterChoice[];
  return choices.filter((choice, index) => choices.findIndex((item) => item.id === choice.id) === index);
}

async function loadAdapter(context: LabContext, adapterId: string) {
  resetForAdapterLoad(context);
  try {
    const [capabilities, implementation, drafts] = await Promise.all([api.getAdapterCapabilities(adapterId),
      api.getAdapterImplementation(adapterId), api.getAdapterDrafts().catch(() => ({ data: { drafts: [] } }))]);
    context.state.setCapabilityDetail(capabilities.data);
    context.state.setImplementation(implementation.data);
    context.draft.setDrafts(drafts.data.drafts);
    applyInitialFunction(context, capabilities.data);
  } catch (error) {
    context.state.setError(getApiErrorMessage(error));
  } finally {
    context.state.setLoading(null);
  }
}

function resetForAdapterLoad(context: LabContext) {
  context.state.setError(null); context.state.setLoading('adapter'); context.state.setCapabilityDetail(null);
  context.state.setImplementation(null); context.draft.clearDraftState(); context.state.setTestResult(null);
  context.state.setChallengeJob(null); context.state.setVerifiedChallengeId(null);
}

function applyInitialFunction(context: LabContext, detail: AdapterCapabilityDetailResponse) {
  const capability = capabilityOrder.find((item) => isCapabilityAllowedForUrlKind(item, getUrlKind(context.state.url))
    && detail.functions.some((fn) => fn.capability === item && fn.implemented)) ?? 'common';
  const firstFunction = detail.functions.find((fn) => fn.capability === capability && fn.implemented);
  context.state.setSelectedCapability(capability);
  context.state.setSelectedFunctionId(firstFunction?.id ?? '');
}

async function runTest(context: LabContext, challengeId?: string) {
  if (!validateTestSelection(context)) return;
  const challengeIdForTest = challengeId ?? context.state.verifiedChallengeId ?? undefined;
  beginTest(context, challengeIdForTest);
  try {
    const draftId = await saveDraftForTest(context);
    const request = { url: context.state.url, challengeDiscoveryId: challengeIdForTest };
    const response = draftId ? await api.testAdapterDraftFunction(draftId, context.state.selectedFunctionId, request)
      : await api.testAdapterFunction(context.state.selectedAdapterId, context.state.selectedFunctionId, request);
    context.state.setTestResult(response.data);
  } catch (error) {
    context.state.setError(getApiErrorMessage(error));
  } finally {
    context.state.setLoading(null); context.state.setTestStatusMessage(null);
  }
}

function validateTestSelection(context: LabContext) {
  if (!context.state.selectedAdapterId || !context.state.selectedFunctionId) {
    context.state.setError(context.text.lab.selectAdapterFunction); return false;
  }
  if (!context.derived.selectedFunctionAllowed) {
    context.state.setError(urlKindDescription(context.derived.urlKind, context.text.lab)); return false;
  }
  return true;
}

function beginTest(context: LabContext, challengeId?: string) {
  context.state.setError(null); context.state.setLoading('test'); context.state.setTestResult(null);
  const message = challengeId ? context.text.lab.continueVerifiedTest : context.draft.draft
    ? context.text.lab.saveAndTestDraft
    : formatText(context.text.lab.strategyTestStatus, { strategy: context.text.lab.playwrightRender });
  context.state.setTestStatusMessage(message);
}

async function saveDraftForTest(context: LabContext) {
  if (!context.draft.draft) return undefined;
  if (!context.draft.hasUnsavedDraftChanges) return context.draft.draft.draft.draftId;
  const response = await api.saveAdapterDraftContent(context.draft.draft.draft.draftId,
    { content: context.draft.draftContent });
  context.draft.setDraft(response.data); context.draft.setDraftContent(response.data.content);
  context.draft.setSavedDraftContent(response.data.content);
  context.draft.setDrafts((current) => [response.data.draft,
    ...current.filter((item) => item.draftId !== response.data.draft.draftId)]);
  return response.data.draft.draftId;
}

async function openVerificationBrowser(context: LabContext) {
  const challengeId = context.derived.challengeDiscoveryId;
  if (!challengeId) return;
  context.state.setError(null); context.state.setBrowserAction('open');
  try {
    const response = await api.openChallengeDiscoveryBrowser(challengeId);
    context.state.setChallengeJob(response.data);
  } catch (error) {
    context.state.setError(getApiErrorMessage(error));
  } finally {
    context.state.setBrowserAction(null);
  }
}

async function continueAfterVerification(context: LabContext) {
  const challengeId = context.derived.challengeDiscoveryId;
  if (!challengeId) return;
  context.state.setError(null); context.state.setBrowserAction('continue');
  try {
    const response = await api.completeChallengeDiscoveryHumanVerification(challengeId,
      { settle: false, allowNavigate: false });
    context.state.setChallengeJob(response.data);
    if (response.data.status === 'ready') { context.state.setVerifiedChallengeId(challengeId); await runTest(context, challengeId); }
  } catch (error) {
    context.state.setError(getApiErrorMessage(error));
  } finally {
    context.state.setBrowserAction(null);
  }
}

function handleAdapterChange(context: LabContext, adapterId: string) {
  context.state.setSelectedAdapterId(adapterId); context.state.setVerifiedChallengeId(null);
  void loadAdapter(context, adapterId);
}

function handleCapabilityChange(context: LabContext, capability: AdapterFunctionCapability) {
  if (!isCapabilityAllowedForUrlKind(capability, context.derived.urlKind)) {
    context.state.setError(urlKindDescription(context.derived.urlKind, context.text.lab)); return;
  }
  context.state.setSelectedCapability(capability);
  const first = context.state.capabilityDetail?.functions.find((fn) => fn.capability === capability && fn.implemented);
  context.state.setSelectedFunctionId(first?.id ?? ''); context.state.setTestResult(null);
}

function handleFunctionChange(context: LabContext, functionId: string) {
  const fn = context.state.capabilityDetail?.functions.find((item) => item.id === functionId);
  if (fn && !isCapabilityAllowedForUrlKind(fn.capability, context.derived.urlKind)) {
    context.state.setError(urlKindDescription(context.derived.urlKind, context.text.lab)); return;
  }
  context.state.setSelectedFunctionId(functionId); context.state.setTestResult(null);
}

type LabModel = ReturnType<typeof useAdapterLabModel>;

function AdapterLabView({ model }: { model: LabModel }) {
  return <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <LabHeader text={model.text} />
    {model.state.error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{model.state.error}</div>}
    <ResolveSection url={model.state.url} setUrl={model.state.setUrl} resolveResult={model.state.resolveResult}
      resolveUrl={model.resolveUrl} loading={model.state.loading} />
    <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]"><LabAdapterSelect model={model} />
      <LabImplementationTest model={model} /></div>
  </div>;
}

function LabHeader({ text }: { text: LabModel['text'] }) {
  return <div className="mb-6"><p className="text-sm font-medium uppercase tracking-wide text-blue-600">{text.lab.title}</p>
    <h1 className="text-2xl font-bold text-gray-900">{text.lab.pageTitle}</h1>
    <p className="mt-2 text-sm text-gray-600">{text.lab.description}</p></div>;
}

function LabAdapterSelect({ model }: { model: LabModel }) {
  return <AdapterSelectSection adapterChoices={model.state.adapterChoices} selectedAdapterId={model.state.selectedAdapterId}
    handleAdapterChange={model.handleAdapterChange} draftsForSelectedAdapter={model.draft.draftsForSelectedAdapter}
    draft={model.draft.draft} openDraft={model.draft.openDraft} loading={model.state.loading}
    capabilityDetail={model.state.capabilityDetail} urlKind={model.derived.urlKind}
    selectedCapability={model.state.selectedCapability} handleCapabilityChange={model.handleCapabilityChange}
    selectedCapabilityAllowed={model.derived.selectedCapabilityAllowed}
    functionsForCapability={model.derived.functionsForCapability} selectedFunctionId={model.state.selectedFunctionId}
    handleFunctionChange={model.handleFunctionChange} />;
}

function LabImplementationTest({ model }: { model: LabModel }) {
  return <ImplementationTestSection selectedFunction={model.derived.selectedFunction}
    selectedSymbol={model.derived.selectedSymbol} capabilityDetail={model.state.capabilityDetail}
    runTest={model.runTest} loading={model.state.loading} draft={model.draft.draft}
    canExecuteDraft={model.draft.canExecuteDraft} selectedFunctionAllowed={model.derived.selectedFunctionAllowed}
    selectedFunctionId={model.state.selectedFunctionId} url={model.state.url}
    testStatusMessage={model.state.testStatusMessage} implementation={model.state.implementation}
    isDraftMode={model.draft.isDraftMode} hasUnsavedDraftChanges={model.draft.hasUnsavedDraftChanges}
    createDraft={model.draft.createDraft} saveDraft={model.draft.saveDraft} reloadSavedDraft={model.draft.reloadSavedDraft}
    resetDraft={model.draft.resetDraft} discardDraft={model.draft.discardDraft} draftContent={model.draft.draftContent}
    setDraftContent={model.draft.setDraftContent} draftViewMode={model.draft.draftViewMode}
    setDraftViewMode={model.draft.setDraftViewMode} handleFunctionChange={model.handleFunctionChange}
    editorContent={model.derived.editorContent} editorLanguage={model.derived.editorLanguage}
    testResult={model.state.testResult} challengeJob={model.state.challengeJob}
    browserAction={model.state.browserAction} browserAlreadyOpen={model.derived.browserAlreadyOpen}
    openVerificationBrowser={model.openVerificationBrowser} continueAfterVerification={model.continueAfterVerification} />;
}
