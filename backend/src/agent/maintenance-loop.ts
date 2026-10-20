import type { IStorage } from '../storage/types';
import type { EventBus } from '../events/bus';
import { promises as fs } from 'node:fs';
import { SessionManager } from './session-manager';
import { VersionManager } from './version-manager';
import { WorkspaceFactory, type SessionWorkspace } from './workspace-factory';
import { CodeValidator, type ValidationResult } from './code-validator';
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

interface MaintenanceContext {
  manifest: SiteManifest;
  errorContext: ExtractionFailureContext;
  adapterId: string;
  sessionId: string;
  maxAttempts: number;
}

interface AttemptSource {
  workspace: SessionWorkspace;
  selectorsContent: string;
  parserContent?: string;
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
    const context = this.createContext(manifest, errorContext);
    await this.initializeSession(context);
    for (let attempt = 1; attempt <= context.maxAttempts; attempt++) {
      const version = await this.tryAttempt(context, attempt);
      if (version) return { success: true, version, attempts: attempt };
    }
    return this.failMaintenance(context);
  }

  private createContext(manifest: SiteManifest, errorContext: ExtractionFailureContext): MaintenanceContext {
    return { manifest, errorContext, adapterId: manifest.id, sessionId: `session-${Date.now()}`,
      maxAttempts: this.config.maxAttempts ?? 5 };
  }

  private async initializeSession(context: MaintenanceContext): Promise<void> {
    const { adapterId, sessionId, maxAttempts, manifest, errorContext } = context;
    const triggerKey = `${adapterId}:${errorContext.pageType}:${errorContext.selectorName ?? 'unknown'}`;
    await this.sessionManager.create(adapterId, maxAttempts, { sessionId, triggerKey,
      pageType: errorContext.pageType, repairMode: manifest.maintenance.repairMode });
    this.config.eventBus?.emit('adapter:repair:started', { adapterId, sessionId });
  }

  private async tryAttempt(context: MaintenanceContext, attempt: number): Promise<string | undefined> {
    try {
      return await this.runAttempt(context, attempt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sessionManager.updateAttempt(context.adapterId, attempt, message);
      return undefined;
    }
  }

  private async runAttempt(context: MaintenanceContext, attempt: number): Promise<string | undefined> {
    await this.beginAttempt(context, attempt);
    const source = await this.loadAttemptSource(context);
    if (!source.selectorsContent) return this.rejectAttempt(context, attempt, 'Missing source files');
    const validation = await this.validateSource(context.manifest, source);
    this.emitValidation(context, validation.valid);
    if (!validation.valid) return this.rejectAttempt(context, attempt,
      `Validation failed: ${validation.errors.join(', ')}`);
    const version = await this.createCandidate(context, source, validation);
    await this.completeCandidate(context, version);
    return version;
  }

  private async beginAttempt(context: MaintenanceContext, attempt: number): Promise<void> {
    await this.sessionManager.updateAttempt(context.adapterId, attempt);
    this.config.eventBus?.emit('adapter:repair:attempted', {
      adapterId: context.adapterId, sessionId: context.sessionId, attempt,
    });
  }

  private async loadAttemptSource(context: MaintenanceContext): Promise<AttemptSource> {
    const workspace = await this.workspaceFactory.createSessionWorkspace(context);
    const selectorsContent = await fs.readFile(workspace.sourceFiles.selectorsPath, 'utf-8');
    const parserContent = await this.readOptional(workspace.sourceFiles.parserPath);
    return { workspace, selectorsContent, parserContent };
  }

  private validateSource(manifest: SiteManifest, source: AttemptSource): Promise<ValidationResult> {
    return manifest.maintenance.repairMode === 'selector-only'
      ? this.validateSelectorOnly(manifest, source.selectorsContent)
      : this.codeValidator.validateBoth(source.selectorsContent, source.parserContent ?? '');
  }

  private emitValidation(context: MaintenanceContext, valid: boolean): void {
    this.config.eventBus?.emit('adapter:repair:validated', {
      adapterId: context.adapterId, sessionId: context.sessionId, valid,
    });
  }

  private async rejectAttempt(context: MaintenanceContext, attempt: number,
    message: string): Promise<undefined> {
    await this.sessionManager.updateAttempt(context.adapterId, attempt, message);
    return undefined;
  }

  private createCandidate(context: MaintenanceContext, source: AttemptSource,
    validation: ValidationResult): Promise<string> {
    const fixtures = validation.fixtureResults ?? [];
    return this.versionManager.createCandidateVersion({
      adapterId: context.adapterId, selectorsContent: source.selectorsContent,
      parserContent: source.parserContent, repairMode: context.manifest.maintenance.repairMode,
      sourceSessionId: context.sessionId, basedOnVersion: source.workspace.sourceVersion,
      testResults: { passed: fixtures.filter((fixture) => fixture.valid).length,
        failed: fixtures.filter((fixture) => !fixture.valid).length },
      validation: { syntaxValid: validation.syntaxValid, fixtureResults: validation.fixtureResults },
    });
  }

  private async completeCandidate(context: MaintenanceContext, version: string): Promise<void> {
    await this.sessionManager.awaitReview(context.adapterId, version);
    const session = await this.sessionManager.load(context.adapterId);
    const candidateVersion = await this.versionManager.getVersion(context.adapterId, version);
    if (session && candidateVersion) await this.config.notifier?.notifyCandidateReady({
      session, version: candidateVersion, errorContext: context.errorContext,
    });
    this.emitCandidateEvents(context, version);
  }

  private emitCandidateEvents(context: MaintenanceContext, version: string): void {
    const payload = { adapterId: context.adapterId, sessionId: context.sessionId, version };
    this.config.eventBus?.emit('adapter:repair:candidate-created', payload);
    this.config.eventBus?.emit('adapter:repair:promotion-requested', payload);
  }

  private async failMaintenance(context: MaintenanceContext): Promise<MaintenanceResult> {
    await this.sessionManager.fail(context.adapterId);
    this.config.eventBus?.emit('adapter:repair:failed', {
      adapterId: context.adapterId, sessionId: context.sessionId, error: 'Max attempts reached',
    });
    return { success: false, attempts: context.maxAttempts, error: 'Max attempts reached' };
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
