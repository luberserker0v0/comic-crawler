import { useCallback, useEffect, useState } from 'react';
import type { DeletedAdapterListItem } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';

export function useDeletedAdapters(options?: {
  fetchSiteAdapters?: () => Promise<void>;
  fetchAdapters?: () => Promise<void>;
}) {
  const state = useDeletedAdapterState();
  const fetchDeletedAdapters = useFetchDeletedAdapters(state);
  useInitialDeletedAdapterFetch(fetchDeletedAdapters);
  const restoreDeletedAdapter = useRestoreDeletedAdapter(state, fetchDeletedAdapters, options);
  return { ...state, fetchDeletedAdapters, restoreDeletedAdapter };
}

function useDeletedAdapterState() {
  const [deletedAdapters, setDeletedAdapters] = useState<DeletedAdapterListItem[]>([]);
  const [deletedAdaptersLoading, setDeletedAdaptersLoading] = useState(false);
  const [deletedAdaptersError, setDeletedAdaptersError] = useState<string | null>(null);
  const [restoringAdapterId, setRestoringAdapterId] = useState<string | null>(null);
  return { deletedAdapters, setDeletedAdapters, deletedAdaptersLoading, setDeletedAdaptersLoading,
    deletedAdaptersError, setDeletedAdaptersError, restoringAdapterId, setRestoringAdapterId };
}

function useFetchDeletedAdapters(state: ReturnType<typeof useDeletedAdapterState>) {
  const { setDeletedAdapters, setDeletedAdaptersError, setDeletedAdaptersLoading } = state;
  return useCallback(async () => {
    setDeletedAdaptersLoading(true);
    try {
      const response = await api.getDeletedAdapters();
      const items = [...(response.data.adapters ?? [])].sort((a, b) => (
        new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()
      ));
      setDeletedAdapters(items);
      setDeletedAdaptersError(null);
    } catch (error) {
      setDeletedAdaptersError(getApiErrorMessage(error));
    } finally {
      setDeletedAdaptersLoading(false);
    }
  }, [setDeletedAdapters, setDeletedAdaptersError, setDeletedAdaptersLoading]);
}

function useInitialDeletedAdapterFetch(fetchDeletedAdapters: () => Promise<void>) {
  useEffect(() => {
    void fetchDeletedAdapters();
  }, [fetchDeletedAdapters]);
}

function useRestoreDeletedAdapter(
  state: ReturnType<typeof useDeletedAdapterState>,
  fetchDeletedAdapters: () => Promise<void>,
  options?: { fetchSiteAdapters?: () => Promise<void>; fetchAdapters?: () => Promise<void> }
) {
  const { fetchSiteAdapters, fetchAdapters } = options ?? {};
  const { setDeletedAdaptersError, setRestoringAdapterId } = state;
  return useCallback(async (adapterId: string) => {
    setRestoringAdapterId(adapterId);
    setDeletedAdaptersError(null);
    try {
      await api.restoreAdapter(adapterId);
      await Promise.all([fetchDeletedAdapters(), fetchSiteAdapters?.(), fetchAdapters?.()]);
    } catch (error) {
      setDeletedAdaptersError(getApiErrorMessage(error));
    } finally {
      setRestoringAdapterId(null);
    }
  }, [fetchAdapters, fetchDeletedAdapters, fetchSiteAdapters, setDeletedAdaptersError, setRestoringAdapterId]);
}
