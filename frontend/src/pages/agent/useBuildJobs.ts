import { useCallback, useEffect, useState } from 'react';
import type { SelectorDiscoveryJobSummary } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';
import { isActiveBuildJob } from './widgets';

export function useBuildJobs() {
  const [buildJobs, setBuildJobs] = useState<SelectorDiscoveryJobSummary[]>([]);
  const [buildJobsLoading, setBuildJobsLoading] = useState(false);
  const [buildJobsError, setBuildJobsError] = useState<string | null>(null);
  const [retryingBuildJobId, setRetryingBuildJobId] = useState<string | null>(null);

  const fetchBuildJobs = useCallback(async () => {
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
  }, []);

  const retryBuildJob = useCallback(async (id: string) => {
    setRetryingBuildJobId(id);
    try {
      await api.retrySelectorDiscovery(id);
      await fetchBuildJobs();
    } catch (error) {
      setBuildJobsError(getApiErrorMessage(error));
    } finally {
      setRetryingBuildJobId(null);
    }
  }, [fetchBuildJobs]);

  /* eslint-disable react-hooks/set-state-in-effect -- TODO(frontend-effect-cleanup): mount fetch via store actions; move to route loader or data-fetching hook */
  useEffect(() => {
    void fetchBuildJobs();
  }, [fetchBuildJobs]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!buildJobs.some(isActiveBuildJob)) {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchBuildJobs();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [buildJobs, fetchBuildJobs]);

  return {
    buildJobs,
    buildJobsLoading,
    buildJobsError,
    retryingBuildJobId,
    fetchBuildJobs,
    retryBuildJob,
  };
}
