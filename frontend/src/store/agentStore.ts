import { create } from 'zustand';
import { api } from '../api/client';

export interface AgentVersionSummary {
  version: string;
  status: 'candidate' | 'active' | 'rolled_back' | 'rejected';
  repairMode?: 'selector-only' | 'parser-hook';
  basedOnVersion?: string | null;
  sourceSessionId?: string;
  promotedAt?: string;
  rolledBackAt?: string;
  testResults?: {
    passed: number;
    failed: number;
  };
  validation?: {
    syntaxValid?: boolean;
    fixtureResults?: Array<{
      fixtureName: string;
      valid: boolean;
      errors: string[];
    }>;
  };
}

export interface AgentSessionSummary {
  sessionId?: string;
  status: string;
  pageType?: string;
  repairMode?: string;
  triggerKey?: string;
  currentAttempt: number;
  maxAttempts: number;
  candidateVersion?: string;
  sourceVersion?: string;
  lastFailure?: {
    reason: string;
    timestamp: string;
  };
}

export interface AgentAdapterListItem {
  adapterId: string;
  sessionStatus: string | null;
  activeVersion: string | null;
  latestCandidate: string | null;
  versionCount: number;
}

export interface AgentAdapterDetail {
  adapterId: string;
  session: AgentSessionSummary | null;
  activeVersion: AgentVersionSummary | null;
  latestCandidate: AgentVersionSummary | null;
  triggerProgress: {
    adapterId: string;
    triggerKey: string;
    pageType: string;
    selectorName?: string;
    count: number;
    threshold: number;
    remainingFailures: number;
    inCooldown: boolean;
    cooldownRemainingMs: number;
    activeSession: boolean;
    lastMessage: string;
    firstOccurredAt: string;
    lastOccurredAt: string;
  } | null;
  versions: {
    adapterId: string;
    activeVersion: string | null;
    versions: AgentVersionSummary[];
  } | null;
}

export interface AgentRealtimeMessage {
  event?: string;
  data?: Record<string, unknown>;
}

interface AgentState {
  adapters: AgentAdapterListItem[];
  selectedAdapterId: string | null;
  selectedAdapter: AgentAdapterDetail | null;
  loading: boolean;
  actionLoading: boolean;
  error: string | null;

  fetchAdapters: () => Promise<void>;
  selectAdapter: (adapterId: string) => Promise<void>;
  refreshSelectedAdapter: () => Promise<void>;
  promoteCandidate: (adapterId: string, version?: string) => Promise<void>;
  rejectCandidate: (adapterId: string, version?: string) => Promise<void>;
  rollbackAdapter: (adapterId: string, version?: string) => Promise<void>;
  applyRealtimeEvent: (message: AgentRealtimeMessage) => Promise<void>;
  clearError: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  adapters: [],
  selectedAdapterId: null,
  selectedAdapter: null,
  loading: false,
  actionLoading: false,
  error: null,

  fetchAdapters: async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.getAgentAdapters();
      set({ adapters: response.data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  selectAdapter: async (adapterId: string) => {
    set({ loading: true, error: null, selectedAdapterId: adapterId });
    try {
      const response = await api.getAgentAdapter(adapterId);
      set({ selectedAdapter: response.data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  refreshSelectedAdapter: async () => {
    const adapterId = get().selectedAdapterId;
    if (!adapterId) return;

    try {
      const response = await api.getAgentAdapter(adapterId);
      set({ selectedAdapter: response.data });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  promoteCandidate: async (adapterId: string, version?: string) => {
    set({ actionLoading: true, error: null });
    try {
      await api.promoteAgentCandidate(adapterId, version);
      await get().applyRealtimeEvent({
        event: 'adapter:repair:promoted',
        data: { adapterId, version },
      });
      if (get().selectedAdapterId === adapterId) {
        await get().refreshSelectedAdapter();
      }
      set({ actionLoading: false });
    } catch (error: any) {
      set({ error: error.message, actionLoading: false });
    }
  },

  rejectCandidate: async (adapterId: string, version?: string) => {
    set({ actionLoading: true, error: null });
    try {
      await api.rejectAgentCandidate(adapterId, version);
      await get().applyRealtimeEvent({
        event: 'adapter:repair:failed',
        data: { adapterId, error: `Candidate ${version ?? ''} rejected`.trim() },
      });
      if (get().selectedAdapterId === adapterId) {
        await get().refreshSelectedAdapter();
      }
      set({ actionLoading: false });
    } catch (error: any) {
      set({ error: error.message, actionLoading: false });
    }
  },

  rollbackAdapter: async (adapterId: string, version?: string) => {
    set({ actionLoading: true, error: null });
    try {
      const response = await api.rollbackAgentAdapter(adapterId, version);
      await get().applyRealtimeEvent({
        event: 'adapter:repair:rolled-back',
        data: {
          adapterId,
          fromVersion: response.data.previousVersion,
          toVersion: response.data.currentVersion,
        },
      });
      if (get().selectedAdapterId === adapterId) {
        await get().refreshSelectedAdapter();
      }
      set({ actionLoading: false });
    } catch (error: any) {
      set({ error: error.message, actionLoading: false });
    }
  },

  applyRealtimeEvent: async (message: AgentRealtimeMessage) => {
    if (!message.event?.startsWith('adapter:repair:')) {
      return;
    }

    const adapterId = typeof message.data?.adapterId === 'string' ? message.data.adapterId : null;
    if (!adapterId) return;

    const currentState = get();
    const patchAdapterSummary = (updater: (adapter: AgentAdapterListItem) => AgentAdapterListItem) => {
      set({
        adapters: get().adapters.map((adapter) =>
          adapter.adapterId === adapterId ? updater(adapter) : adapter
        ),
      });
    };
    const patchSelectedAdapter = (updater: (detail: AgentAdapterDetail) => AgentAdapterDetail) => {
      const selected = get().selectedAdapter;
      if (!selected || get().selectedAdapterId !== adapterId) {
        return;
      }

      set({
        selectedAdapter: updater(selected),
      });
    };
    let shouldRefreshSelectedDetail = false;

    if (message.event === 'adapter:repair:started') {
      patchAdapterSummary((adapter) => ({
        ...adapter,
        sessionStatus: 'in_progress',
      }));
      patchSelectedAdapter((detail) => ({
        ...detail,
        session: detail.session ? { ...detail.session, status: 'in_progress' } : detail.session,
      }));
    }

    if (message.event === 'adapter:repair:validated') {
      patchAdapterSummary((adapter) => ({
        ...adapter,
        sessionStatus: 'running',
      }));
      patchSelectedAdapter((detail) => ({
        ...detail,
        session: detail.session ? { ...detail.session, status: 'running' } : detail.session,
      }));
    }

    if (message.event === 'adapter:repair:candidate-created') {
      const version = typeof message.data?.version === 'string' ? message.data.version : null;
      patchAdapterSummary((adapter) => ({
        ...adapter,
        sessionStatus: 'awaiting_review',
        latestCandidate: version ?? adapter.latestCandidate,
        versionCount: version && version !== adapter.latestCandidate ? adapter.versionCount + 1 : adapter.versionCount,
      }));
      patchSelectedAdapter((detail) => ({
        ...detail,
        session: detail.session
          ? { ...detail.session, status: 'awaiting_review', candidateVersion: version ?? detail.session.candidateVersion }
          : detail.session,
      }));
      shouldRefreshSelectedDetail = true;
    }

    if (message.event === 'adapter:repair:promotion-requested') {
      patchAdapterSummary((adapter) => ({
        ...adapter,
        sessionStatus: 'awaiting_review',
      }));
      patchSelectedAdapter((detail) => ({
        ...detail,
        session: detail.session ? { ...detail.session, status: 'awaiting_review' } : detail.session,
      }));
    }

    if (message.event === 'adapter:repair:promoted') {
      const version = typeof message.data?.version === 'string' ? message.data.version : null;
      patchAdapterSummary((adapter) => ({
        ...adapter,
        sessionStatus: 'completed',
        activeVersion: version ?? adapter.activeVersion,
        latestCandidate: null,
      }));
      patchSelectedAdapter((detail) => ({
        ...detail,
        session: detail.session
          ? { ...detail.session, status: 'completed', candidateVersion: undefined }
          : detail.session,
        activeVersion: detail.activeVersion
          ? { ...detail.activeVersion, version: version ?? detail.activeVersion.version, status: 'active' }
          : detail.activeVersion,
        latestCandidate: null,
        versions: detail.versions
          ? {
              ...detail.versions,
              activeVersion: version ?? detail.versions.activeVersion,
              versions: detail.versions.versions.map((entry) => {
                if (entry.version === version) {
                  return { ...entry, status: 'active' };
                }
                if (entry.status === 'active') {
                  return { ...entry, status: 'rejected' };
                }
                return entry;
              }),
            }
          : detail.versions,
      }));
    }

    if (message.event === 'adapter:repair:failed') {
      patchAdapterSummary((adapter) => ({
        ...adapter,
        sessionStatus: 'failed',
      }));
      patchSelectedAdapter((detail) => ({
        ...detail,
        session: detail.session ? { ...detail.session, status: 'failed' } : detail.session,
      }));
    }

    if (message.event === 'adapter:repair:rolled-back') {
      const toVersion = typeof message.data?.toVersion === 'string' ? message.data.toVersion : null;
      const fromVersion = typeof message.data?.fromVersion === 'string' ? message.data.fromVersion : null;
      patchAdapterSummary((adapter) => ({
        ...adapter,
        sessionStatus: 'rolled_back',
        activeVersion: toVersion ?? adapter.activeVersion,
      }));
      patchSelectedAdapter((detail) => ({
        ...detail,
        session: detail.session ? { ...detail.session, status: 'rolled_back' } : detail.session,
        activeVersion: detail.activeVersion
          ? { ...detail.activeVersion, version: toVersion ?? detail.activeVersion.version, status: 'active' }
          : detail.activeVersion,
        versions: detail.versions
          ? {
              ...detail.versions,
              activeVersion: toVersion ?? detail.versions.activeVersion,
              versions: detail.versions.versions.map((entry) => {
                if (toVersion && entry.version === toVersion) {
                  return { ...entry, status: 'active' };
                }
                if (fromVersion && entry.version === fromVersion) {
                  return { ...entry, status: 'rolled_back' };
                }
                return entry;
              }),
            }
          : detail.versions,
      }));
    }

    if (currentState.selectedAdapterId === adapterId && shouldRefreshSelectedDetail) {
      await get().refreshSelectedAdapter();
    }
  },

  clearError: () => set({ error: null }),
}));
