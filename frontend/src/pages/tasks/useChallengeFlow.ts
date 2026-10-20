import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';

export function useChallengeFlow(challengeDiscoveryId: string | undefined) {
  const state = useChallengeState();
  const setters = useChallengeSetters(state);
  useChallengeJob(challengeDiscoveryId, setters);
  const refreshChallengeJob = useCallback((id: string) => refreshChallenge(id, setters), [setters]);
  const openVerificationBrowser = useCallback(
    () => openChallengeBrowser(challengeDiscoveryId, setters), [challengeDiscoveryId, setters]);
  const shouldReopenVerificationBrowser = Boolean(state.challengeJob?.status === 'challenge_required');
  const isVerificationBrowserOpening = state.challengeAction === 'open-verification-browser';
  const isChallengeJobUnavailable = Boolean(state.challengeError
    && /challenge discovery job .*not found|challenge discovery job not found|expired|removed/i.test(state.challengeError));
  return { challengeJob: state.challengeJob, challengeAction: state.challengeAction,
    challengeError: state.challengeError, shouldReopenVerificationBrowser, isVerificationBrowserOpening,
    isChallengeJobUnavailable, refreshChallengeJob, openVerificationBrowser };
}

function useChallengeSetters(state: ReturnType<typeof useChallengeState>) {
  return useMemo(() => ({ setChallengeJob: state.setChallengeJob,
    setChallengeAction: state.setChallengeAction, setChallengeError: state.setChallengeError }),
  [state.setChallengeJob, state.setChallengeAction, state.setChallengeError]);
}

function useChallengeState() {
  const [challengeJob, setChallengeJob] = useState<any | null>(null);
  const [challengeAction, setChallengeAction] = useState<string | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  return { challengeJob, setChallengeJob, challengeAction, setChallengeAction, challengeError, setChallengeError };
}

type ChallengeSetters = ReturnType<typeof useChallengeSetters>;

function useChallengeJob(challengeDiscoveryId: string | undefined, state: ChallengeSetters) {
  useEffect(() => {
    if (!challengeDiscoveryId) {
      state.setChallengeJob(null);
      state.setChallengeError(null);
      return;
    }
    let cancelled = false;
    void loadChallenge(challengeDiscoveryId, state, () => cancelled);
    return () => { cancelled = true; };
  }, [challengeDiscoveryId, state]);
}

async function loadChallenge(id: string, state: ChallengeSetters, cancelled: () => boolean) {
  try {
    const response = await api.getChallengeDiscovery(id);
    if (!cancelled()) { state.setChallengeJob(response.data); state.setChallengeError(null); }
  } catch (error: any) {
    if (!cancelled()) { state.setChallengeJob(null); state.setChallengeError(error.response?.data?.error ?? error.message); }
  }
}

async function refreshChallenge(id: string, state: ChallengeSetters) {
    try {
      const response = await api.getChallengeDiscovery(id);
      state.setChallengeJob(response.data);
      state.setChallengeError(null);
    } catch (loadError: any) {
      state.setChallengeJob(null);
      state.setChallengeError(loadError.response?.data?.error ?? loadError.message);
    }
}

async function openChallengeBrowser(challengeDiscoveryId: string | undefined, state: ChallengeSetters) {
    if (!challengeDiscoveryId) return;
    try {
      state.setChallengeAction('open-verification-browser');
      const response = await api.openChallengeDiscoveryBrowser(challengeDiscoveryId);
      if (response.data?.status) state.setChallengeJob(response.data);
      state.setChallengeError(response.data?.error ?? null);
    } catch (actionError: any) {
      state.setChallengeError(actionError.response?.data?.error ?? actionError.message);
    } finally {
      state.setChallengeAction(null);
    }
}
