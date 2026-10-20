import { useCallback, useEffect, useState } from 'react';
import type { SelectorDiscoveryJobSummary } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';
import { isActiveBuildJob } from './widgets';

export function useBuildJobs() {
  const state = useBuildJobState();
  const fetchBuildJobs = useFetchBuildJobs(state);
  const retryBuildJob = useRetryBuildJob(state, fetchBuildJobs);
  useInitialBuildJobFetch(fetchBuildJobs);
  useBuildJobPolling(state.buildJobs, fetchBuildJobs);
  return { ...state, fetchBuildJobs, retryBuildJob };
}

function useBuildJobState() {
  const [buildJobs, setBuildJobs] = useState<SelectorDiscoveryJobSummary[]>([]);
  const [buildJobsLoading, setBuildJobsLoading] = useState(false);
  const [buildJobsError, setBuildJobsError] = useState<string | null>(null);
  const [retryingBuildJobId, setRetryingBuildJobId] = useState<string | null>(null);
  return { buildJobs, setBuildJobs, buildJobsLoading, setBuildJobsLoading,
    buildJobsError, setBuildJobsError, retryingBuildJobId, setRetryingBuildJobId };
}

function useFetchBuildJobs(state: ReturnType<typeof useBuildJobState>) {
  const { setBuildJobs, setBuildJobsError, setBuildJobsLoading } = state;
  return useCallback(async () => {
    setBuildJobsLoading(true);
    try {
      const response = await api.listSelectorDiscoveries();
      const jobs = [...(response.data.jobs ?? [])].sort((a, b) => (
        new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime()
      ));
      setBuildJobs(jobs);
      setBuildJobsError(null);
    } catch (error) {
      setBuildJobsError(getApiErrorMessage(error));
    } finally {
      setBuildJobsLoading(false);
    }
  }, [setBuildJobs, setBuildJobsError, setBuildJobsLoading]);
}

function useRetryBuildJob(state: ReturnType<typeof useBuildJobState>, fetchBuildJobs: () => Promise<void>) {
  const { setBuildJobsError, setRetryingBuildJobId } = state;
  return useCallback(async (id: string) => {
    setRetryingBuildJobId(id);
    try {
      await api.retrySelectorDiscovery(id);
      await fetchBuildJobs();
    } catch (error) {
      setBuildJobsError(getApiErrorMessage(error));
    } finally {
      setRetryingBuildJobId(null);
    }
  }, [fetchBuildJobs, setBuildJobsError, setRetryingBuildJobId]);
}

function useInitialBuildJobFetch(fetchBuildJobs: () => Promise<void>) {
  useEffect(() => {
    void fetchBuildJobs();
  }, [fetchBuildJobs]);
}

function useBuildJobPolling(buildJobs: SelectorDiscoveryJobSummary[], fetchBuildJobs: () => Promise<void>) {
  useEffect(() => {
    if (!buildJobs.some(isActiveBuildJob)) {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchBuildJobs();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [buildJobs, fetchBuildJobs]);
}
