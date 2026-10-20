import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { SelectorDiscoveryAoModelsResponse } from '@comiccrawler/shared';
import { DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON } from './provider-template';

export type SelectorDiscoverySaveState = { state: 'idle' } | { state: 'saving' }
  | { state: 'saved'; at: string } | { state: 'error'; message: string };
const AUTO_SAVE_DELAY_MS = 1200;

export function useSelectorDiscoverySettings(options: { fetchConfig: () => Promise<void> | void }) {
  const state = useSelectorDiscoveryState();
  const refs = useSelectorDiscoveryRefs();
  const refreshSelectorDiscoveryBundleStatus = useBundleStatusRefresh(state);
  const refreshSelectorDiscoveryBundleEvaluations = useBundleEvaluationsRefresh(state);
  useInitialSelectorDiscovery(options.fetchConfig, state, refs,
    refreshSelectorDiscoveryBundleStatus, refreshSelectorDiscoveryBundleEvaluations);
  useSelectorDiscoveryAutosave(state, refs);
  const context = { state, refs };
  return { ...state, refreshSelectorDiscoveryBundleStatus, refreshSelectorDiscoveryBundleEvaluations,
    handleLoadDefaultSelectorDiscoveryProvider: () => loadDefaultProvider(state),
    handleSelectorDiscoveryClear: () => clearProvider(state),
    handleSelectorDiscoveryTest: () => testProvider(state),
    handleRefreshSelectorDiscoveryAoModels: () => refreshModels(context) };
}

function useSelectorDiscoveryState() {
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
  return { selectorDiscoveryConfig, setSelectorDiscoveryConfig, selectorDiscoveryBundleStatus,
    setSelectorDiscoveryBundleStatus, selectorDiscoveryBundleEvaluations, setSelectorDiscoveryBundleEvaluations,
    selectorDiscoveryAoModels, setSelectorDiscoveryAoModels, selectorDiscoveryAoModelsLoading,
    setSelectorDiscoveryAoModelsLoading, aoBaseUrl, setAoBaseUrl, model, setModel, providerJson, setProviderJson,
    selectorDiscoveryMessage, setSelectorDiscoveryMessage, selectorDiscoveryPreflight, setSelectorDiscoveryPreflight,
    selectorDiscoverySaveState, setSelectorDiscoverySaveState };
}

function useSelectorDiscoveryRefs() {
  const initialLoadRef = useRef(false);
  const lastSavedSnapshotRef = useRef('');
  return { initialLoadRef, lastSavedSnapshotRef };
}

type DiscoveryState = ReturnType<typeof useSelectorDiscoveryState>;
type DiscoveryRefs = ReturnType<typeof useSelectorDiscoveryRefs>;

function useBundleStatusRefresh(state: DiscoveryState) {
  const { setSelectorDiscoveryBundleStatus } = state;
  return useCallback(async () => {
    try {
      const response = await api.getSelectorDiscoveryBundleStatus();
      setSelectorDiscoveryBundleStatus(response.data);
    } catch (error: any) {
      setSelectorDiscoveryBundleStatus({ verified: false, error: error.response?.data?.error ?? error.message });
    }
  }, [setSelectorDiscoveryBundleStatus]);
}

function useBundleEvaluationsRefresh(state: DiscoveryState) {
  const { setSelectorDiscoveryBundleEvaluations } = state;
  return useCallback(async () => {
    try {
      const response = await api.getSelectorDiscoveryBundleEvaluations();
      setSelectorDiscoveryBundleEvaluations(response.data.evaluations ?? []);
    } catch {
      setSelectorDiscoveryBundleEvaluations([]);
    }
  }, [setSelectorDiscoveryBundleEvaluations]);
}

function useInitialSelectorDiscovery(fetchConfig: () => Promise<void> | void, state: DiscoveryState,
  refs: DiscoveryRefs, refreshStatus: () => Promise<void>, refreshEvaluations: () => Promise<void>) {
  const { setSelectorDiscoveryConfig, setAoBaseUrl, setModel, setProviderJson } = state;
  const { initialLoadRef, lastSavedSnapshotRef } = refs;
  useEffect(() => {
    void fetchConfig();
    void loadSelectorDiscoveryConfig({ setSelectorDiscoveryConfig, setAoBaseUrl, setModel, setProviderJson },
      { initialLoadRef, lastSavedSnapshotRef });
    void refreshStatus();
    void refreshEvaluations();
  }, [fetchConfig, initialLoadRef, lastSavedSnapshotRef, refreshEvaluations, refreshStatus,
    setAoBaseUrl, setModel, setProviderJson, setSelectorDiscoveryConfig]);
}

type InitialSetters = Pick<DiscoveryState, 'setSelectorDiscoveryConfig' | 'setAoBaseUrl' | 'setModel' | 'setProviderJson'>;

async function loadSelectorDiscoveryConfig(state: InitialSetters, refs: DiscoveryRefs) {
  try {
    const response = await api.getSelectorDiscoveryConfig();
    applyLoadedConfig(response.data, state, refs);
  } catch {
    // Settings page remains usable when selector discovery is not configured.
  }
}

function applyLoadedConfig(config: any, state: InitialSetters, refs: DiscoveryRefs) {
  const providerJson = config.configured ? '' : DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON;
  state.setSelectorDiscoveryConfig(config);
  state.setAoBaseUrl(config.aoBaseUrl ?? '');
  state.setModel(config.model ?? '');
  state.setProviderJson(providerJson);
  refs.lastSavedSnapshotRef.current = snapshotSelectorDiscoveryFields(config.aoBaseUrl ?? '', config.model ?? '', providerJson);
  refs.initialLoadRef.current = true;
}

function useSelectorDiscoveryAutosave(state: DiscoveryState, refs: DiscoveryRefs) {
  const { aoBaseUrl, model, providerJson, selectorDiscoveryConfig } = state;
  const { setSelectorDiscoveryConfig, setProviderJson, setSelectorDiscoverySaveState } = state;
  const { initialLoadRef, lastSavedSnapshotRef } = refs;
  useEffect(() => {
    if (!initialLoadRef.current) return;
    const request = buildAutosaveRequest(aoBaseUrl, model, providerJson, selectorDiscoveryConfig?.configured,
      lastSavedSnapshotRef.current);
    if (request.kind === 'same') return;
    if (request.kind === 'idle') { setSelectorDiscoverySaveState({ state: 'idle' }); return; }
    if (request.kind === 'error') { setSelectorDiscoverySaveState({ state: 'error', message: request.message }); return; }
    setSelectorDiscoverySaveState({ state: 'saving' });
    const setters = { setSelectorDiscoveryConfig, setProviderJson, setSelectorDiscoverySaveState };
    const timer = setTimeout(() => void saveSelectorDiscovery(request, setters, { initialLoadRef, lastSavedSnapshotRef }), AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [aoBaseUrl, initialLoadRef, lastSavedSnapshotRef, model, providerJson, selectorDiscoveryConfig?.configured,
    setProviderJson, setSelectorDiscoveryConfig, setSelectorDiscoverySaveState]);
}

type AutosaveRequest = { kind: 'save'; snapshot: string; aoBaseUrl: string; model: string;
  providerJson: string; providerDocument?: unknown } | { kind: 'same' } | { kind: 'idle' }
  | { kind: 'error'; message: string };

function buildAutosaveRequest(aoBaseUrl: string, model: string, providerJson: string,
  configured: boolean | undefined, lastSnapshot: string): AutosaveRequest {
  const snapshot = snapshotSelectorDiscoveryFields(aoBaseUrl, model, providerJson);
  if (snapshot === lastSnapshot) return { kind: 'same' };
  if (!aoBaseUrl.trim() || !model.trim() || (!configured && !providerJson.trim())) return { kind: 'idle' };
  try {
    const providerDocument = providerJson.trim() ? JSON.parse(providerJson.trim()) : undefined;
    return { kind: 'save', snapshot, aoBaseUrl, model, providerJson, providerDocument };
  } catch {
    return { kind: 'error', message: 'Provider JSON is not valid JSON; waiting for fixes before auto-saving.' };
  }
}

type AutosaveSetters = Pick<DiscoveryState, 'setSelectorDiscoveryConfig' | 'setProviderJson' | 'setSelectorDiscoverySaveState'>;

async function saveSelectorDiscovery(request: Extract<AutosaveRequest, { kind: 'save' }>, state: AutosaveSetters, refs: DiscoveryRefs) {
  try {
    const response = await api.updateSelectorDiscoveryConfig({ aoBaseUrl: request.aoBaseUrl,
      model: request.model, ...(request.providerDocument !== undefined ? { providerDocument: request.providerDocument } : {}) });
    state.setSelectorDiscoveryConfig(response.data);
    refs.lastSavedSnapshotRef.current = snapshotSelectorDiscoveryFields(request.aoBaseUrl, request.model,
      request.providerDocument !== undefined ? '' : request.providerJson);
    if (request.providerDocument !== undefined) state.setProviderJson('');
    state.setSelectorDiscoverySaveState({ state: 'saved', at: new Date().toLocaleTimeString() });
  } catch (error: any) {
    state.setSelectorDiscoverySaveState({ state: 'error', message: error.response?.data?.error ?? error.message });
  }
}

function loadDefaultProvider(state: DiscoveryState) {
  state.setModel('');
  state.setProviderJson(DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON);
  state.setSelectorDiscoveryMessage('Loaded the OpenCode provider template. Pick a model returned by AO; settings save automatically.');
}

async function clearProvider(state: DiscoveryState) {
  const response = await api.clearSelectorDiscoveryProvider();
  state.setSelectorDiscoveryConfig(response.data);
  state.setModel('');
  state.setProviderJson(DEFAULT_SELECTOR_DISCOVERY_PROVIDER_JSON);
  state.setSelectorDiscoveryMessage('Selector discovery provider cleared.');
}

async function testProvider(state: DiscoveryState) {
  state.setSelectorDiscoveryMessage(null);
  state.setSelectorDiscoveryPreflight(null);
  try {
    const response = await api.testSelectorDiscoveryConfig();
    applyTestResponse(response.data, state);
  } catch (error: any) {
    state.setSelectorDiscoveryPreflight(error.response?.data?.data ?? null);
    state.setSelectorDiscoveryMessage(error.response?.data?.error ?? error.message);
  }
}

function applyTestResponse(data: any, state: DiscoveryState) {
  state.setSelectorDiscoveryPreflight(data);
  state.setSelectorDiscoveryAoModels({ conversationId: data.conversationId, bundleHash: data.bundleHash,
    providers: data.providers ?? [], models: data.models ?? [] });
  state.setSelectorDiscoveryMessage(`AO smoke test passed. Bundle ${data.bundleHash?.slice(0, 12) ?? '-'} / ${data.model}`);
}

async function refreshModels(context: { state: DiscoveryState; refs: DiscoveryRefs }) {
  const { state } = context;
  state.setSelectorDiscoveryMessage(null);
  state.setSelectorDiscoveryPreflight(null);
  state.setSelectorDiscoveryAoModelsLoading(true);
  try {
    const response = await api.getSelectorDiscoveryAoModels(state.aoBaseUrl);
    state.setSelectorDiscoveryAoModels(response.data);
    state.setSelectorDiscoveryMessage(formatModelsMessage(response.data, state.model));
  } catch (error: any) {
    state.setSelectorDiscoveryPreflight(error.response?.data?.data ?? null);
    state.setSelectorDiscoveryMessage(error.response?.data?.error ?? error.message);
  } finally {
    state.setSelectorDiscoveryAoModelsLoading(false);
  }
}

function formatModelsMessage(data: SelectorDiscoveryAoModelsResponse, model: string) {
  const missing = data.models.some((item) => item.id === model) ? '' : ` Selected model "${model}" was not found in AO provider list.`;
  return `AO returned ${data.providers.length} providers and ${data.models.length} models.${missing}`;
}

function snapshotSelectorDiscoveryFields(aoBaseUrl: string, model: string, providerJson: string): string {
  return JSON.stringify({ aoBaseUrl: aoBaseUrl.trim(), model: model.trim(), providerJson });
}
