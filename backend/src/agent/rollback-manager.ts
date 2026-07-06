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
    if (!previousVersion) {
      return {
        success: false,
        error: 'No previous version available',
      };
    }

    const success = await this.versionManager.rollbackToVersion(
      adapterId,
      previousVersion.version
    );

    if (!success) {
      return {
        success: false,
        error: 'Failed to rollback',
      };
    }

    await this.sessionManager.rollback(adapterId);
    this.eventBus?.emit('adapter:repair:rolled-back', {
      adapterId,
      fromVersion: currentActive?.version,
      toVersion: previousVersion.version,
    });
    await this.notifier?.notifyRollback({
      adapterId,
      fromVersion: currentActive?.version,
      toVersion: previousVersion.version,
      reason: 'Manual rollback to previous version',
    });

    return {
      success: true,
      previousVersion: previousVersion.version,
      currentVersion: previousVersion.version,
    };
  }

  async rollbackToVersion(adapterId: string, version: string): Promise<RollbackResult> {
    const currentActive = await this.versionManager.getActiveVersion(adapterId);
    const success = await this.versionManager.rollbackToVersion(adapterId, version);

    if (!success) {
      return {
        success: false,
        error: `Version ${version} not found`,
      };
    }

    await this.sessionManager.rollback(adapterId);
    this.eventBus?.emit('adapter:repair:rolled-back', {
      adapterId,
      fromVersion: currentActive?.version,
      toVersion: version,
    });
    await this.notifier?.notifyRollback({
      adapterId,
      fromVersion: currentActive?.version,
      toVersion: version,
      reason: 'Manual rollback to target version',
    });

    return {
      success: true,
      previousVersion: version,
      currentVersion: version,
    };
  }

  async getStableVersion(adapterId: string): Promise<string | null> {
    const activeVersion = await this.versionManager.getActiveVersion(adapterId);
    return activeVersion?.version ?? null;
  }

  async getVersionHistory(adapterId: string) {
    return this.versionManager.load(adapterId);
  }
}
