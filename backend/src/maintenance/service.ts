import type { MaintenanceConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import type { TaskManager } from '../task/manager';
import type { SelectorDiscoveryService } from '../selector-discovery';
import type { ChallengeDiscoveryService } from '../challenge';
import { logger } from '../utils/logger';
import { cleanupTasks } from './task-cleanup';
import { cleanupDiscoveryJobs } from './discovery-cleanup';
import { cleanupAgentSessions, cleanupBrowserProfiles, cleanupFixtures } from './workspace-cleanup';

export interface MaintenancePolicyOverrides {
  tasksRetainDays?: number;
  discoveryJobsRetainDays?: number;
  browserProfilesRetainDays?: number;
  deleteFiles?: boolean;
  deleteOrphanProfiles?: boolean;
  batchLimit?: number;
  includeTasks?: boolean;
  includeDiscoveryJobs?: boolean;
  includeBrowserProfiles?: boolean;
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
  browserProfiles: MaintenanceScopeResult & { bytesFreed: number };
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

    const tasks = await cleanupTasks(
      { taskManager: this.options.taskManager, downloadDir: this.options.downloadDir },
      policy,
      batchLimit,
      dryRun
    );
    const discoveryJobs = await cleanupDiscoveryJobs(
      {
        storage: this.options.storage,
        taskManager: this.options.taskManager,
        selectorDiscoveryService: this.options.selectorDiscoveryService,
        challengeDiscoveryService: this.options.challengeDiscoveryService,
      },
      policy,
      batchLimit,
      dryRun,
      tasks.deleted
    );
    const browserProfiles = await cleanupBrowserProfiles(
      { workspaceRoot: this.options.workspaceRoot, challengeDiscoveryService: this.options.challengeDiscoveryService },
      policy,
      dryRun,
      discoveryJobs.deleted
    );
    const fixtures = await cleanupFixtures({ workspaceRoot: this.options.workspaceRoot }, policy, dryRun);
    const agentSessions = await cleanupAgentSessions({ workspaceRoot: this.options.workspaceRoot }, policy, dryRun);

    const finishedAt = new Date();
    const result: MaintenanceResult = {
      dryRun,
      tasks,
      discoveryJobs,
      browserProfiles,
      fixtures,
      agentSessions,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
    if (!dryRun) {
      this.lastResult = result;
    }
    logger.info(
      {
        dryRun,
        tasksDeleted: tasks.deleted.length,
        jobsDeleted: discoveryJobs.deleted.length,
        profilesDeleted: browserProfiles.deleted.length,
        fixturesDeleted: fixtures.deleted.length,
        agentSessionsDeleted: agentSessions.deleted.length,
        bytesFreed: browserProfiles.bytesFreed + fixtures.bytesFreed,
      },
      dryRun ? 'Maintenance preview completed' : 'Maintenance cleanup completed'
    );
    return result;
  }

  private async resolvePolicy(overrides?: MaintenancePolicyOverrides): Promise<MaintenanceConfig> {
    const base = this.options.getPolicy
      ? await this.options.getPolicy()
      : {
        enabled: true,
        intervalHours: 24,
        tasksRetainDays: 30,
        discoveryJobsRetainDays: 14,
        browserProfilesRetainDays: 14,
        deleteFiles: true,
        deleteOrphanProfiles: true,
        batchLimit: 100,
      };
    return {
      ...base,
      ...(overrides?.tasksRetainDays !== undefined ? { tasksRetainDays: overrides.tasksRetainDays } : {}),
      ...(overrides?.discoveryJobsRetainDays !== undefined ? { discoveryJobsRetainDays: overrides.discoveryJobsRetainDays } : {}),
      ...(overrides?.browserProfilesRetainDays !== undefined ? { browserProfilesRetainDays: overrides.browserProfilesRetainDays } : {}),
      ...(overrides?.deleteFiles !== undefined ? { deleteFiles: overrides.deleteFiles } : {}),
      ...(overrides?.deleteOrphanProfiles !== undefined ? { deleteOrphanProfiles: overrides.deleteOrphanProfiles } : {}),
      ...(overrides?.batchLimit !== undefined ? { batchLimit: overrides.batchLimit } : {}),
    };
  }
}
