import type { IStorage } from '../storage/types';
import type { EventBus } from '../events/bus';
import { VersionManager } from './version-manager';
import { SessionManager } from './session-manager';
import { AgentNotifier } from './notifier';

export interface RollbackResult {
  success: boolean;
  previousVersion?: string;
  currentVersion?: string;
  error?: string;
}

export class RollbackManager {
  private versionManager: VersionManager;
  private sessionManager: SessionManager;

  constructor(
    workspacePath: string,
    storage: IStorage,
    private readonly eventBus?: EventBus,
    private readonly notifier?: AgentNotifier
  ) {
    this.versionManager = new VersionManager(workspacePath);
    this.sessionManager = new SessionManager(workspacePath);
  }

  async rollback(adapterId: string): Promise<RollbackResult> {
    const currentActive = await this.versionManager.getActiveVersion(adapterId);
    const previousVersion = await this.versionManager.getPreviousVersion(adapterId);
    if (!previousVersion) return { success: false, error: 'No previous version available' };
    return this.performRollback(adapterId, previousVersion.version, currentActive?.version,
      'Manual rollback to previous version', 'Failed to rollback');
  }

  async rollbackToVersion(adapterId: string, version: string): Promise<RollbackResult> {
    const currentActive = await this.versionManager.getActiveVersion(adapterId);
    return this.performRollback(adapterId, version, currentActive?.version,
      'Manual rollback to target version', `Version ${version} not found`);
  }

  private async performRollback(adapterId: string, version: string, fromVersion: string | undefined,
    reason: string, failure: string): Promise<RollbackResult> {
    const success = await this.versionManager.rollbackToVersion(adapterId, version);
    if (!success) return { success: false, error: failure };
    await this.sessionManager.rollback(adapterId);
    this.eventBus?.emit('adapter:repair:rolled-back', { adapterId, fromVersion, toVersion: version });
    await this.notifier?.notifyRollback({ adapterId, fromVersion, toVersion: version, reason });
    return { success: true, previousVersion: version, currentVersion: version };
  }

  async getStableVersion(adapterId: string): Promise<string | null> {
    const activeVersion = await this.versionManager.getActiveVersion(adapterId);
    return activeVersion?.version ?? null;
  }

  async getVersionHistory(adapterId: string) {
    return this.versionManager.load(adapterId);
  }
}
