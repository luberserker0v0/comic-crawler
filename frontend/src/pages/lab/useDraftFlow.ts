import { useMemo, useState } from 'react';
import type { AdapterDraftDetailResponse, AdapterDraftSummary } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';

type DraftOptions = { selectedAdapterId: string; setLoading(value: string | null): void; setError(value: string | null): void };

export function useDraftFlow(options: DraftOptions) {
  const state = useDraftState();
  const context = { options, state };
  const clearDraftState = () => clearDraft(state);
  const actions = { clearDraftState, createDraft: () => createDraft(context), openDraft: (id: string) => openDraft(context, id),
    saveDraft: () => saveDraft(context), reloadSavedDraft: () => state.setDraftContent(state.savedDraftContent),
    resetDraft: () => resetDraft(context), discardDraft: () => discardDraft(context) };
  const draftsForSelectedAdapter = useMemo(() => state.drafts.filter(
    (item) => item.baseAdapterId === options.selectedAdapterId), [state.drafts, options.selectedAdapterId]);
  return { ...state, draftsForSelectedAdapter, isDraftMode: Boolean(state.draft),
    hasUnsavedDraftChanges: Boolean(state.draft && state.draftContent !== state.savedDraftContent),
    canExecuteDraft: Boolean(state.draft), ...actions };
}

function useDraftState() {
  const [drafts, setDrafts] = useState<AdapterDraftSummary[]>([]);
  const [draft, setDraft] = useState<AdapterDraftDetailResponse | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [savedDraftContent, setSavedDraftContent] = useState('');
  const [draftViewMode, setDraftViewMode] = useState<'edit' | 'diff'>('edit');
  return { drafts, setDrafts, draft, setDraft, draftContent, setDraftContent,
    savedDraftContent, setSavedDraftContent, draftViewMode, setDraftViewMode };
}

type DraftState = ReturnType<typeof useDraftState>;
type DraftContext = { options: DraftOptions; state: DraftState };

function clearDraft(state: DraftState) {
  state.setDraft(null);
  state.setDraftContent('');
  state.setSavedDraftContent('');
  state.setDraftViewMode('edit');
}

async function createDraft(context: DraftContext) {
  if (!context.options.selectedAdapterId) return;
  beginDraftAction(context, 'draft');
  try {
    const response = await api.createAdapterDraft(context.options.selectedAdapterId);
    applyDraftResponse(context.state, response.data);
  } catch (error) {
    context.options.setError(getApiErrorMessage(error));
  } finally {
    context.options.setLoading(null);
  }
}

async function openDraft(context: DraftContext, draftId: string) {
  beginDraftAction(context, 'draft-open');
  try {
    const response = await api.getAdapterDraft(draftId);
    applyDraftResponse(context.state, response.data, false);
  } catch (error) {
    context.options.setError(getApiErrorMessage(error));
  } finally {
    context.options.setLoading(null);
  }
}

async function saveDraft(context: DraftContext) {
  if (!context.state.draft) return;
  beginDraftAction(context, 'draft-save');
  try {
    const id = context.state.draft.draft.draftId;
    const response = await api.saveAdapterDraftContent(id, { content: context.state.draftContent });
    applyDraftResponse(context.state, response.data);
  } catch (error) {
    context.options.setError(getApiErrorMessage(error));
  } finally {
    context.options.setLoading(null);
  }
}

async function resetDraft(context: DraftContext) {
  if (!context.state.draft) return;
  beginDraftAction(context, 'draft-reset');
  try {
    const response = await api.resetAdapterDraft(context.state.draft.draft.draftId);
    applyDraftResponse(context.state, response.data);
  } catch (error) {
    context.options.setError(getApiErrorMessage(error));
  } finally {
    context.options.setLoading(null);
  }
}

async function discardDraft(context: DraftContext) {
  const draftId = context.state.draft?.draft.draftId;
  if (!draftId) return;
  beginDraftAction(context, 'draft-discard');
  try {
    await api.discardAdapterDraft(draftId);
    context.state.setDrafts((current) => current.filter((item) => item.draftId !== draftId));
    clearDraft(context.state);
  } catch (error) {
    context.options.setError(getApiErrorMessage(error));
  } finally {
    context.options.setLoading(null);
  }
}

function beginDraftAction(context: DraftContext, loading: string) {
  context.options.setError(null);
  context.options.setLoading(loading);
}

function applyDraftResponse(state: DraftState, response: AdapterDraftDetailResponse, updateList = true) {
  state.setDraft(response);
  state.setDraftContent(response.content);
  state.setSavedDraftContent(response.content);
  if (updateList) state.setDrafts((current) => [response.draft,
    ...current.filter((item) => item.draftId !== response.draft.draftId)]);
}
