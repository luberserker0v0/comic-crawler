import type { IStorage } from '../storage/types';
import type { EventBus } from '../events/bus';
import { promises as fs } from 'node:fs';
import { SessionManager } from './session-manager';
import { VersionManager } from './version-manager';
import { WorkspaceFactory } from './workspace-factory';
import { CodeValidator } from './code-validator';
import { AgentNotifier } from './notifier';
import type { AgentSession, ExtractionFailureContext } from './types';
import type { SiteManifest } from '../adapter/sites/types';

export interface AgentMaintenanceConfig {
  workspacePath: string;
  maxAttempts?: number;
  storage: IStorage;
  eventBus?: EventBus;
  notifier?: AgentNotifier;
}

export interface MaintenanceResult {
  success: boolean;
  version?: string;
  attempts: number;
  error?: string;
}

export class AgentMaintenanceLoop {
  private sessionManager: SessionManager;
  private versionManager: VersionManager;
  private workspaceFactory: WorkspaceFactory;
  private codeValidator: CodeValidator;
  private config: AgentMaintenanceConfig;

  constructor(config: AgentMaintenanceConfig) {
    this.config = config;
    this.sessionManager = new SessionManager(config.workspacePath);
    this.versionManager = new VersionManager(config.workspacePath);
    this.codeValidator = new CodeValidator();
    this.workspaceFactory = new WorkspaceFactory(config.workspacePath);
  }

  async startMaintenance(
    manifest: SiteManifest,
    errorContext: ExtractionFailureContext
  ): Promise<MaintenanceResult> {
    const maxAttempts = this.config.maxAttempts ?? 5;
    const adapterId = manifest.id;
    const sessionId = `session-${Date.now()}`;
    const triggerKey = `${adapterId}:${errorContext.pageType}:${errorContext.selectorName ?? 'unknown'}`;

    await this.sessionManager.create(adapterId, maxAttempts, {
      sessionId,
      pageType: errorContext.pageType,
      repairMode: manifest.maintenance.repairMode,
      triggerKey,
    });
    this.config.eventBus?.emit('adapter:repair:started', { adapterId, sessionId });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.sessionManager.updateAttempt(adapterId, attempt);
      this.config.eventBus?.emit('adapter:repair:attempted', { adapterId, sessionId, attempt });

      try {
        const workspace = await this.workspaceFactory.createSessionWorkspace({
          adapterId,
          sessionId,
          manifest,
          errorContext,
        });

        const selectorsContent = await fs.readFile(workspace.sourceFiles.selectorsPath, 'utf-8');
        const parserContent = await this.readOptional(workspace.sourceFiles.parserPath);

        if (!selectorsContent) {
          await this.sessionManager.updateAttempt(adapterId, attempt, 'Missing source files');
          continue;
        }

        const validation =
          manifest.maintenance.repairMode === 'selector-only'
            ? await this.validateSelectorOnly(manifest, selectorsContent)
            : await this.codeValidator.validateBoth(selectorsContent, parserContent ?? '');

        this.config.eventBus?.emit('adapter:repair:validated', {
          adapterId,
          sessionId,
          valid: validation.valid,
        });

        if (!validation.valid) {
          await this.sessionManager.updateAttempt(
            adapterId,
            attempt,
            `Validation failed: ${validation.errors.join(', ')}`
          );
          continue;
        }

        const version = await this.versionManager.createCandidateVersion({
          adapterId,
          selectorsContent,
          parserContent,
          testResults: {
            passed: validation.fixtureResults?.filter((fixture) => fixture.valid).length ?? 0,
            failed: validation.fixtureResults?.filter((fixture) => !fixture.valid).length ?? 0,
          },
          repairMode: manifest.maintenance.repairMode,
          sourceSessionId: sessionId,
          basedOnVersion: workspace.sourceVersion,
          validation: {
            syntaxValid: validation.syntaxValid,
            fixtureResults: validation.fixtureResults,
          },
        });

        await this.sessionManager.awaitReview(adapterId, version);
        const session = await this.sessionManager.load(adapterId);
        const candidateVersion = await this.versionManager.getVersion(adapterId, version);

        if (session && candidateVersion) {
          await this.config.notifier?.notifyCandidateReady({
            session,
            version: candidateVersion,
            errorContext,
          });
        }
        this.config.eventBus?.emit('adapter:repair:candidate-created', {
          adapterId,
          sessionId,
          version,
        });
        this.config.eventBus?.emit('adapter:repair:promotion-requested', {
          adapterId,
          sessionId,
          version,
        });

        return {
          success: true,
          version,
          attempts: attempt,
        };
      } catch (error: any) {
        await this.sessionManager.updateAttempt(adapterId, attempt, error.message);
      }
    }

    await this.sessionManager.fail(adapterId);
    this.config.eventBus?.emit('adapter:repair:failed', {
      adapterId,
      sessionId,
      error: 'Max attempts reached',
    });

    return {
      success: false,
      attempts: maxAttempts,
      error: 'Max attempts reached',
    };
  }

  async rollback(adapterId: string): Promise<boolean> {
    const previousVersion = await this.versionManager.getPreviousVersion(adapterId);
    if (!previousVersion) return false;

    await this.sessionManager.rollback(adapterId);
    return this.versionManager.rollbackToVersion(adapterId, previousVersion.version);
  }

  async getStatus(adapterId: string): Promise<AgentSession | null> {
    return this.sessionManager.load(adapterId);
  }

  async getVersions(adapterId: string) {
    return this.versionManager.load(adapterId);
  }

  private async validateSelectorOnly(manifest: SiteManifest, selectorsContent: string) {
    const selectorValidation = await this.codeValidator.validateSelectors(selectorsContent);
    if (!selectorValidation.valid) {
      return selectorValidation;
    }

    return this.codeValidator.validateSelectorFixtures({
      manifest,
      selectorsContent,
    });
  }

  private async readOptional(path?: string): Promise<string | undefined> {
    if (!path) return undefined;

    try {
      return await fs.readFile(path, 'utf-8');
    } catch {
      return undefined;
    }
  }
}
