import type { EventBus } from '../events/bus';
import type { IStorage } from '../storage/types';
import { AgentNotifier } from './notifier';
import { PromotionManager } from './promotion-manager';
import { RollbackManager } from './rollback-manager';
import { SessionManager } from './session-manager';
import { AgentTriggerMonitor } from './trigger-monitor';
import { VersionManager } from './version-manager';
import type { AgentSession, AgentTriggerProgress, AgentVersion, AgentVersions } from './types';

export interface AgentAdapterState {
  adapterId: string;
  session: AgentSession | null;
  activeVersion: AgentVersion | null;
  latestCandidate: AgentVersion | null;
  versions: AgentVersions | null;
  triggerProgress: AgentTriggerProgress | null;
}

export class AgentAdminService {
  private readonly sessionManager: SessionManager;
  private readonly versionManager: VersionManager;
  private readonly promotionManager: PromotionManager;
  private readonly rollbackManager: RollbackManager;
  private readonly triggerMonitor?: AgentTriggerMonitor;

  constructor(
    workspacePath: string,
    storage: IStorage,
    eventBus?: EventBus,
    notifier?: AgentNotifier,
    triggerMonitor?: AgentTriggerMonitor
  ) {
    this.sessionManager = new SessionManager(workspacePath);
    this.versionManager = new VersionManager(workspacePath);
    this.promotionManager = new PromotionManager(workspacePath, eventBus, notifier);
    this.rollbackManager = new RollbackManager(workspacePath, storage, eventBus, notifier);
    this.triggerMonitor = triggerMonitor;
  }

  async getAdapterState(adapterId: string): Promise<AgentAdapterState> {
    const [session, activeVersion, latestCandidate, versions] = await Promise.all([
      this.sessionManager.load(adapterId),
      this.versionManager.getActiveVersion(adapterId),
      this.versionManager.getLatestCandidateVersion(adapterId),
      this.versionManager.load(adapterId),
    ]);

    return {
      adapterId,
      session,
      activeVersion,
      latestCandidate,
      versions,
      triggerProgress: this.triggerMonitor?.getProgress(adapterId) ?? null,
    };
  }

  async listAdapterStates(adapterIds: string[]): Promise<AgentAdapterState[]> {
    return Promise.all(adapterIds.map((adapterId) => this.getAdapterState(adapterId)));
  }

  async promoteCandidate(adapterId: string, version?: string) {
    return this.promotionManager.promoteCandidate(adapterId, version);
  }

  async rejectCandidate(adapterId: string, version?: string) {
    return this.promotionManager.rejectCandidate(adapterId, version);
  }

  async rollback(adapterId: string, version?: string) {
    if (version) {
      return this.rollbackManager.rollbackToVersion(adapterId, version);
    }

    return this.rollbackManager.rollback(adapterId);
  }
}
