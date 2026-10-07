import { useCallback, useEffect, useState } from 'react';
import type { DeletedAdapterListItem } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';

export function useDeletedAdapters(options?: {
  fetchSiteAdapters?: () => Promise<void>;
  fetchAdapters?: () => Promise<void>;
}) {
  const [deletedAdapters, setDeletedAdapters] = useState<DeletedAdapterListItem[]>([]);
  const [deletedAdaptersLoading, setDeletedAdaptersLoading] = useState(false);
  const [deletedAdaptersError, setDeletedAdaptersError] = useState<string | null>(null);
  const [restoringAdapterId, setRestoringAdapterId] = useState<string | null>(null);
  const { fetchSiteAdapters, fetchAdapters } = options ?? {};

  const fetchDeletedAdapters = useCallback(async () => {
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
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- TODO(frontend-effect-cleanup): mount fetch via store actions; move to route loader or data-fetching hook */
  useEffect(() => {
    void fetchDeletedAdapters();
  }, [fetchDeletedAdapters]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const restoreDeletedAdapter = useCallback(async (adapterId: string) => {
    setRestoringAdapterId(adapterId);
    setDeletedAdaptersError(null);
    try {
      await api.restoreAdapter(adapterId);
      await Promise.all([
        fetchDeletedAdapters(),
        fetchSiteAdapters?.(),
        fetchAdapters?.(),
      ]);
    } catch (error) {
      setDeletedAdaptersError(getApiErrorMessage(error));
    } finally {
      setRestoringAdapterId(null);
    }
  }, [fetchDeletedAdapters, fetchSiteAdapters, fetchAdapters]);

  return {
    deletedAdapters,
    deletedAdaptersLoading,
    deletedAdaptersError,
    restoringAdapterId,
    fetchDeletedAdapters,
    restoreDeletedAdapter,
  };
}
