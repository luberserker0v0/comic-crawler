import { create } from 'zustand';
import { api } from '../api/client';

export interface Adapter {
  id: string;
  name: string;
  domains: string[];
  capabilities: {
    verification: boolean;
    metadata: boolean;
    chapterImages: boolean;
  };
}

interface AdapterState {
  adapters: Adapter[];
  loading: boolean;
  error: string | null;

  fetchAdapters: () => Promise<void>;
  clearError: () => void;
}

export const useAdapterStore = create<AdapterState>((set) => ({
  adapters: [],
  loading: false,
  error: null,

  fetchAdapters: async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.getAdapters();
      set({ adapters: response.data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
