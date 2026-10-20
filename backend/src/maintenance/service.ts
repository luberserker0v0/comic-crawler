import type { MaintenanceConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import type { TaskManager } from '../task/manager';
import type { SelectorDiscoveryService } from '../selector-discovery';
import type { ChallengeDiscoveryService } from '../challenge';
import { logger } from '../utils/logger';
import { cleanupTasks } from './task-cleanup';
import { cleanupDiscoveryJobs } from './discovery-cleanup';
import { cleanupAgentSessions, cleanupFixtures } from './workspace-cleanup';

export interface MaintenancePolicyOverrides {
  tasksRetainDays?: number;
  discoveryJobsRetainDays?: number;
  deleteFiles?: boolean;
  batchLimit?: number;
  includeTasks?: boolean;
  includeDiscoveryJobs?: boolean;
}

export interface MaintenanceScopeResult {
  scanned: number;
  deleted: string[];
  skipped: string[];
  errors: Array<{ id: string; error: string }>;
}

export interface MaintenanceResult {
  dryRun: boolean;
  tasks: MaintenanceScopeResult & { filesDeleted: string[]; filesSkipped: string[] };
  discoveryJobs: MaintenanceScopeResult;
  fixtures: MaintenanceScopeResult & { bytesFreed: number };
  agentSessions: MaintenanceScopeResult;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface MaintenanceServiceOptions {
  storage: IStorage;
  taskManager: TaskManager;
  selectorDiscoveryService?: SelectorDiscoveryService;
  challengeDiscoveryService?: ChallengeDiscoveryService;
  workspaceRoot?: string;
  downloadDir?: string | (() => string | Promise<string>);
  getPolicy?: () => MaintenanceConfig | Promise<MaintenanceConfig>;
}

export class MaintenanceService {
  private lastResult: MaintenanceResult | null = null;

  constructor(private readonly options: MaintenanceServiceOptions) {}

  getLastResult(): MaintenanceResult | null {
    return this.lastResult;
  }

  async preview(overrides?: MaintenancePolicyOverrides): Promise<MaintenanceResult> {
    return this.run(overrides, { dryRun: true });
  }

  async run(overrides?: MaintenancePolicyOverrides, opts?: { dryRun?: boolean }): Promise<MaintenanceResult> {
    const dryRun = opts?.dryRun ?? false;
    const startedAt = new Date();
    const policy = await this.resolvePolicy(overrides);
    const batchLimit = Math.max(1, policy.batchLimit);
    const scopes = await this.cleanupScopes(policy, batchLimit, dryRun);
    const finishedAt = new Date();
    const result = createMaintenanceResult(dryRun, startedAt, finishedAt, scopes);
    if (!dryRun) this.lastResult = result;
    logMaintenanceResult(result);
    return result;
  }

  private async cleanupScopes(policy: MaintenanceConfig, batchLimit: number, dryRun: boolean) {
    const tasks = await cleanupTasks(
      { taskManager: this.options.taskManager, downloadDir: this.options.downloadDir }, policy, batchLimit, dryRun
    );
    const discoveryJobs = await cleanupDiscoveryJobs({
      storage: this.options.storage, taskManager: this.options.taskManager,
      selectorDiscoveryService: this.options.selectorDiscoveryService,
      challengeDiscoveryService: this.options.challengeDiscoveryService,
    }, policy, batchLimit, dryRun, tasks.deleted);
    const fixtures = await cleanupFixtures({ workspaceRoot: this.options.workspaceRoot }, policy, dryRun);
    const agentSessions = await cleanupAgentSessions({ workspaceRoot: this.options.workspaceRoot }, policy, dryRun);
    return { tasks, discoveryJobs, fixtures, agentSessions };
  }

  private async resolvePolicy(overrides?: MaintenancePolicyOverrides): Promise<MaintenanceConfig> {
    const base = this.options.getPolicy
      ? await this.options.getPolicy()
      : {
        enabled: true,
        intervalHours: 24,
        tasksRetainDays: 30,
        discoveryJobsRetainDays: 14,
        deleteFiles: true,
        batchLimit: 100,
      };
    return {
      ...base,
      ...(overrides?.tasksRetainDays !== undefined ? { tasksRetainDays: overrides.tasksRetainDays } : {}),
      ...(overrides?.discoveryJobsRetainDays !== undefined ? { discoveryJobsRetainDays: overrides.discoveryJobsRetainDays } : {}),
      ...(overrides?.deleteFiles !== undefined ? { deleteFiles: overrides.deleteFiles } : {}),
      ...(overrides?.batchLimit !== undefined ? { batchLimit: overrides.batchLimit } : {}),
    };
  }
}

function createMaintenanceResult(dryRun: boolean, startedAt: Date, finishedAt: Date,
  scopes: Pick<MaintenanceResult, 'tasks' | 'discoveryJobs' | 'fixtures' | 'agentSessions'>): MaintenanceResult {
  return {
    dryRun, ...scopes, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

function logMaintenanceResult(result: MaintenanceResult): void {
  logger.info({
    dryRun: result.dryRun, tasksDeleted: result.tasks.deleted.length,
    jobsDeleted: result.discoveryJobs.deleted.length, fixturesDeleted: result.fixtures.deleted.length,
    agentSessionsDeleted: result.agentSessions.deleted.length, bytesFreed: result.fixtures.bytesFreed,
  }, result.dryRun ? 'Maintenance preview completed' : 'Maintenance cleanup completed');
}
