import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { LocalBrowserOption } from './widgets';

export function useChallengeFlow(challengeDiscoveryId: string | undefined) {
  const [challengeJob, setChallengeJob] = useState<any | null>(null);
  const [challengeAction, setChallengeAction] = useState<string | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [browserOptions, setBrowserOptions] = useState<LocalBrowserOption[]>([]);
  const [browserExecutablePath, setBrowserExecutablePath] = useState('');

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

  /* eslint-disable react-hooks/set-state-in-effect -- TODO(frontend-effect-cleanup): browser-options fetch with sync reset; remodel to render-time derivation */
  useEffect(() => {
    if (!challengeDiscoveryId) {
      setBrowserOptions([]);
      setBrowserExecutablePath('');
      return;
    }

    let cancelled = false;
    api.getChallengeBrowserOptions()
      .then((response) => {
        if (cancelled) return;
        const browsers = (response.data?.browsers ?? []) as LocalBrowserOption[];
        setBrowserOptions(browsers);
        const first = browsers[0];
        if (first) {
          setBrowserExecutablePath((current) => current || first.executablePath);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBrowserOptions([]);
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

  const browseBrowserExecutable = useCallback(async () => {
    try {
      setChallengeAction('browse-browser');
      const response = await api.browseChallengeBrowserExecutable();
      if (response.data?.executablePath) {
        setBrowserExecutablePath(response.data.executablePath);
      }
      setChallengeError(null);
    } catch (actionError: any) {
      setChallengeError(actionError.response?.data?.error ?? actionError.message);
    } finally {
      setChallengeAction(null);
    }
  }, []);

  const openVerificationBrowser = useCallback(async () => {
    if (!challengeDiscoveryId) return;
    try {
      setChallengeAction('open-verification-browser');
      const response = await api.openChallengeDiscoveryExternalBrowser(challengeDiscoveryId, {
        executablePath: browserExecutablePath || undefined,
      });
      if (response.data?.status) {
        setChallengeJob(response.data);
      }
      setChallengeError(response.data?.error ?? null);
    } catch (actionError: any) {
      setChallengeError(actionError.response?.data?.error ?? actionError.message);
    } finally {
      setChallengeAction(null);
    }
  }, [browserExecutablePath, challengeDiscoveryId]);

  const shouldReopenVerificationBrowser = Boolean(challengeJob?.status === 'challenge_required' && challengeJob?.browserExecutablePath);
  const isVerificationBrowserOpening =
    challengeAction === 'open-verification-browser' || challengeJob?.status === 'external_browser_opening';
  const isExternalVerificationUnreadable =
    challengeJob?.status === 'external_browser_open' && challengeJob?.browserExecutablePath && !challengeJob?.browserCdpUrl;
  const isChallengeJobUnavailable = Boolean(
    challengeError && /challenge discovery job .*not found|challenge discovery job not found|expired|removed/i.test(challengeError)
  );

  return {
    challengeJob,
    challengeAction,
    challengeError,
    browserOptions,
    browserExecutablePath,
    setBrowserExecutablePath,
    shouldReopenVerificationBrowser,
    isVerificationBrowserOpening,
    isExternalVerificationUnreadable,
    isChallengeJobUnavailable,
    refreshChallengeJob,
    browseBrowserExecutable,
    openVerificationBrowser,
  };
}
