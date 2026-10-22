import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdapterListItem } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';
import { useLocalStorage } from '../../hooks';

export function useSiteAdapters() {
  const state = useSiteAdapterState();
  const fetchSiteAdapters = useFetchSiteAdapters(state);
  useInitialSiteAdapterFetch(fetchSiteAdapters);
  useSelectedSiteAdapterGuard(state);
  const selectedSiteAdapter = useMemo(
    () => state.siteAdapters.find((adapter) => adapter.id === state.selectedSiteAdapterId) ?? null,
    [state.selectedSiteAdapterId, state.siteAdapters]
  );
  return { ...state, selectedSiteAdapter, fetchSiteAdapters };
}

function useSiteAdapterState() {
  const [siteAdapters, setSiteAdapters] = useState<AdapterListItem[]>([]);
  const [siteAdaptersLoading, setSiteAdaptersLoading] = useState(false);
  const [siteAdaptersError, setSiteAdaptersError] = useState<string | null>(null);
  const [selectedSiteAdapterId, setSelectedSiteAdapterId] = useLocalStorage<string | null>('agent:selected-site-adapter', null);
  return { siteAdapters, setSiteAdapters, siteAdaptersLoading, setSiteAdaptersLoading,
    siteAdaptersError, setSiteAdaptersError, selectedSiteAdapterId, setSelectedSiteAdapterId };
}

function useFetchSiteAdapters(state: ReturnType<typeof useSiteAdapterState>) {
  const { selectedSiteAdapterId, setSelectedSiteAdapterId, setSiteAdapters,
    setSiteAdaptersError, setSiteAdaptersLoading } = state;
  return useCallback(async () => {
    setSiteAdaptersLoading(true);
    try {
      const response = await api.getAdapters();
      const items = [...(response.data ?? [])].sort((a, b) => a.id.localeCompare(b.id));
      setSiteAdapters(items);
      setSiteAdaptersError(null);
      if (!selectedSiteAdapterId && items.length > 0) setSelectedSiteAdapterId(items[0]!.id);
    } catch (error) {
      setSiteAdaptersError(getApiErrorMessage(error));
    } finally {
      setSiteAdaptersLoading(false);
    }
  }, [selectedSiteAdapterId, setSelectedSiteAdapterId, setSiteAdapters, setSiteAdaptersError, setSiteAdaptersLoading]);
}

function useInitialSiteAdapterFetch(fetchSiteAdapters: () => Promise<void>) {
  useEffect(() => {
    void fetchSiteAdapters();
  }, [fetchSiteAdapters]);
}

function useSelectedSiteAdapterGuard(state: ReturnType<typeof useSiteAdapterState>) {
  const { selectedSiteAdapterId, setSelectedSiteAdapterId, siteAdapters } = state;
  useEffect(() => {
    if (siteAdapters.length === 0) return;
    if (!selectedSiteAdapterId || !siteAdapters.some((adapter) => adapter.id === selectedSiteAdapterId)) {
      setSelectedSiteAdapterId(siteAdapters[0]!.id);
    }
  }, [selectedSiteAdapterId, setSelectedSiteAdapterId, siteAdapters]);
}
