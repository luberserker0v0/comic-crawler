import type { MaintenanceConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import type { TaskManager } from '../task/manager';
import type { SelectorDiscoveryService } from '../selector-discovery';
import type { ChallengeDiscoveryService } from '../challenge';
import type { MaintenanceScopeResult } from './service';

export interface DiscoveryCandidate {
  kind: 'selector' | 'challenge';
  id: string;
  updatedAt?: string;
}

export interface DiscoveryCleanupDeps {
  storage: IStorage;
  taskManager: TaskManager;
  selectorDiscoveryService?: SelectorDiscoveryService;
  challengeDiscoveryService?: ChallengeDiscoveryService;
}

const SELECTOR_JOB_PREFIX = 'selector-discovery-job-';
const SELECTOR_INDEX_KEY = 'selector-discovery-index';
const CHALLENGE_JOB_PREFIX = 'challenge-discovery-job-';
const CHALLENGE_INDEX_KEY = 'challenge-discovery-index';

export async function cleanupDiscoveryJobs(
  deps: DiscoveryCleanupDeps,
  policy: MaintenanceConfig,
  batchLimit: number,
  dryRun: boolean,
  recentlyDeletedTaskIds: string[]
): Promise<MaintenanceScopeResult> {
  const result: MaintenanceScopeResult = { scanned: 0, deleted: [], skipped: [], errors: [] };
  const cutoff = Date.now() - policy.discoveryJobsRetainDays * 24 * 60 * 60 * 1000;
  const referenced = new Set<string>();
  for (const task of deps.taskManager.getAllTasks()) {
    if (recentlyDeletedTaskIds.includes(task.id)) continue;
    const challengeId = deps.taskManager.getTaskResult(task.id)?.challengeDiscoveryId;
    if (challengeId) referenced.add(challengeId);
  }

  const candidates = await collectDiscoveryCandidates(deps, dryRun);
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
    const updatedAt = await resolveCandidateTime(deps, candidate);
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
      const deleted = await deleteDiscoveryCandidate(deps, candidate);
      if (deleted) result.deleted.push(candidate.id);
      else result.skipped.push(`${candidate.id}: delete refused`);
    } catch (error) {
      result.errors.push({ id: candidate.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export async function resolveCandidateTime(deps: DiscoveryCleanupDeps, candidate: DiscoveryCandidate): Promise<number> {
  if (candidate.updatedAt) {
    const parsed = new Date(candidate.updatedAt).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  // Fall back to file mtime so corrupt/unparseable job files don't linger forever.
  try {
    const stat = await deps.storage.stat?.(
      `${candidate.kind === 'selector' ? SELECTOR_JOB_PREFIX : CHALLENGE_JOB_PREFIX}${candidate.id}`
    );
    if (stat && Number.isFinite(stat.mtimeMs)) return stat.mtimeMs;
  } catch {
    // fall through to NaN
  }
  return NaN;
}

export async function collectDiscoveryCandidates(deps: DiscoveryCleanupDeps, dryRun: boolean): Promise<DiscoveryCandidate[]> {
  const out: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  if (deps.selectorDiscoveryService) {
    try {
      for (const job of await deps.selectorDiscoveryService.list()) {
        seen.add(`selector:${job.id}`);
        out.push({ kind: 'selector', id: job.id, updatedAt: job.updatedAt });
      }
    } catch {
      // Index unreadable; fall back to storage listing below.
    }
    await pruneStaleIndexEntries(deps, SELECTOR_INDEX_KEY, seen, 'selector:', dryRun);
  }
  if (deps.challengeDiscoveryService) {
    try {
      for (const job of await deps.challengeDiscoveryService.list()) {
        seen.add(`challenge:${job.id}`);
        out.push({ kind: 'challenge', id: job.id, updatedAt: job.updatedAt });
      }
    } catch {
      // Fall through to storage listing.
    }
    await pruneStaleIndexEntries(deps, CHALLENGE_INDEX_KEY, seen, 'challenge:', dryRun);
  }
  // Orphan files: keys on disk that fell out of the capped index (slice(0,200)).
  try {
    const keys = await deps.storage.list();
    for (const key of keys) {
      if (key.startsWith(SELECTOR_JOB_PREFIX)) {
        const id = key.slice(SELECTOR_JOB_PREFIX.length);
        if (!seen.has(`selector:${id}`)) {
          const job = await deps.selectorDiscoveryService?.get(id).catch(() => null);
          out.push({ kind: 'selector', id, updatedAt: job?.updatedAt });
        }
      } else if (key.startsWith(CHALLENGE_JOB_PREFIX)) {
        const id = key.slice(CHALLENGE_JOB_PREFIX.length);
        if (!seen.has(`challenge:${id}`)) {
          const job = await deps.challengeDiscoveryService?.get(id).catch(() => null);
          out.push({ kind: 'challenge', id, updatedAt: job?.updatedAt });
        }
      }
    }
    // Repair truncated indexes opportunistically (best effort).
    await repairIndex(deps, SELECTOR_INDEX_KEY, SELECTOR_JOB_PREFIX);
    await repairIndex(deps, CHALLENGE_INDEX_KEY, CHALLENGE_JOB_PREFIX);
  } catch {
    // storage.list failure should not fail the whole cleanup.
  }
  return out;
}

export async function repairIndex(deps: DiscoveryCleanupDeps, indexKey: string, prefix: string): Promise<void> {
  try {
    const keys = await deps.storage.list();
    const ids = keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    if (ids.length === 0) return;
    const existing = (await deps.storage.read<string[]>(indexKey)) ?? [];
    const merged = Array.from(new Set([...existing, ...ids]));
    if (merged.length !== existing.length) {
      await deps.storage.write(indexKey, merged.slice(0, 200));
    }
  } catch {
    // best effort only
  }
}

export async function pruneStaleIndexEntries(
  deps: DiscoveryCleanupDeps,
  indexKey: string,
  seen: Set<string>,
  prefix: string,
  dryRun: boolean
): Promise<void> {
  // Index entries whose job file no longer exists occupy index slots and
  // hide in list() results; prune them so the index reflects reality.
  try {
    const ids = (await deps.storage.read<string[]>(indexKey)) ?? [];
    const stale = ids.filter((id) => !seen.has(`${prefix}${id}`));
    if (stale.length === 0) return;
    if (dryRun) return;
    const verified = new Set<string>();
    const jobPrefix = prefix === 'selector:' ? SELECTOR_JOB_PREFIX : CHALLENGE_JOB_PREFIX;
    for (const id of stale) {
      if (await deps.storage.exists(`${jobPrefix}${id}`)) verified.add(id);
    }
    const removable = stale.filter((id) => !verified.has(id));
    if (removable.length === 0) return;
    await deps.storage.write(indexKey, ids.filter((id) => !removable.includes(id)));
  } catch {
    // best effort only
  }
}

export async function deleteDiscoveryCandidate(deps: DiscoveryCleanupDeps, candidate: DiscoveryCandidate): Promise<boolean> {
  if (candidate.kind === 'selector' && deps.selectorDiscoveryService) {
    const ok = await deps.selectorDiscoveryService.deleteJob(candidate.id);
    if (ok) return true;
  }
  if (candidate.kind === 'challenge' && deps.challengeDiscoveryService) {
    const ok = await deps.challengeDiscoveryService.deleteJob(candidate.id);
    if (ok) return true;
  }
  // Fallback: direct storage delete for orphan keys with no service.
  const prefix = candidate.kind === 'selector' ? SELECTOR_JOB_PREFIX : CHALLENGE_JOB_PREFIX;
  const indexKey = candidate.kind === 'selector' ? SELECTOR_INDEX_KEY : CHALLENGE_INDEX_KEY;
  await deps.storage.delete(`${prefix}${candidate.id}`);
  if (candidate.kind === 'selector') {
    await deps.storage.delete(`selector-discovery-implementation-${candidate.id}`);
    await deps.storage.delete(`selector-discovery-manifest-${candidate.id}`);
    await deps.storage.delete(`selector-discovery-shadow-promotion-${candidate.id}`);
  }
  try {
    const ids = (await deps.storage.read<string[]>(indexKey)) ?? [];
    if (ids.includes(candidate.id)) {
      await deps.storage.write(indexKey, ids.filter((id) => id !== candidate.id));
    }
  } catch {
    // index pruning is best effort; the next run retries it
  }
  return true;
}
