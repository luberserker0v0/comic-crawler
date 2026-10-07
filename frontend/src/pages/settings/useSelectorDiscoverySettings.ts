import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { SelectorDiscoveryAoModelsResponse } from '@comiccrawler/shared';
import { DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON } from './provider-template';

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
    }).catch(() => undefined);
    refreshSelectorDiscoveryBundleStatus();
    refreshSelectorDiscoveryBundleEvaluations();
  }, [fetchConfig, refreshSelectorDiscoveryBundleStatus, refreshSelectorDiscoveryBundleEvaluations]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSelectorDiscoverySave = useCallback(async () => {
    setSelectorDiscoveryMessage(null);
    setSelectorDiscoveryPreflight(null);
    try {
      const trimmedProviderJson = providerJson.trim();
      const response = await api.updateSelectorDiscoveryConfig({
        aoBaseUrl,
        model,
        ...(trimmedProviderJson ? { providerDocument: JSON.parse(trimmedProviderJson) } : {}),
      });
      setSelectorDiscoveryConfig(response.data);
      setSelectorDiscoveryMessage('Selector discovery settings saved.');
      setProviderJson('');
    } catch (err: any) {
      setSelectorDiscoveryMessage(err.response?.data?.error ?? err.message);
    }
  }, [aoBaseUrl, model, providerJson]);

  const handleLoadDefaultSelectorDiscoveryProvider = useCallback(() => {
    setModel('');
    setProviderJson(DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON);
    setSelectorDiscoveryMessage('Loaded the OpenCode provider template. Pick a model returned by AO, then save selector-discovery.');
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
      const response = await api.getSelectorDiscoveryAoModels();
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
  }, [model]);

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
    refreshSelectorDiscoveryBundleStatus,
    refreshSelectorDiscoveryBundleEvaluations,
    handleSelectorDiscoverySave,
    handleLoadDefaultSelectorDiscoveryProvider,
    handleSelectorDiscoveryClear,
    handleSelectorDiscoveryTest,
    handleRefreshSelectorDiscoveryAoModels,
  };
}
