import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';

export function useChallengeFlow(challengeDiscoveryId: string | undefined) {
  const [challengeJob, setChallengeJob] = useState<any | null>(null);
  const [challengeAction, setChallengeAction] = useState<string | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- TODO(frontend-effect-cleanup): challenge-status fetch with sync reset; remodel to render-time derivation */
  useEffect(() => {
    if (!challengeDiscoveryId) {
      setChallengeJob(null);
      setChallengeError(null);
      return;
    }

    let cancelled = false;
    api.getChallengeDiscovery(challengeDiscoveryId)
      .then((response) => {
        if (!cancelled) {
          setChallengeJob(response.data);
          setChallengeError(null);
        }
      })
      .catch((loadError: any) => {
        if (!cancelled) {
          setChallengeJob(null);
          setChallengeError(loadError.response?.data?.error ?? loadError.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [challengeDiscoveryId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const refreshChallengeJob = useCallback(async (id: string) => {
    try {
      const response = await api.getChallengeDiscovery(id);
      setChallengeJob(response.data);
      setChallengeError(null);
    } catch (loadError: any) {
      setChallengeJob(null);
      setChallengeError(loadError.response?.data?.error ?? loadError.message);
    }
  }, []);

  const openVerificationBrowser = useCallback(async () => {
    if (!challengeDiscoveryId) return;
    try {
      setChallengeAction('open-verification-browser');
      const response = await api.openChallengeDiscoveryBrowser(challengeDiscoveryId);
      if (response.data?.status) {
        setChallengeJob(response.data);
      }
      setChallengeError(response.data?.error ?? null);
    } catch (actionError: any) {
      setChallengeError(actionError.response?.data?.error ?? actionError.message);
    } finally {
      setChallengeAction(null);
    }
  }, [challengeDiscoveryId]);

  const shouldReopenVerificationBrowser = Boolean(challengeJob?.status === 'challenge_required');
  const isVerificationBrowserOpening =
    challengeAction === 'open-verification-browser';
  const isChallengeJobUnavailable = Boolean(
    challengeError && /challenge discovery job .*not found|challenge discovery job not found|expired|removed/i.test(challengeError)
  );

  return {
    challengeJob,
    challengeAction,
    challengeError,
    shouldReopenVerificationBrowser,
    isVerificationBrowserOpening,
    isChallengeJobUnavailable,
    refreshChallengeJob,
    openVerificationBrowser,
  };
}
