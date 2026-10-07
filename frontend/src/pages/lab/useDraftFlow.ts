import { useCallback, useMemo, useState } from 'react';
import type { AdapterDraftDetailResponse, AdapterDraftSummary } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';

export function useDraftFlow(options: {
  selectedAdapterId: string;
  setLoading: (value: string | null) => void;
  setError: (value: string | null) => void;
}) {
  const { selectedAdapterId, setLoading, setError } = options;
  const [drafts, setDrafts] = useState<AdapterDraftSummary[]>([]);
  const [draft, setDraft] = useState<AdapterDraftDetailResponse | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [savedDraftContent, setSavedDraftContent] = useState('');
  const [draftViewMode, setDraftViewMode] = useState<'edit' | 'diff'>('edit');

  const clearDraftState = useCallback(() => {
    setDraft(null);
    setDraftContent('');
    setSavedDraftContent('');
    setDraftViewMode('edit');
  }, []);

  const createDraft = useCallback(async () => {
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
  }, [selectedAdapterId, setError, setLoading]);

  const openDraft = useCallback(async (draftId: string) => {
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
  }, [setError, setLoading]);

  const saveDraft = useCallback(async () => {
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
  }, [draft, draftContent, setError, setLoading]);

  const reloadSavedDraft = useCallback(() => {
    setDraftContent(savedDraftContent);
  }, [savedDraftContent]);

  const resetDraft = useCallback(async () => {
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
  }, [draft, setError, setLoading]);

  const discardDraft = useCallback(async () => {
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
  }, [clearDraftState, draft, setError, setLoading]);

  const draftsForSelectedAdapter = useMemo(() => (
    drafts.filter((item) => item.baseAdapterId === selectedAdapterId)
  ), [drafts, selectedAdapterId]);

  const isDraftMode = Boolean(draft);
  const hasUnsavedDraftChanges = Boolean(draft && draftContent !== savedDraftContent);
  const canExecuteDraft = draft?.draft.sourceKind === 'dynamic-manifest';

  return {
    drafts,
    setDrafts,
    draft,
    setDraft,
    draftContent,
    setDraftContent,
    savedDraftContent,
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
  };
}
