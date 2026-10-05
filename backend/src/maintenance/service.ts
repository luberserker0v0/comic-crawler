import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { MaintenanceConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import type { TaskManager } from '../task/manager';
import type { TaskStatus } from '../task/types';
import type { SelectorDiscoveryService } from '../selector-discovery';
import type { ChallengeDiscoveryService } from '../challenge';
import { logger } from '../utils/logger';

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

const TERMINAL_TASK_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled', 'interrupted'];
const SELECTOR_JOB_PREFIX = 'selector-discovery-job-';
const SELECTOR_INDEX_KEY = 'selector-discovery-index';
const CHALLENGE_JOB_PREFIX = 'challenge-discovery-job-';
const CHALLENGE_INDEX_KEY = 'challenge-discovery-index';

interface DiscoveryCandidate {
  kind: 'selector' | 'challenge';
  id: string;
  updatedAt?: string;
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

    const tasks = await this.cleanupTasks(policy, batchLimit, dryRun);
    const discoveryJobs = await this.cleanupDiscoveryJobs(policy, batchLimit, dryRun, tasks.deleted);
    const browserProfiles = await this.cleanupBrowserProfiles(policy, dryRun, discoveryJobs.deleted);
    const fixtures = await this.cleanupFixtures(policy, dryRun);
    const agentSessions = await this.cleanupAgentSessions(policy, dryRun);

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

  private async cleanupTasks(
    policy: MaintenanceConfig,
    batchLimit: number,
    dryRun: boolean
  ): Promise<MaintenanceResult['tasks']> {
    const result: MaintenanceResult['tasks'] = { scanned: 0, deleted: [], skipped: [], errors: [], filesDeleted: [], filesSkipped: [] };
    const all = this.options.taskManager.getAllTasks();
    result.scanned = all.length;
    const cutoff = Date.now() - policy.tasksRetainDays * 24 * 60 * 60 * 1000;

    let processed = 0;
    for (const task of all) {
      if (processed >= batchLimit) {
        result.skipped.push(`${task.id}: batch limit reached`);
        continue;
      }
      if (!TERMINAL_TASK_STATUSES.includes(task.status)) {
        result.skipped.push(`${task.id}: status=${task.status}`);
        continue;
      }
      const completedAt = this.getTaskCompletedAt(task.id);
      if (completedAt === null) {
        result.skipped.push(`${task.id}: missing completedAt`);
        continue;
      }
      if (completedAt > cutoff) {
        result.skipped.push(`${task.id}: within retention`);
        continue;
      }
      processed += 1;
      if (dryRun) {
        result.deleted.push(task.id);
        const outputPath = this.options.taskManager.getTaskResult(task.id)?.outputPath;
        if (policy.deleteFiles && outputPath) result.filesDeleted.push(outputPath);
        continue;
      }
      try {
        const downloadDir = typeof this.options.downloadDir === 'function'
          ? await this.options.downloadDir()
          : this.options.downloadDir;
        const outcome = await this.options.taskManager.deleteTaskWithFiles(task.id, {
          deleteFiles: policy.deleteFiles,
          downloadDir,
        });
        if (outcome.deleted) {
          result.deleted.push(task.id);
          if (outcome.filesDeleted) {
            const outputPath = '(record outputPath)';
            result.filesDeleted.push(outputPath);
          }
          if (outcome.filesSkipped) result.filesSkipped.push(`${task.id}: ${outcome.filesSkipped}`);
        } else {
          result.skipped.push(`${task.id}: delete refused`);
        }
      } catch (error) {
        result.errors.push({ id: task.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  }

  private getTaskCompletedAt(taskId: string): number | null {
    const task = this.options.taskManager.getTask(taskId);
    const result = this.options.taskManager.getTaskResult(taskId);
    const candidates = [task?.completedAt, result?.completedAt];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const time = candidate instanceof Date ? candidate.getTime() : new Date(candidate).getTime();
      if (Number.isFinite(time)) return time;
    }
    return null;
  }

  private async cleanupDiscoveryJobs(
    policy: MaintenanceConfig,
    batchLimit: number,
    dryRun: boolean,
    recentlyDeletedTaskIds: string[]
  ): Promise<MaintenanceScopeResult> {
    const result: MaintenanceScopeResult = { scanned: 0, deleted: [], skipped: [], errors: [] };
    const cutoff = Date.now() - policy.discoveryJobsRetainDays * 24 * 60 * 60 * 1000;
    const referenced = new Set<string>();
    for (const task of this.options.taskManager.getAllTasks()) {
      if (recentlyDeletedTaskIds.includes(task.id)) continue;
      const challengeId = this.options.taskManager.getTaskResult(task.id)?.challengeDiscoveryId;
      if (challengeId) referenced.add(challengeId);
    }

    const candidates = await this.collectDiscoveryCandidates(dryRun);
    result.scanned = candidates.length;
    let processed = 0;
    for (const candidate of candidates) {
      if (processed >= batchLimit) {
        result.skipped.push(`${candidate.id}: batch limit reached`);
        continue;
      }
      if (referenced.has(candidate.id)) {
        result.skipped.push(`${candidate.id}: referenced by active task`);
        continue;
      }
      const updatedAt = await this.resolveCandidateTime(candidate);
      if (!Number.isFinite(updatedAt)) {
        result.skipped.push(`${candidate.id}: unknown age, kept for manual review`);
        continue;
      }
      if (updatedAt > cutoff) {
        result.skipped.push(`${candidate.id}: within retention`);
        continue;
      }
      processed += 1;
      if (dryRun) {
        result.deleted.push(candidate.id);
        continue;
      }
      try {
        const deleted = await this.deleteDiscoveryCandidate(candidate);
        if (deleted) result.deleted.push(candidate.id);
        else result.skipped.push(`${candidate.id}: delete refused`);
      } catch (error) {
        result.errors.push({ id: candidate.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  }

  private async resolveCandidateTime(candidate: DiscoveryCandidate): Promise<number> {
    if (candidate.updatedAt) {
      const parsed = new Date(candidate.updatedAt).getTime();
      if (Number.isFinite(parsed)) return parsed;
    }
    // Fall back to file mtime so corrupt/unparseable job files don't linger forever.
    try {
      const stat = await this.options.storage.stat?.(
        `${candidate.kind === 'selector' ? SELECTOR_JOB_PREFIX : CHALLENGE_JOB_PREFIX}${candidate.id}`
      );
      if (stat && Number.isFinite(stat.mtimeMs)) return stat.mtimeMs;
    } catch {
      // fall through to NaN
    }
    return NaN;
  }

  private async collectDiscoveryCandidates(dryRun: boolean): Promise<DiscoveryCandidate[]> {
    const out: DiscoveryCandidate[] = [];
    const seen = new Set<string>();
    if (this.options.selectorDiscoveryService) {
      try {
        for (const job of await this.options.selectorDiscoveryService.list()) {
          seen.add(`selector:${job.id}`);
          out.push({ kind: 'selector', id: job.id, updatedAt: job.updatedAt });
        }
      } catch {
        // Index unreadable; fall back to storage listing below.
      }
      await this.pruneStaleIndexEntries(SELECTOR_INDEX_KEY, seen, 'selector:', dryRun);
    }
    if (this.options.challengeDiscoveryService) {
      try {
        for (const job of await this.options.challengeDiscoveryService.list()) {
          seen.add(`challenge:${job.id}`);
          out.push({ kind: 'challenge', id: job.id, updatedAt: job.updatedAt });
        }
      } catch {
        // Fall through to storage listing.
      }
      await this.pruneStaleIndexEntries(CHALLENGE_INDEX_KEY, seen, 'challenge:', dryRun);
    }
    // Orphan files: keys on disk that fell out of the capped index (slice(0,200)).
    try {
      const keys = await this.options.storage.list();
      for (const key of keys) {
        if (key.startsWith(SELECTOR_JOB_PREFIX)) {
          const id = key.slice(SELECTOR_JOB_PREFIX.length);
          if (!seen.has(`selector:${id}`)) {
            const job = await this.options.selectorDiscoveryService?.get(id).catch(() => null);
            out.push({ kind: 'selector', id, updatedAt: job?.updatedAt });
          }
        } else if (key.startsWith(CHALLENGE_JOB_PREFIX)) {
          const id = key.slice(CHALLENGE_JOB_PREFIX.length);
          if (!seen.has(`challenge:${id}`)) {
            const job = await this.options.challengeDiscoveryService?.get(id).catch(() => null);
            out.push({ kind: 'challenge', id, updatedAt: job?.updatedAt });
          }
        }
      }
      // Repair truncated indexes opportunistically (best effort).
      await this.repairIndex(SELECTOR_INDEX_KEY, SELECTOR_JOB_PREFIX);
      await this.repairIndex(CHALLENGE_INDEX_KEY, CHALLENGE_JOB_PREFIX);
    } catch {
      // storage.list failure should not fail the whole cleanup.
    }
    return out;
  }

  private async repairIndex(indexKey: string, prefix: string): Promise<void> {
    try {
      const keys = await this.options.storage.list();
      const ids = keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
      if (ids.length === 0) return;
      const existing = (await this.options.storage.read<string[]>(indexKey)) ?? [];
      const merged = Array.from(new Set([...existing, ...ids]));
      if (merged.length !== existing.length) {
        await this.options.storage.write(indexKey, merged.slice(0, 200));
      }
    } catch {
      // best effort only
    }
  }

  private async pruneStaleIndexEntries(
    indexKey: string,
    seen: Set<string>,
    prefix: string,
    dryRun: boolean
  ): Promise<void> {
    // Index entries whose job file no longer exists occupy index slots and
    // hide in list() results; prune them so the index reflects reality.
    try {
      const ids = (await this.options.storage.read<string[]>(indexKey)) ?? [];
      const stale = ids.filter((id) => !seen.has(`${prefix}${id}`));
      if (stale.length === 0) return;
      if (dryRun) return;
      const verified = new Set<string>();
      const jobPrefix = prefix === 'selector:' ? SELECTOR_JOB_PREFIX : CHALLENGE_JOB_PREFIX;
      for (const id of stale) {
        if (await this.options.storage.exists(`${jobPrefix}${id}`)) verified.add(id);
      }
      const removable = stale.filter((id) => !verified.has(id));
      if (removable.length === 0) return;
      await this.options.storage.write(indexKey, ids.filter((id) => !removable.includes(id)));
    } catch {
      // best effort only
    }
  }

  private async deleteDiscoveryCandidate(candidate: DiscoveryCandidate): Promise<boolean> {
    if (candidate.kind === 'selector' && this.options.selectorDiscoveryService) {
      const ok = await this.options.selectorDiscoveryService.deleteJob(candidate.id);
      if (ok) return true;
    }
    if (candidate.kind === 'challenge' && this.options.challengeDiscoveryService) {
      const ok = await this.options.challengeDiscoveryService.deleteJob(candidate.id);
      if (ok) return true;
    }
    // Fallback: direct storage delete for orphan keys with no service.
    const prefix = candidate.kind === 'selector' ? SELECTOR_JOB_PREFIX : CHALLENGE_JOB_PREFIX;
    const indexKey = candidate.kind === 'selector' ? SELECTOR_INDEX_KEY : CHALLENGE_INDEX_KEY;
    await this.options.storage.delete(`${prefix}${candidate.id}`);
    if (candidate.kind === 'selector') {
      await this.options.storage.delete(`selector-discovery-implementation-${candidate.id}`);
      await this.options.storage.delete(`selector-discovery-manifest-${candidate.id}`);
      await this.options.storage.delete(`selector-discovery-shadow-promotion-${candidate.id}`);
    }
    try {
      const ids = (await this.options.storage.read<string[]>(indexKey)) ?? [];
      if (ids.includes(candidate.id)) {
        await this.options.storage.write(indexKey, ids.filter((id) => id !== candidate.id));
      }
    } catch {
      // index pruning is best effort; the next run retries it
    }
    return true;
  }

  private async cleanupBrowserProfiles(
    policy: MaintenanceConfig,
    dryRun: boolean,
    deletedJobIds: string[]
  ): Promise<MaintenanceResult['browserProfiles']> {
    const result: MaintenanceResult['browserProfiles'] = { scanned: 0, deleted: [], skipped: [], errors: [], bytesFreed: 0 };
    const workspaceRoot = this.options.workspaceRoot;
    if (!workspaceRoot) {
      result.skipped.push('workspaceRoot not configured');
      return result;
    }
    const discoveriesRoot = join(workspaceRoot, 'challenge-discoveries');
    let entries: string[];
    try {
      entries = await fs.readdir(discoveriesRoot);
    } catch {
      return result;
    }
    result.scanned = entries.length;
    const cutoff = Date.now() - policy.browserProfilesRetainDays * 24 * 60 * 60 * 1000;
    const liveJobIds = new Set<string>();
    if (this.options.challengeDiscoveryService) {
      try {
        for (const job of await this.options.challengeDiscoveryService.list()) liveJobIds.add(job.id);
      } catch {
        // treat as unknown; rely on mtime + deletedJobIds
      }
    }

    for (const entry of entries) {
      const dir = join(discoveriesRoot, entry);
      let stat;
      try {
        stat = await fs.stat(dir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      const jobDeleted = deletedJobIds.includes(entry);
      const jobAlive = liveJobIds.has(entry);
      const expired = stat.mtimeMs < cutoff;
      const orphanNoRecord = !jobAlive && policy.deleteOrphanProfiles && expired;
      if (!jobDeleted && !orphanNoRecord) {
        result.skipped.push(`${entry}: ${jobAlive ? 'job alive' : 'within retention'}`);
        continue;
      }
      let size = 0;
      try {
        size = await dirSize(dir);
      } catch {
        size = 0;
      }
      if (dryRun) {
        result.deleted.push(entry);
        result.bytesFreed += size;
        continue;
      }
      try {
        assertInside(dir, discoveriesRoot);
        await fs.rm(dir, { recursive: true, force: true });
        result.deleted.push(entry);
        result.bytesFreed += size;
      } catch (error) {
        result.errors.push({ id: entry, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  }

  /**
   * Verified DOM fixtures captured per challenge-discovery flow
   * (`agent-workspaces/fixtures/<domain>/<id>/`). Each capture writes a full
   * page.html plus metadata, so they accumulate exactly like browser profiles.
   * Re-capturable at any time via the fixtures API, hence retention-based.
   */
  private async cleanupFixtures(
    policy: MaintenanceConfig,
    dryRun: boolean
  ): Promise<MaintenanceResult['fixtures']> {
    const result: MaintenanceResult['fixtures'] = { scanned: 0, deleted: [], skipped: [], errors: [], bytesFreed: 0 };
    const workspaceRoot = this.options.workspaceRoot;
    if (!workspaceRoot) {
      result.skipped.push('workspaceRoot not configured');
      return result;
    }
    const fixturesRoot = join(workspaceRoot, 'fixtures');
    const cutoff = Date.now() - policy.discoveryJobsRetainDays * 24 * 60 * 60 * 1000;
    let domains: string[];
    try {
      domains = await fs.readdir(fixturesRoot);
    } catch {
      return result;
    }
    for (const domain of domains) {
      const domainDir = join(fixturesRoot, domain);
      let ids: string[];
      try {
        const stat = await fs.stat(domainDir);
        if (!stat.isDirectory()) continue;
        ids = await fs.readdir(domainDir);
      } catch {
        continue;
      }
      for (const id of ids) {
        const dir = join(domainDir, id);
        let stat;
        try {
          stat = await fs.stat(dir);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }
        result.scanned += 1;
        if (stat.mtimeMs >= cutoff) {
          result.skipped.push(`${domain}/${id}: within retention`);
          continue;
        }
        let size = 0;
        try {
          size = await dirSize(dir);
        } catch {
          size = 0;
        }
        if (dryRun) {
          result.deleted.push(`${domain}/${id}`);
          result.bytesFreed += size;
          continue;
        }
        try {
          assertInside(dir, fixturesRoot);
          await fs.rm(dir, { recursive: true, force: true });
          result.deleted.push(`${domain}/${id}`);
          result.bytesFreed += size;
        } catch (error) {
          result.errors.push({ id: `${domain}/${id}`, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    return result;
  }

  /**
   * Scratch repair sessions from the agent auto-repair loop
   * (agent-workspaces/<adapterId>/session-<timestamp>/). Only directories
   * matching the session-<timestamp> pattern are touched; live adapter state
   * (session.json, versions dir, selectors.ts, promoted versions) is never matched.
   */
  private async cleanupAgentSessions(
    policy: MaintenanceConfig,
    dryRun: boolean
  ): Promise<MaintenanceScopeResult> {
    const result: MaintenanceScopeResult = { scanned: 0, deleted: [], skipped: [], errors: [] };
    const workspaceRoot = this.options.workspaceRoot;
    if (!workspaceRoot) {
      result.skipped.push('workspaceRoot not configured');
      return result;
    }
    const cutoff = Date.now() - policy.tasksRetainDays * 24 * 60 * 60 * 1000;
    const ignoredTopLevel = new Set(['challenge-discoveries', 'fixtures', 'bundle-evaluations']);
    let topEntries: string[];
    try {
      topEntries = await fs.readdir(workspaceRoot);
    } catch {
      return result;
    }
    for (const top of topEntries) {
      if (ignoredTopLevel.has(top)) continue;
      const adapterDir = join(workspaceRoot, top);
      let children: string[];
      try {
        const stat = await fs.stat(adapterDir);
        if (!stat.isDirectory()) continue;
        children = await fs.readdir(adapterDir);
      } catch {
        continue;
      }
      for (const child of children) {
        if (!child.startsWith('session-')) continue;
        const dir = join(adapterDir, child);
        let stat;
        try {
          stat = await fs.stat(dir);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }
        result.scanned += 1;
        if (stat.mtimeMs >= cutoff) {
          result.skipped.push(`${top}/${child}: within retention`);
          continue;
        }
        if (dryRun) {
          result.deleted.push(`${top}/${child}`);
          continue;
        }
        try {
          assertInside(dir, workspaceRoot);
          await fs.rm(dir, { recursive: true, force: true });
          result.deleted.push(`${top}/${child}`);
        } catch (error) {
          result.errors.push({ id: `${top}/${child}`, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    return result;
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else {
      try {
        const stat = await fs.stat(full);
        total += stat.size;
      } catch {
        // ignore disappearing files
      }
    }
  }
  return total;
}

function assertInside(candidate: string, root: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = isAbsolute(candidate) ? resolve(candidate) : resolve(process.cwd(), candidate);
  if (resolvedCandidate === resolvedRoot) throw new Error('Refusing to delete workspace root');
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to delete path outside workspace: ${candidate}`);
  }
}
