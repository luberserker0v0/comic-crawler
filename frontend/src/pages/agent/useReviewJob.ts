import { useCallback, useEffect, useState } from 'react';
import type {
  AdapterCapabilityDetailResponse,
  AdapterDraftDetailResponse,
  AdapterFunctionTestResponse,
  AdapterImplementationResponse,
  SelectorDiscoveryJobSummary,
} from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';
import { useI18n } from '../../text/i18n';
import { defaultTestUrlForFunction } from './widgets';

export function useReviewJob(options?: {
  fetchBuildJobs?: () => Promise<void>;
  fetchSiteAdapters?: () => Promise<void>;
  fetchAdapters?: () => Promise<void>;
}) {
  const { fetchBuildJobs, fetchSiteAdapters, fetchAdapters } = options ?? {};
  const { text } = useI18n();
  const [reviewJob, setReviewJob] = useState<SelectorDiscoveryJobSummary | null>(null);
  const [reviewImplementation, setReviewImplementation] = useState<AdapterImplementationResponse | null>(null);
  const [reviewCapabilities, setReviewCapabilities] = useState<AdapterCapabilityDetailResponse | null>(null);
  const [reviewDraft, setReviewDraft] = useState<AdapterDraftDetailResponse | null>(null);
  const [reviewDraftContent, setReviewDraftContent] = useState('');
  const [savedReviewDraftContent, setSavedReviewDraftContent] = useState('');
  const [selectedReviewFunctionId, setSelectedReviewFunctionId] = useState('');
  const [reviewTestUrl, setReviewTestUrl] = useState('');
  const [reviewTestResult, setReviewTestResult] = useState<AdapterFunctionTestResponse | null>(null);
  const [functionRevisionInstruction, setFunctionRevisionInstruction] = useState('');
  const [functionRevisionModelMode, setFunctionRevisionModelMode] = useState<'current-settings' | 'previous-task'>('current-settings');
  const [functionRevisionMessage, setFunctionRevisionMessage] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState<'load' | 'test' | 'approve' | 'reject' | 'edit' | 'save' | 'revision' | null>(null);

  const openReviewJob = useCallback(async (id: string) => {
    setReviewLoading('load');
    setReviewError(null);
    setReviewTestResult(null);
    try {
      const [jobResponse, implementationResponse, capabilitiesResponse] = await Promise.all([
        api.getSelectorDiscovery(id),
        api.getSelectorDiscoveryImplementation(id),
        api.getSelectorDiscoveryCapabilities(id),
      ]);
      const implementedFunctions = capabilitiesResponse.data.functions.filter((item) => item.implemented);
      const firstFunctionId = implementedFunctions[0]?.id ?? '';
      setReviewJob(jobResponse.data);
      setReviewImplementation(implementationResponse.data);
      setReviewCapabilities(capabilitiesResponse.data);
      setReviewDraft(null);
      setReviewDraftContent('');
      setSavedReviewDraftContent('');
      setFunctionRevisionInstruction('');
      setFunctionRevisionMessage(null);
      setSelectedReviewFunctionId(firstFunctionId);
      setReviewTestUrl(firstFunctionId ? defaultTestUrlForFunction(jobResponse.data, firstFunctionId) : jobResponse.data.normalizedUrl);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, []);

  const createEditableReviewDraft = useCallback(async () => {
    if (!reviewJob) return;
    setReviewLoading('edit');
    setReviewError(null);
    setReviewTestResult(null);
    try {
      const response = await api.createSelectorDiscoveryDraft(reviewJob.id);
      setReviewDraft(response.data);
      setReviewDraftContent(response.data.content);
      setSavedReviewDraftContent(response.data.content);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [reviewJob]);

  const saveEditableReviewDraft = useCallback(async () => {
    if (!reviewDraft) return;
    setReviewLoading('save');
    setReviewError(null);
    try {
      const response = await api.saveAdapterDraftContent(reviewDraft.draft.draftId, { content: reviewDraftContent });
      setReviewDraft(response.data);
      setReviewDraftContent(response.data.content);
      setSavedReviewDraftContent(response.data.content);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [reviewDraft, reviewDraftContent]);

  const resetEditableReviewDraft = useCallback(() => {
    const source = reviewImplementation?.content ?? '';
    setReviewDraftContent(source);
    setReviewTestResult(null);
  }, [reviewImplementation]);

  const requestFunctionRevision = useCallback(async () => {
    if (!reviewJob || !selectedReviewFunctionId) return;
    setReviewLoading('revision');
    setReviewError(null);
    setFunctionRevisionMessage(null);
    try {
      const response = await api.requestSelectorDiscoveryFunctionRevision(reviewJob.id, selectedReviewFunctionId, {
        functionId: selectedReviewFunctionId,
        instruction: functionRevisionInstruction,
        currentSource: reviewDraft ? reviewDraftContent : reviewImplementation?.content,
      });
      setReviewJob(response.data);
      setFunctionRevisionInstruction('');
      const latest = response.data.functionRevisionTasks?.at(-1);
      setFunctionRevisionMessage(latest
        ? `${text.agent.functionRevisionCreated}: ${latest.id}`
        : text.agent.functionRevisionCreated);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [functionRevisionInstruction, reviewDraft, reviewDraftContent, reviewImplementation, reviewJob, selectedReviewFunctionId, text.agent.functionRevisionCreated]);

  const retryFunctionRevision = useCallback(async (revisionTaskId: string) => {
    if (!reviewJob) return;
    setReviewLoading('revision');
    setReviewError(null);
    setFunctionRevisionMessage(null);
    try {
      const response = await api.retrySelectorDiscoveryFunctionRevision(reviewJob.id, revisionTaskId, {
        currentSource: reviewDraft ? reviewDraftContent : reviewImplementation?.content,
        modelMode: functionRevisionModelMode,
      });
      setReviewJob(response.data);
      setFunctionRevisionMessage(`${text.agent.functionRevisionRetryStarted}: ${revisionTaskId}`);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [functionRevisionModelMode, reviewDraft, reviewDraftContent, reviewImplementation, reviewJob, text.agent.functionRevisionRetryStarted]);

  const runReviewFunctionTest = useCallback(async () => {
    if (!reviewJob || !selectedReviewFunctionId || !reviewTestUrl.trim()) return;
    setReviewLoading('test');
    setReviewError(null);
    try {
      if (reviewDraft) {
        let draftId = reviewDraft.draft.draftId;
        if (reviewDraftContent !== savedReviewDraftContent) {
          const saved = await api.saveAdapterDraftContent(reviewDraft.draft.draftId, { content: reviewDraftContent });
          setReviewDraft(saved.data);
          setReviewDraftContent(saved.data.content);
          setSavedReviewDraftContent(saved.data.content);
          draftId = saved.data.draft.draftId;
        }
        const draftResponse = await api.testAdapterDraftFunction(draftId, selectedReviewFunctionId, {
          url: reviewTestUrl.trim(),
        });
        setReviewTestResult(draftResponse.data);
        return;
      }
      const response = await api.testSelectorDiscoveryFunction(reviewJob.id, selectedReviewFunctionId, {
        url: reviewTestUrl.trim(),
      });
      setReviewTestResult(response.data);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [reviewDraft, reviewDraftContent, reviewJob, savedReviewDraftContent, selectedReviewFunctionId, reviewTestUrl]);

  const approveReviewJob = useCallback(async () => {
    if (!reviewJob) return;
    setReviewLoading('approve');
    setReviewError(null);
    try {
      await api.promoteSelectorDiscovery(reviewJob.id);
      await Promise.all([fetchBuildJobs?.(), fetchAdapters?.(), fetchSiteAdapters?.()]);
      const refreshed = await api.getSelectorDiscovery(reviewJob.id);
      setReviewJob(refreshed.data);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [fetchAdapters, fetchBuildJobs, fetchSiteAdapters, reviewJob]);

  const rejectReviewJob = useCallback(async () => {
    if (!reviewJob) return;
    setReviewLoading('reject');
    setReviewError(null);
    try {
      const response = await api.rejectSelectorDiscovery(reviewJob.id);
      await fetchBuildJobs?.();
      setReviewJob(response.data);
    } catch (error) {
      setReviewError(getApiErrorMessage(error));
    } finally {
      setReviewLoading(null);
    }
  }, [fetchBuildJobs, reviewJob]);

  const closeReview = useCallback(() => {
    setReviewJob(null);
    setReviewImplementation(null);
    setReviewCapabilities(null);
    setReviewDraft(null);
    setReviewDraftContent('');
    setSavedReviewDraftContent('');
    setFunctionRevisionInstruction('');
    setFunctionRevisionMessage(null);
    setReviewTestResult(null);
    setReviewError(null);
  }, []);

  useEffect(() => {
    if (!reviewJob?.functionRevisionTasks?.some((task) => task.status === 'queued' || task.status === 'running')) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const [jobResponse, implementationResponse] = await Promise.all([
          api.getSelectorDiscovery(reviewJob.id),
          api.getSelectorDiscoveryImplementation(reviewJob.id),
        ]);
        setReviewJob(jobResponse.data);
        setReviewImplementation(implementationResponse.data);
        if (!reviewDraft) {
          setReviewDraftContent('');
          setSavedReviewDraftContent('');
        }
      } catch {
        // Keep the current review panel visible; explicit actions will surface errors.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [reviewDraft, reviewJob]);

  return {
    reviewJob,
    reviewImplementation,
    reviewCapabilities,
    reviewDraft,
    reviewDraftContent,
    setReviewDraftContent,
    savedReviewDraftContent,
    selectedReviewFunctionId,
    setSelectedReviewFunctionId,
    reviewTestUrl,
    setReviewTestUrl,
    reviewTestResult,
    setReviewTestResult,
    functionRevisionInstruction,
    setFunctionRevisionInstruction,
    functionRevisionModelMode,
    setFunctionRevisionModelMode,
    functionRevisionMessage,
    reviewError,
    reviewLoading,
    openReviewJob,
    createEditableReviewDraft,
    saveEditableReviewDraft,
    resetEditableReviewDraft,
    requestFunctionRevision,
    retryFunctionRevision,
    runReviewFunctionTest,
    approveReviewJob,
    rejectReviewJob,
    closeReview,
  };
}
