import { create } from 'zustand';
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
    mode: 'static' | 'headless' | 'auto';
    headless: boolean;
    maxInstances: number;
    timeout: number;
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
    waitForSelector?: string;
    postLoadDelayMs?: number;
    challengeAutoAttempt?: boolean;
    challengeWaitMs?: number;
    channel?: string;
    storageStatePath?: string;
    userDataDir?: string;
    handoff?: {
      mode: 'snapshot' | 'cdp' | 'managed';
      cdpUrl?: string;
      userDataDir?: string;
      channel?: string;
    };
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

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  loading: false,
  error: null,

  fetchConfig: async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.getConfig();
      set({ config: response.data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  updateConfig: async (config: Partial<GlobalConfig>) => {
    set({ loading: true, error: null });
    try {
      await api.updateConfig(config);
      await get().fetchConfig();
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  updateLanguage: async (language: string) => {
    const current = get().config;
    const fallback = current?.i18n?.fallback ?? 'en';

    set((state) => ({
      config: state.config
        ? {
            ...state.config,
            i18n: {
              ...state.config.i18n,
              language,
            },
          }
        : state.config,
      error: null,
    }));

    try {
      const response = await api.updateConfig({
        i18n: {
          language,
          fallback,
        },
      });

      set({ config: response.data });
    } catch (error: any) {
      set({ error: error.message });
      await get().fetchConfig();
    }
  },

  resetConfig: async () => {
    set({ loading: true, error: null });
    try {
      await api.resetConfig();
      await get().fetchConfig();
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
