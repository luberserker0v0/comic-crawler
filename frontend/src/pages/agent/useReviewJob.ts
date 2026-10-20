import { useEffect, useState } from 'react';
import type { AdapterCapabilityDetailResponse, AdapterDraftDetailResponse, AdapterFunctionTestResponse,
  AdapterImplementationResponse, SelectorDiscoveryJobSummary } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';
import { useI18n } from '../../text/i18n';
import { defaultTestUrlForFunction } from './widgets';

type ReviewOptions = { fetchBuildJobs?: () => Promise<void>; fetchSiteAdapters?: () => Promise<void>;
  fetchAdapters?: () => Promise<void> };

export function useReviewJob(options: ReviewOptions = {}) {
  const state = useReviewState();
  const context = { state, options, text: useI18n().text };
  useRevisionPolling(state);
  return { ...state, openReviewJob: (id: string) => openReview(context, id),
    createEditableReviewDraft: () => createDraft(context), saveEditableReviewDraft: () => saveDraft(context),
    resetEditableReviewDraft: () => resetDraft(state), requestFunctionRevision: () => requestRevision(context),
    retryFunctionRevision: (id: string) => retryRevision(context, id), runReviewFunctionTest: () => runFunctionTest(context),
    approveReviewJob: () => approveReview(context), rejectReviewJob: () => rejectReview(context),
    closeReview: () => closeReview(state) };
}

function useReviewState() {
  const [reviewJob, setReviewJob] = useState<SelectorDiscoveryJobSummary | null>(null), [reviewImplementation, setReviewImplementation] = useState<AdapterImplementationResponse | null>(null);
  const [reviewCapabilities, setReviewCapabilities] = useState<AdapterCapabilityDetailResponse | null>(null), [reviewDraft, setReviewDraft] = useState<AdapterDraftDetailResponse | null>(null);
  const [reviewDraftContent, setReviewDraftContent] = useState('');
  const [savedReviewDraftContent, setSavedReviewDraftContent] = useState('');
  const [selectedReviewFunctionId, setSelectedReviewFunctionId] = useState('');
  const [reviewTestUrl, setReviewTestUrl] = useState('');
  const [reviewTestResult, setReviewTestResult] = useState<AdapterFunctionTestResponse | null>(null);
  const [functionRevisionInstruction, setFunctionRevisionInstruction] = useState('');
  const [functionRevisionModelMode, setFunctionRevisionModelMode] = useState<'current-settings' | 'previous-task'>('current-settings');
  const [functionRevisionMessage, setFunctionRevisionMessage] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null), [reviewLoading, setReviewLoading]
    = useState<'load' | 'test' | 'approve' | 'reject' | 'edit' | 'save' | 'revision' | null>(null);
  return { reviewJob, setReviewJob, reviewImplementation, setReviewImplementation, reviewCapabilities,
    setReviewCapabilities, reviewDraft, setReviewDraft, reviewDraftContent, setReviewDraftContent,
    savedReviewDraftContent, setSavedReviewDraftContent, selectedReviewFunctionId, setSelectedReviewFunctionId,
    reviewTestUrl, setReviewTestUrl, reviewTestResult, setReviewTestResult, functionRevisionInstruction,
    setFunctionRevisionInstruction, functionRevisionModelMode, setFunctionRevisionModelMode,
    functionRevisionMessage, setFunctionRevisionMessage, reviewError, setReviewError, reviewLoading, setReviewLoading };
}

type ReviewState = ReturnType<typeof useReviewState>;
type ReviewContext = { state: ReviewState; options: ReviewOptions; text: ReturnType<typeof useI18n>['text'] };

async function openReview(context: ReviewContext, id: string) {
  beginReviewAction(context.state, 'load', true);
  try {
    const responses = await Promise.all([api.getSelectorDiscovery(id),
      api.getSelectorDiscoveryImplementation(id), api.getSelectorDiscoveryCapabilities(id)]);
    applyOpenedReview(context.state, responses[0].data, responses[1].data, responses[2].data);
    requestAnimationFrame(() => document.getElementById('review-panel')?.scrollIntoView(
      { behavior: 'smooth', block: 'start' }));
  } catch (error) {
    context.state.setReviewError(getApiErrorMessage(error));
  } finally {
    context.state.setReviewLoading(null);
  }
}

function applyOpenedReview(state: ReviewState, job: SelectorDiscoveryJobSummary,
  implementation: AdapterImplementationResponse, capabilities: AdapterCapabilityDetailResponse) {
  const firstFunctionId = capabilities.functions.find((item) => item.implemented)?.id ?? '';
  state.setReviewJob(job); state.setReviewImplementation(implementation); state.setReviewCapabilities(capabilities);
  state.setReviewDraft(null); state.setReviewDraftContent(''); state.setSavedReviewDraftContent('');
  state.setFunctionRevisionInstruction(''); state.setFunctionRevisionMessage(null);
  state.setSelectedReviewFunctionId(firstFunctionId);
  state.setReviewTestUrl(firstFunctionId ? defaultTestUrlForFunction(job, firstFunctionId) : job.normalizedUrl);
}

async function createDraft(context: ReviewContext) {
  if (!context.state.reviewJob) return;
  beginReviewAction(context.state, 'edit', true);
  try {
    const response = await api.createSelectorDiscoveryDraft(context.state.reviewJob.id);
    applyDraft(context.state, response.data);
  } catch (error) {
    context.state.setReviewError(getApiErrorMessage(error));
  } finally {
    context.state.setReviewLoading(null);
  }
}

async function saveDraft(context: ReviewContext) {
  if (!context.state.reviewDraft) return;
  beginReviewAction(context.state, 'save');
  try {
    const response = await api.saveAdapterDraftContent(context.state.reviewDraft.draft.draftId,
      { content: context.state.reviewDraftContent });
    applyDraft(context.state, response.data);
  } catch (error) {
    context.state.setReviewError(getApiErrorMessage(error));
  } finally {
    context.state.setReviewLoading(null);
  }
}

function applyDraft(state: ReviewState, draft: AdapterDraftDetailResponse) {
  state.setReviewDraft(draft);
  state.setReviewDraftContent(draft.content);
  state.setSavedReviewDraftContent(draft.content);
}

function resetDraft(state: ReviewState) {
  state.setReviewDraftContent(state.reviewImplementation?.content ?? '');
  state.setReviewTestResult(null);
}

async function requestRevision(context: ReviewContext) {
  const { state } = context;
  if (!state.reviewJob || !state.selectedReviewFunctionId) return;
  beginRevision(state);
  try {
    const response = await api.requestSelectorDiscoveryFunctionRevision(state.reviewJob.id,
      state.selectedReviewFunctionId, { functionId: state.selectedReviewFunctionId,
        instruction: state.functionRevisionInstruction,
        currentSource: state.reviewDraft ? state.reviewDraftContent : state.reviewImplementation?.content });
    applyRequestedRevision(context, response.data);
  } catch (error) {
    state.setReviewError(getApiErrorMessage(error));
  } finally {
    state.setReviewLoading(null);
  }
}

function applyRequestedRevision(context: ReviewContext, job: SelectorDiscoveryJobSummary) {
  context.state.setReviewJob(job);
  context.state.setFunctionRevisionInstruction('');
  const latest = job.functionRevisionTasks?.at(-1);
  context.state.setFunctionRevisionMessage(latest
    ? `${context.text.agent.functionRevisionCreated}: ${latest.id}` : context.text.agent.functionRevisionCreated);
}

async function retryRevision(context: ReviewContext, revisionTaskId: string) {
  const { state } = context;
  if (!state.reviewJob) return;
  beginRevision(state);
  try {
    const response = await api.retrySelectorDiscoveryFunctionRevision(state.reviewJob.id, revisionTaskId,
      { currentSource: state.reviewDraft ? state.reviewDraftContent : state.reviewImplementation?.content,
        modelMode: state.functionRevisionModelMode });
    state.setReviewJob(response.data);
    state.setFunctionRevisionMessage(`${context.text.agent.functionRevisionRetryStarted}: ${revisionTaskId}`);
  } catch (error) {
    state.setReviewError(getApiErrorMessage(error));
  } finally {
    state.setReviewLoading(null);
  }
}

async function runFunctionTest(context: ReviewContext) {
  const { state } = context;
  if (!state.reviewJob || !state.selectedReviewFunctionId || !state.reviewTestUrl.trim()) return;
  beginReviewAction(state, 'test');
  try {
    const result = state.reviewDraft ? await testDraftFunction(state) : await testDiscoveryFunction(state);
    state.setReviewTestResult(result);
  } catch (error) {
    state.setReviewError(getApiErrorMessage(error));
  } finally {
    state.setReviewLoading(null);
  }
}

async function testDraftFunction(state: ReviewState) {
  let draftId = state.reviewDraft!.draft.draftId;
  if (state.reviewDraftContent !== state.savedReviewDraftContent) {
    const saved = await api.saveAdapterDraftContent(draftId, { content: state.reviewDraftContent });
    applyDraft(state, saved.data);
    draftId = saved.data.draft.draftId;
  }
  const response = await api.testAdapterDraftFunction(draftId, state.selectedReviewFunctionId,
    { url: state.reviewTestUrl.trim() });
  return response.data;
}

async function testDiscoveryFunction(state: ReviewState) {
  const response = await api.testSelectorDiscoveryFunction(state.reviewJob!.id,
    state.selectedReviewFunctionId, { url: state.reviewTestUrl.trim() });
  return response.data;
}

async function approveReview(context: ReviewContext) {
  if (!context.state.reviewJob) return;
  beginReviewAction(context.state, 'approve');
  try {
    await api.promoteSelectorDiscovery(context.state.reviewJob.id);
    await Promise.all([context.options.fetchBuildJobs?.(), context.options.fetchAdapters?.(),
      context.options.fetchSiteAdapters?.()]);
    const refreshed = await api.getSelectorDiscovery(context.state.reviewJob.id);
    context.state.setReviewJob(refreshed.data);
  } catch (error) {
    context.state.setReviewError(getApiErrorMessage(error));
  } finally {
    context.state.setReviewLoading(null);
  }
}

async function rejectReview(context: ReviewContext) {
  if (!context.state.reviewJob) return;
  beginReviewAction(context.state, 'reject');
  try {
    const response = await api.rejectSelectorDiscovery(context.state.reviewJob.id);
    await context.options.fetchBuildJobs?.();
    context.state.setReviewJob(response.data);
  } catch (error) {
    context.state.setReviewError(getApiErrorMessage(error));
  } finally {
    context.state.setReviewLoading(null);
  }
}

function closeReview(state: ReviewState) {
  state.setReviewJob(null); state.setReviewImplementation(null); state.setReviewCapabilities(null);
  state.setReviewDraft(null); state.setReviewDraftContent(''); state.setSavedReviewDraftContent('');
  state.setFunctionRevisionInstruction(''); state.setFunctionRevisionMessage(null);
  state.setReviewTestResult(null); state.setReviewError(null);
}

function beginReviewAction(state: ReviewState, loading: ReviewState['reviewLoading'], clearTest = false) {
  state.setReviewLoading(loading);
  state.setReviewError(null);
  if (clearTest) state.setReviewTestResult(null);
}

function beginRevision(state: ReviewState) {
  beginReviewAction(state, 'revision');
  state.setFunctionRevisionMessage(null);
}

function useRevisionPolling(state: ReviewState) {
  const { reviewDraft, reviewJob, setReviewDraftContent, setReviewImplementation,
    setReviewJob, setSavedReviewDraftContent } = state;
  useEffect(() => {
    const active = reviewJob?.functionRevisionTasks?.some((task) => ['queued', 'running'].includes(task.status));
    if (!active || !reviewJob) return;
    const timer = window.setInterval(() => void pollRevision(reviewJob.id, reviewDraft,
      { setReviewDraftContent, setReviewImplementation, setReviewJob, setSavedReviewDraftContent }), 3000);
    return () => window.clearInterval(timer);
  }, [reviewDraft, reviewJob, setReviewDraftContent, setReviewImplementation, setReviewJob, setSavedReviewDraftContent]);
}

type PollSetters = Pick<ReviewState, 'setReviewDraftContent' | 'setReviewImplementation'
  | 'setReviewJob' | 'setSavedReviewDraftContent'>;

async function pollRevision(id: string, draft: AdapterDraftDetailResponse | null, state: PollSetters) {
  try {
    const [job, implementation] = await Promise.all([
      api.getSelectorDiscovery(id), api.getSelectorDiscoveryImplementation(id)]);
    state.setReviewJob(job.data);
    state.setReviewImplementation(implementation.data);
    if (!draft) { state.setReviewDraftContent(''); state.setSavedReviewDraftContent(''); }
  } catch {
    // Keep the review panel visible; explicit actions surface errors.
  }
}
