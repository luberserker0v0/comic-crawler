import type { EventBus } from '../events/bus';
import { SessionManager } from './session-manager';
import { VersionManager } from './version-manager';
import { AgentNotifier } from './notifier';

export interface PromotionResult {
  success: boolean;
  version?: string;
  error?: string;
}

export class PromotionManager {
  private readonly sessionManager: SessionManager;
  private readonly versionManager: VersionManager;

  constructor(
    workspacePath: string,
    private readonly eventBus?: EventBus,
    private readonly notifier?: AgentNotifier
  ) {
    this.sessionManager = new SessionManager(workspacePath);
    this.versionManager = new VersionManager(workspacePath);
  }

  async promoteCandidate(adapterId: string, version?: string): Promise<PromotionResult> {
    const candidate = version
      ? await this.versionManager.getVersion(adapterId, version)
      : await this.versionManager.getLatestCandidateVersion(adapterId);

    if (!candidate || candidate.status !== 'candidate') {
      return {
        success: false,
        error: 'No candidate version available',
      };
    }

    const promoted = await this.versionManager.promoteVersion(adapterId, candidate.version);
    if (!promoted) {
      return {
        success: false,
        error: `Failed to promote version ${candidate.version}`,
      };
    }

    await this.sessionManager.complete(adapterId, candidate.version);
    this.eventBus?.emit('adapter:repair:promoted', {
      adapterId,
      version: candidate.version,
    });

    return {
      success: true,
      version: candidate.version,
    };
  }

  async rejectCandidate(adapterId: string, version?: string): Promise<PromotionResult> {
    const candidate = version
      ? await this.versionManager.getVersion(adapterId, version)
      : await this.versionManager.getLatestCandidateVersion(adapterId);

    if (!candidate || candidate.status !== 'candidate') {
      return {
        success: false,
        error: 'No candidate version available',
      };
    }

    const rejected = await this.versionManager.rejectVersion(adapterId, candidate.version);
    if (!rejected) {
      return {
        success: false,
        error: `Failed to reject version ${candidate.version}`,
      };
    }

    return {
      success: true,
      version: candidate.version,
    };
  }
}
