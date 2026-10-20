import { create, type StateCreator } from 'zustand';
import { api } from '../api/client';

export interface GlobalConfig {
  download: {
    directory: string;
    concurrency: number;
    namingTemplate: string;
    imageFormat: string;
    imageQuality: number;
  };
  concurrency: {
    taskLevel: number;
    siteLevel: number;
  };
  network: {
    proxy?: string;
    timeout: number;
    retries: number;
    retryDelay: number;
    userAgent?: string;
  };
  browser: {
    timeout: number;
    workerWaitTimeoutMs?: number;
    postLoadDelayMs?: number;
  };
  server: {
    port: number;
    host: string;
  };
  log: {
    level: string;
  };
  i18n: {
    language: string;
    fallback: string;
  };
}

interface ConfigState {
  config: GlobalConfig | null;
  loading: boolean;
  error: string | null;

  fetchConfig: () => Promise<void>;
  updateConfig: (config: Partial<GlobalConfig>) => Promise<void>;
  updateLanguage: (language: string) => Promise<void>;
  resetConfig: () => Promise<void>;
  clearError: () => void;
}

type StoreSet = Parameters<StateCreator<ConfigState>>[0];
type StoreGet = Parameters<StateCreator<ConfigState>>[1];

export const useConfigStore = create<ConfigState>((set, get) => createConfigState(set, get));

function createConfigState(set: StoreSet, get: StoreGet): ConfigState {
  return {
  config: null,
  loading: false,
  error: null,
  fetchConfig: createFetchConfig(set),
  updateConfig: createUpdateConfig(set, get),
  updateLanguage: createUpdateLanguage(set, get),
  resetConfig: createResetConfig(set, get),
  clearError: () => set({ error: null }),
  };
}

function createFetchConfig(set: StoreSet) {
  return async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.getConfig();
      set({ config: response.data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  };
}

function createUpdateConfig(set: StoreSet, get: StoreGet) {
  return async (config: Partial<GlobalConfig>) => {
    set({ loading: true, error: null });
    try {
      await api.updateConfig(config);
      await get().fetchConfig();
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  };
}

function createUpdateLanguage(set: StoreSet, get: StoreGet) {
  return async (language: string) => {
    const current = get().config;
    const fallback = current?.i18n?.fallback ?? 'en';
    set((state) => updateConfigLanguage(state, language));
    try {
      const response = await api.updateConfig({ i18n: { language, fallback } });
      set({ config: response.data });
    } catch (error: any) {
      set({ error: error.message });
      await get().fetchConfig();
    }
  };
}

function updateConfigLanguage(state: ConfigState, language: string): Partial<ConfigState> {
  return { config: state.config ? { ...state.config,
    i18n: { ...state.config.i18n, language } } : state.config, error: null };
}

function createResetConfig(set: StoreSet, get: StoreGet) {
  return async () => {
    set({ loading: true, error: null });
    try {
      await api.resetConfig();
      await get().fetchConfig();
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  };
}
