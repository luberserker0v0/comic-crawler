import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { MaintenanceConfig } from '@comiccrawler/shared';
import type { ChallengeDiscoveryService } from '../challenge';
import type { MaintenanceResult, MaintenanceScopeResult } from './service';
import { assertInside, dirSize } from './fs-utils';

export interface WorkspaceCleanupDeps {
  workspaceRoot?: string;
  challengeDiscoveryService?: ChallengeDiscoveryService;
}

export async function cleanupBrowserProfiles(
  deps: WorkspaceCleanupDeps,
  policy: MaintenanceConfig,
  dryRun: boolean,
  deletedJobIds: string[]
): Promise<MaintenanceResult['browserProfiles']> {
  const result: MaintenanceResult['browserProfiles'] = { scanned: 0, deleted: [], skipped: [], errors: [], bytesFreed: 0 };
  const workspaceRoot = deps.workspaceRoot;
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
  if (deps.challengeDiscoveryService) {
    try {
      for (const job of await deps.challengeDiscoveryService.list()) liveJobIds.add(job.id);
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
export async function cleanupFixtures(
  deps: WorkspaceCleanupDeps,
  policy: MaintenanceConfig,
  dryRun: boolean
): Promise<MaintenanceResult['fixtures']> {
  const result: MaintenanceResult['fixtures'] = { scanned: 0, deleted: [], skipped: [], errors: [], bytesFreed: 0 };
  const workspaceRoot = deps.workspaceRoot;
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
export async function cleanupAgentSessions(
  deps: WorkspaceCleanupDeps,
  policy: MaintenanceConfig,
  dryRun: boolean
): Promise<MaintenanceScopeResult> {
  const result: MaintenanceScopeResult = { scanned: 0, deleted: [], skipped: [], errors: [] };
  const workspaceRoot = deps.workspaceRoot;
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
