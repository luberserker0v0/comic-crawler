import { create, type StateCreator } from 'zustand';
import { api } from '../api/client';

export interface AgentVersionSummary {
  version: string;
  status: 'candidate' | 'active' | 'rolled_back' | 'rejected';
  repairMode?: 'selector-only' | 'parser-hook';
  basedOnVersion?: string | null;
  sourceSessionId?: string;
  promotedAt?: string;
  rolledBackAt?: string;
  testResults?: { passed: number; failed: number };
  validation?: { syntaxValid?: boolean; fixtureResults?: Array<{ fixtureName: string; valid: boolean; errors: string[] }> };
}

export interface AgentSessionSummary {
  sessionId?: string; status: string; pageType?: string; repairMode?: string; triggerKey?: string;
  currentAttempt: number; maxAttempts: number; candidateVersion?: string; sourceVersion?: string;
  lastFailure?: { reason: string; timestamp: string };
}

export interface AgentAdapterListItem {
  adapterId: string; sessionStatus: string | null; activeVersion: string | null;
  latestCandidate: string | null; versionCount: number;
}

export interface AgentAdapterDetail {
  adapterId: string;
  session: AgentSessionSummary | null;
  activeVersion: AgentVersionSummary | null;
  latestCandidate: AgentVersionSummary | null;
  triggerProgress: AgentTriggerProgress | null;
  versions: { adapterId: string; activeVersion: string | null; versions: AgentVersionSummary[] } | null;
}

interface AgentTriggerProgress {
  adapterId: string; triggerKey: string; pageType: string; selectorName?: string; count: number;
  threshold: number; remainingFailures: number; inCooldown: boolean; cooldownRemainingMs: number;
  activeSession: boolean; lastMessage: string; firstOccurredAt: string; lastOccurredAt: string;
}

export interface AgentRealtimeMessage { event?: string; data?: Record<string, unknown> }

interface AgentState {
  adapters: AgentAdapterListItem[]; selectedAdapterId: string | null; selectedAdapter: AgentAdapterDetail | null;
  loading: boolean; actionLoading: boolean; error: string | null;
  fetchAdapters(): Promise<void>;
  selectAdapter(adapterId: string): Promise<void>;
  refreshSelectedAdapter(): Promise<void>;
  promoteCandidate(adapterId: string, version?: string): Promise<void>;
  rejectCandidate(adapterId: string, version?: string): Promise<void>;
  rollbackAdapter(adapterId: string, version?: string): Promise<void>;
  applyRealtimeEvent(message: AgentRealtimeMessage): Promise<void>;
  clearError(): void;
}

type StoreSet = Parameters<StateCreator<AgentState>>[0];
type StoreGet = Parameters<StateCreator<AgentState>>[1];

export const useAgentStore = create<AgentState>((set, get) => createAgentState(set, get));

function createAgentState(set: StoreSet, get: StoreGet): AgentState {
  return { adapters: [], selectedAdapterId: null, selectedAdapter: null, loading: false,
    actionLoading: false, error: null, fetchAdapters: createFetchAdapters(set),
    selectAdapter: createSelectAdapter(set), refreshSelectedAdapter: createRefreshSelected(set, get),
    promoteCandidate: createPromoteCandidate(set, get), rejectCandidate: createRejectCandidate(set, get),
    rollbackAdapter: createRollbackAdapter(set, get), applyRealtimeEvent: createRealtimeHandler(set, get),
    clearError: () => set({ error: null }) };
}

function createFetchAdapters(set: StoreSet) {
  return async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.getAgentAdapters();
      set({ adapters: response.data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  };
}

function createSelectAdapter(set: StoreSet) {
  return async (adapterId: string) => {
    set({ loading: true, error: null, selectedAdapterId: adapterId });
    try {
      const response = await api.getAgentAdapter(adapterId);
      set({ selectedAdapter: response.data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  };
}

function createRefreshSelected(set: StoreSet, get: StoreGet) {
  return async () => {
    const adapterId = get().selectedAdapterId;
    if (!adapterId) return;
    try {
      const response = await api.getAgentAdapter(adapterId);
      set({ selectedAdapter: response.data });
    } catch (error: any) {
      set({ error: error.message });
    }
  };
}

function createPromoteCandidate(set: StoreSet, get: StoreGet) {
  return async (adapterId: string, version?: string) => {
    beginAction(set);
    try {
      await api.promoteAgentCandidate(adapterId, version);
      await get().applyRealtimeEvent({ event: 'adapter:repair:promoted', data: { adapterId, version } });
      await refreshMatchingAdapter(get, adapterId);
      set({ actionLoading: false });
    } catch (error: any) {
      set({ error: error.message, actionLoading: false });
    }
  };
}

function createRejectCandidate(set: StoreSet, get: StoreGet) {
  return async (adapterId: string, version?: string) => {
    beginAction(set);
    try {
      await api.rejectAgentCandidate(adapterId, version);
      await get().applyRealtimeEvent({ event: 'adapter:repair:failed',
        data: { adapterId, error: `Candidate ${version ?? ''} rejected`.trim() } });
      await refreshMatchingAdapter(get, adapterId);
      set({ actionLoading: false });
    } catch (error: any) {
      set({ error: error.message, actionLoading: false });
    }
  };
}

function createRollbackAdapter(set: StoreSet, get: StoreGet) {
  return async (adapterId: string, version?: string) => {
    beginAction(set);
    try {
      const response = await api.rollbackAgentAdapter(adapterId, version);
      await get().applyRealtimeEvent({ event: 'adapter:repair:rolled-back', data: { adapterId,
        fromVersion: response.data.previousVersion, toVersion: response.data.currentVersion } });
      await refreshMatchingAdapter(get, adapterId);
      set({ actionLoading: false });
    } catch (error: any) {
      set({ error: error.message, actionLoading: false });
    }
  };
}

function beginAction(set: StoreSet) { set({ actionLoading: true, error: null }); }

async function refreshMatchingAdapter(get: StoreGet, adapterId: string) {
  if (get().selectedAdapterId === adapterId) await get().refreshSelectedAdapter();
}

function createRealtimeHandler(set: StoreSet, get: StoreGet) {
  return async (message: AgentRealtimeMessage) => {
    if (!message.event?.startsWith('adapter:repair:')) return;
    const adapterId = stringValue(message.data?.adapterId);
    if (!adapterId) return;
    set((state) => applyAgentEvent(state, message.event!, message.data ?? {}, adapterId));
    if (message.event === 'adapter:repair:candidate-created' && get().selectedAdapterId === adapterId) {
      await get().refreshSelectedAdapter();
    }
  };
}

function applyAgentEvent(state: AgentState, event: string, data: Record<string, unknown>, adapterId: string): Partial<AgentState> {
  const adapters = state.adapters.map((adapter) => adapter.adapterId === adapterId
    ? updateAdapterSummary(adapter, event, data) : adapter);
  const selectedAdapter = state.selectedAdapterId === adapterId && state.selectedAdapter
    ? updateAdapterDetail(state.selectedAdapter, event, data) : state.selectedAdapter;
  return { adapters, selectedAdapter };
}

function updateAdapterSummary(adapter: AgentAdapterListItem, event: string, data: Record<string, unknown>) {
  if (event === 'adapter:repair:started') return { ...adapter, sessionStatus: 'in_progress' };
  if (event === 'adapter:repair:validated') return { ...adapter, sessionStatus: 'running' };
  if (event === 'adapter:repair:candidate-created') return candidateSummary(adapter, data);
  if (event === 'adapter:repair:promotion-requested') return { ...adapter, sessionStatus: 'awaiting_review' };
  if (event === 'adapter:repair:promoted') return promotedSummary(adapter, data);
  if (event === 'adapter:repair:failed') return { ...adapter, sessionStatus: 'failed' };
  if (event === 'adapter:repair:rolled-back') return { ...adapter, sessionStatus: 'rolled_back',
    activeVersion: stringValue(data.toVersion) ?? adapter.activeVersion };
  return adapter;
}

function candidateSummary(adapter: AgentAdapterListItem, data: Record<string, unknown>): AgentAdapterListItem {
  const version = stringValue(data.version);
  return { ...adapter, sessionStatus: 'awaiting_review', latestCandidate: version ?? adapter.latestCandidate,
    versionCount: version && version !== adapter.latestCandidate ? adapter.versionCount + 1 : adapter.versionCount };
}

function promotedSummary(adapter: AgentAdapterListItem, data: Record<string, unknown>): AgentAdapterListItem {
  return { ...adapter, sessionStatus: 'completed', activeVersion: stringValue(data.version) ?? adapter.activeVersion,
    latestCandidate: null };
}

function updateAdapterDetail(detail: AgentAdapterDetail, event: string, data: Record<string, unknown>) {
  if (event === 'adapter:repair:started') return updateSessionStatus(detail, 'in_progress');
  if (event === 'adapter:repair:validated') return updateSessionStatus(detail, 'running');
  if (event === 'adapter:repair:candidate-created') return candidateDetail(detail, data);
  if (event === 'adapter:repair:promotion-requested') return updateSessionStatus(detail, 'awaiting_review');
  if (event === 'adapter:repair:promoted') return promotedDetail(detail, data);
  if (event === 'adapter:repair:failed') return updateSessionStatus(detail, 'failed');
  if (event === 'adapter:repair:rolled-back') return rolledBackDetail(detail, data);
  return detail;
}

function updateSessionStatus(detail: AgentAdapterDetail, status: string): AgentAdapterDetail {
  return { ...detail, session: detail.session ? { ...detail.session, status } : detail.session };
}

function candidateDetail(detail: AgentAdapterDetail, data: Record<string, unknown>): AgentAdapterDetail {
  const version = stringValue(data.version);
  return { ...detail, session: detail.session ? { ...detail.session, status: 'awaiting_review',
    candidateVersion: version ?? detail.session.candidateVersion } : detail.session };
}

function promotedDetail(detail: AgentAdapterDetail, data: Record<string, unknown>): AgentAdapterDetail {
  const version = stringValue(data.version);
  return { ...detail, session: detail.session ? { ...detail.session, status: 'completed',
    candidateVersion: undefined } : detail.session,
  activeVersion: detail.activeVersion ? { ...detail.activeVersion,
    version: version ?? detail.activeVersion.version, status: 'active' } : detail.activeVersion,
  latestCandidate: null, versions: updatePromotedVersions(detail.versions, version) };
}

function updatePromotedVersions(versions: AgentAdapterDetail['versions'], version?: string) {
  if (!versions) return versions;
  return { ...versions, activeVersion: version ?? versions.activeVersion,
    versions: versions.versions.map((entry) => entry.version === version ? { ...entry, status: 'active' }
      : entry.status === 'active' ? { ...entry, status: 'rejected' } : entry) } as typeof versions;
}

function rolledBackDetail(detail: AgentAdapterDetail, data: Record<string, unknown>): AgentAdapterDetail {
  const toVersion = stringValue(data.toVersion), fromVersion = stringValue(data.fromVersion);
  return { ...updateSessionStatus(detail, 'rolled_back'),
    activeVersion: detail.activeVersion ? { ...detail.activeVersion,
      version: toVersion ?? detail.activeVersion.version, status: 'active' } : detail.activeVersion,
    versions: updateRolledBackVersions(detail.versions, toVersion, fromVersion) };
}

function updateRolledBackVersions(versions: AgentAdapterDetail['versions'], toVersion?: string, fromVersion?: string) {
  if (!versions) return versions;
  return { ...versions, activeVersion: toVersion ?? versions.activeVersion,
    versions: versions.versions.map((entry) => {
      if (toVersion && entry.version === toVersion) return { ...entry, status: 'active' };
      if (fromVersion && entry.version === fromVersion) return { ...entry, status: 'rolled_back' };
      return entry;
    }) } as typeof versions;
}

function stringValue(value: unknown) { return typeof value === 'string' ? value : undefined; }
