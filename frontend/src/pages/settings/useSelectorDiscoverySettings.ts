import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { SelectorDiscoveryAoModelsResponse } from '@comiccrawler/shared';
import { DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON } from './provider-template';

export type SelectorDiscoverySaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: string }
  | { state: 'error'; message: string };

const AUTO_SAVE_DELAY_MS = 1200;

export function useSelectorDiscoverySettings(options: {
  fetchConfig: () => Promise<void> | void;
}) {
  const { fetchConfig } = options;
  const [selectorDiscoveryConfig, setSelectorDiscoveryConfig] = useState<any | null>(null);
  const [selectorDiscoveryBundleStatus, setSelectorDiscoveryBundleStatus] = useState<any | null>(null);
  const [selectorDiscoveryBundleEvaluations, setSelectorDiscoveryBundleEvaluations] = useState<any[]>([]);
  const [selectorDiscoveryAoModels, setSelectorDiscoveryAoModels] = useState<SelectorDiscoveryAoModelsResponse | null>(null);
  const [selectorDiscoveryAoModelsLoading, setSelectorDiscoveryAoModelsLoading] = useState(false);
  const [aoBaseUrl, setAoBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [providerJson, setProviderJson] = useState(DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON);
  const [selectorDiscoveryMessage, setSelectorDiscoveryMessage] = useState<string | null>(null);
  const [selectorDiscoveryPreflight, setSelectorDiscoveryPreflight] = useState<any | null>(null);
  const [selectorDiscoverySaveState, setSelectorDiscoverySaveState] = useState<SelectorDiscoverySaveState>({ state: 'idle' });
  const initialLoadRef = useRef(false);
  const lastSavedSnapshotRef = useRef('');

  const refreshSelectorDiscoveryBundleStatus = useCallback(async () => {
    try {
      const response = await api.getSelectorDiscoveryBundleStatus();
      setSelectorDiscoveryBundleStatus(response.data);
    } catch (err: any) {
      setSelectorDiscoveryBundleStatus({
        verified: false,
        error: err.response?.data?.error ?? err.message,
      });
    }
  }, []);

  const refreshSelectorDiscoveryBundleEvaluations = useCallback(async () => {
    try {
      const response = await api.getSelectorDiscoveryBundleEvaluations();
      setSelectorDiscoveryBundleEvaluations(response.data.evaluations ?? []);
    } catch {
      setSelectorDiscoveryBundleEvaluations([]);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- TODO(frontend-effect-cleanup): mount fetch populating several states; move to route loader or data-fetching hook */
  useEffect(() => {
    fetchConfig();
    api.getSelectorDiscoveryConfig().then((response) => {
      setSelectorDiscoveryConfig(response.data);
      setAoBaseUrl(response.data.aoBaseUrl ?? '');
      setModel(response.data.model ?? '');
      if (response.data.configured) {
        setProviderJson('');
      } else {
        setProviderJson(DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON);
      }
      lastSavedSnapshotRef.current = snapshotSelectorDiscoveryFields(
        response.data.aoBaseUrl ?? '',
        response.data.model ?? '',
        response.data.configured ? '' : DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON
      );
      initialLoadRef.current = true;
    }).catch(() => undefined);
    refreshSelectorDiscoveryBundleStatus();
    refreshSelectorDiscoveryBundleEvaluations();
  }, [fetchConfig, refreshSelectorDiscoveryBundleStatus, refreshSelectorDiscoveryBundleEvaluations]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect -- auto-save state machine: sync status transitions (idle/invalid/saving) are the effect's purpose */
  useEffect(() => {
    if (!initialLoadRef.current) return;
    const snapshot = snapshotSelectorDiscoveryFields(aoBaseUrl, model, providerJson);
    if (snapshot === lastSavedSnapshotRef.current) return;
    if (!aoBaseUrl.trim() || !model.trim() || (!selectorDiscoveryConfig?.configured && !providerJson.trim())) {
      setSelectorDiscoverySaveState({ state: 'idle' });
      return;
    }
    const trimmedProviderJson = providerJson.trim();
    let providerDocument: unknown | undefined;
    if (trimmedProviderJson) {
      try {
        providerDocument = JSON.parse(trimmedProviderJson);
      } catch {
        setSelectorDiscoverySaveState({ state: 'error', message: 'Provider JSON is not valid JSON; waiting for fixes before auto-saving.' });
        return;
      }
    }
    setSelectorDiscoverySaveState({ state: 'saving' });
    const timer = setTimeout(async () => {
      try {
        const response = await api.updateSelectorDiscoveryConfig({
          aoBaseUrl,
          model,
          ...(providerDocument !== undefined ? { providerDocument } : {}),
        });
        setSelectorDiscoveryConfig(response.data);
        lastSavedSnapshotRef.current = snapshotSelectorDiscoveryFields(
          aoBaseUrl,
          model,
          providerDocument !== undefined ? '' : providerJson
        );
        if (providerDocument !== undefined) {
          setProviderJson('');
        }
        setSelectorDiscoverySaveState({ state: 'saved', at: new Date().toLocaleTimeString() });
      } catch (err: any) {
        setSelectorDiscoverySaveState({ state: 'error', message: err.response?.data?.error ?? err.message });
      }
    }, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [aoBaseUrl, model, providerJson, selectorDiscoveryConfig?.configured]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleLoadDefaultSelectorDiscoveryProvider = useCallback(() => {
    setModel('');
    setProviderJson(DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON);
    setSelectorDiscoveryMessage('Loaded the OpenCode provider template. Pick a model returned by AO; settings save automatically.');
  }, []);

  const handleSelectorDiscoveryClear = useCallback(async () => {
    const response = await api.clearSelectorDiscoveryProvider();
    setSelectorDiscoveryConfig(response.data);
    setModel('');
    setProviderJson(DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON);
    setSelectorDiscoveryMessage('Selector discovery provider cleared.');
  }, []);

  const handleSelectorDiscoveryTest = useCallback(async () => {
    setSelectorDiscoveryMessage(null);
    setSelectorDiscoveryPreflight(null);
    try {
      const response = await api.testSelectorDiscoveryConfig();
      setSelectorDiscoveryPreflight(response.data);
      setSelectorDiscoveryAoModels({
        conversationId: response.data.conversationId,
        bundleHash: response.data.bundleHash,
        providers: response.data.providers ?? [],
        models: response.data.models ?? [],
      });
      setSelectorDiscoveryMessage(`AO smoke test passed. Bundle ${response.data.bundleHash?.slice(0, 12) ?? '-'} / ${response.data.model}`);
    } catch (err: any) {
      setSelectorDiscoveryPreflight(err.response?.data?.data ?? null);
      setSelectorDiscoveryMessage(err.response?.data?.error ?? err.message);
    }
  }, []);

  const handleRefreshSelectorDiscoveryAoModels = useCallback(async () => {
    setSelectorDiscoveryMessage(null);
    setSelectorDiscoveryPreflight(null);
    setSelectorDiscoveryAoModelsLoading(true);
    try {
      const response = await api.getSelectorDiscoveryAoModels(aoBaseUrl);
      setSelectorDiscoveryAoModels(response.data);
      const containsSelectedModel = response.data.models.some((item) => item.id === model);
      setSelectorDiscoveryMessage(
        `AO returned ${response.data.providers.length} providers and ${response.data.models.length} models.`
        + (containsSelectedModel ? '' : ` Selected model "${model}" was not found in AO provider list.`)
      );
    } catch (err: any) {
      setSelectorDiscoveryPreflight(err.response?.data?.data ?? null);
      setSelectorDiscoveryMessage(err.response?.data?.error ?? err.message);
    } finally {
      setSelectorDiscoveryAoModelsLoading(false);
    }
  }, [aoBaseUrl, model]);

  return {
    selectorDiscoveryConfig,
    selectorDiscoveryBundleStatus,
    setSelectorDiscoveryBundleStatus,
    selectorDiscoveryBundleEvaluations,
    selectorDiscoveryAoModels,
    selectorDiscoveryAoModelsLoading,
    aoBaseUrl,
    setAoBaseUrl,
    model,
    setModel,
    providerJson,
    setProviderJson,
    selectorDiscoveryMessage,
    selectorDiscoveryPreflight,
    selectorDiscoverySaveState,
    refreshSelectorDiscoveryBundleStatus,
    refreshSelectorDiscoveryBundleEvaluations,
    handleLoadDefaultSelectorDiscoveryProvider,
    handleSelectorDiscoveryClear,
    handleSelectorDiscoveryTest,
    handleRefreshSelectorDiscoveryAoModels,
  };
}

function snapshotSelectorDiscoveryFields(aoBaseUrl: string, model: string, providerJson: string): string {
  return JSON.stringify({ aoBaseUrl: aoBaseUrl.trim(), model: model.trim(), providerJson });
}
