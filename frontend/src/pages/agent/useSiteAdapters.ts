import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdapterListItem } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';
import { useLocalStorage } from '../../hooks';

export function useSiteAdapters() {
  const [siteAdapters, setSiteAdapters] = useState<AdapterListItem[]>([]);
  const [siteAdaptersLoading, setSiteAdaptersLoading] = useState(false);
  const [siteAdaptersError, setSiteAdaptersError] = useState<string | null>(null);
  const [selectedSiteAdapterId, setSelectedSiteAdapterId] = useLocalStorage<string | null>('agent:selected-site-adapter', null);

  const fetchSiteAdapters = useCallback(async () => {
    setSiteAdaptersLoading(true);
    try {
      const response = await api.getAdapters();
      const items = [...(response.data ?? [])].sort((a, b) => a.id.localeCompare(b.id));
      setSiteAdapters(items);
      setSiteAdaptersError(null);
      if (!selectedSiteAdapterId && items.length > 0) {
        setSelectedSiteAdapterId(items[0]!.id);
      }
    } catch (error) {
      setSiteAdaptersError(getApiErrorMessage(error));
    } finally {
      setSiteAdaptersLoading(false);
    }
  }, [selectedSiteAdapterId, setSelectedSiteAdapterId]);

  /* eslint-disable react-hooks/set-state-in-effect -- TODO(frontend-effect-cleanup): mount fetch via store actions; move to route loader or data-fetching hook */
  useEffect(() => {
    void fetchSiteAdapters();
  }, [fetchSiteAdapters]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (siteAdapters.length === 0) {
      return;
    }
    if (!selectedSiteAdapterId || !siteAdapters.some((adapter) => adapter.id === selectedSiteAdapterId)) {
      setSelectedSiteAdapterId(siteAdapters[0]!.id);
    }
  }, [selectedSiteAdapterId, setSelectedSiteAdapterId, siteAdapters]);

  const selectedSiteAdapter = useMemo(
    () => siteAdapters.find((adapter) => adapter.id === selectedSiteAdapterId) ?? null,
    [selectedSiteAdapterId, siteAdapters]
  );

  return {
    siteAdapters,
    siteAdaptersLoading,
    siteAdaptersError,
    setSiteAdaptersError,
    selectedSiteAdapterId,
    setSelectedSiteAdapterId,
    selectedSiteAdapter,
    fetchSiteAdapters,
  };
}
