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

interface CleanupState {
  result: MaintenanceScopeResult;
  cutoff: number;
  referenced: Set<string>;
  processed: number;
  batchLimit: number;
  dryRun: boolean;
}

export async function cleanupDiscoveryJobs(
  deps: DiscoveryCleanupDeps,
  policy: MaintenanceConfig,
  batchLimit: number,
  dryRun: boolean,
  recentlyDeletedTaskIds: string[]
): Promise<MaintenanceScopeResult> {
  const result: MaintenanceScopeResult = { scanned: 0, deleted: [], skipped: [], errors: [] };
  const candidates = await collectDiscoveryCandidates(deps, dryRun);
  result.scanned = candidates.length;
  const state: CleanupState = { result, batchLimit, dryRun, processed: 0,
    cutoff: Date.now() - policy.discoveryJobsRetainDays * 24 * 60 * 60 * 1000,
    referenced: referencedChallengeIds(deps, recentlyDeletedTaskIds) };
  for (const candidate of candidates) await cleanCandidate(deps, candidate, state);
  return result;
}

function referencedChallengeIds(deps: DiscoveryCleanupDeps, deleted: string[]): Set<string> {
  const referenced = new Set<string>();
  for (const task of deps.taskManager.getAllTasks()) {
    if (deleted.includes(task.id)) continue;
    const id = deps.taskManager.getTaskResult(task.id)?.challengeDiscoveryId;
    if (id) referenced.add(id);
  }
  return referenced;
}

async function cleanCandidate(deps: DiscoveryCleanupDeps, candidate: DiscoveryCandidate,
  state: CleanupState): Promise<void> {
  const skipReason = await candidateSkipReason(deps, candidate, state);
  if (skipReason) return void state.result.skipped.push(`${candidate.id}: ${skipReason}`);
  state.processed += 1;
  if (state.dryRun) return void state.result.deleted.push(candidate.id);
  try {
    const deleted = await deleteDiscoveryCandidate(deps, candidate);
    if (deleted) state.result.deleted.push(candidate.id);
    else state.result.skipped.push(`${candidate.id}: delete refused`);
  } catch (error) {
    state.result.errors.push({ id: candidate.id,
      error: error instanceof Error ? error.message : String(error) });
  }
}

async function candidateSkipReason(deps: DiscoveryCleanupDeps, candidate: DiscoveryCandidate,
  state: CleanupState): Promise<string | undefined> {
  if (state.processed >= state.batchLimit) return 'batch limit reached';
  if (state.referenced.has(candidate.id)) return 'referenced by active task';
  const updatedAt = await resolveCandidateTime(deps, candidate);
  if (!Number.isFinite(updatedAt)) return 'unknown age, kept for manual review';
  if (updatedAt > state.cutoff) return 'within retention';
  return undefined;
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
  await collectIndexedCandidates(deps, 'selector', seen, out, dryRun);
  await collectIndexedCandidates(deps, 'challenge', seen, out, dryRun);
  await collectOrphanCandidates(deps, seen, out);
  return out;
}

async function collectIndexedCandidates(deps: DiscoveryCleanupDeps, kind: DiscoveryCandidate['kind'],
  seen: Set<string>, out: DiscoveryCandidate[], dryRun: boolean): Promise<void> {
  const service = kind === 'selector' ? deps.selectorDiscoveryService : deps.challengeDiscoveryService;
  if (!service) return;
  try {
    for (const job of await service.list()) {
      seen.add(`${kind}:${job.id}`);
      out.push({ kind, id: job.id, updatedAt: job.updatedAt });
    }
  } catch { /* Fall back to storage listing. */ }
  const indexKey = kind === 'selector' ? SELECTOR_INDEX_KEY : CHALLENGE_INDEX_KEY;
  await pruneStaleIndexEntries(deps, indexKey, seen, `${kind}:`, dryRun);
}

async function collectOrphanCandidates(deps: DiscoveryCleanupDeps, seen: Set<string>,
  out: DiscoveryCandidate[]): Promise<void> {
  try {
    for (const key of await deps.storage.list()) await appendOrphanCandidate(deps, key, seen, out);
    await repairIndex(deps, SELECTOR_INDEX_KEY, SELECTOR_JOB_PREFIX);
    await repairIndex(deps, CHALLENGE_INDEX_KEY, CHALLENGE_JOB_PREFIX);
  } catch { /* storage.list failure should not fail cleanup. */ }
}

async function appendOrphanCandidate(deps: DiscoveryCleanupDeps, key: string,
  seen: Set<string>, out: DiscoveryCandidate[]): Promise<void> {
  const kind = key.startsWith(SELECTOR_JOB_PREFIX) ? 'selector'
    : key.startsWith(CHALLENGE_JOB_PREFIX) ? 'challenge' : undefined;
  if (!kind) return;
  const prefix = kind === 'selector' ? SELECTOR_JOB_PREFIX : CHALLENGE_JOB_PREFIX;
  const id = key.slice(prefix.length);
  if (seen.has(`${kind}:${id}`)) return;
  const service = kind === 'selector' ? deps.selectorDiscoveryService : deps.challengeDiscoveryService;
  const job = await service?.get(id).catch(() => null);
  out.push({ kind, id, updatedAt: job?.updatedAt });
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
    if (!stale.length || dryRun) return;
    const jobPrefix = prefix === 'selector:' ? SELECTOR_JOB_PREFIX : CHALLENGE_JOB_PREFIX;
    const verified = await existingJobIds(deps, stale, jobPrefix);
    const removable = stale.filter((id) => !verified.has(id));
    if (!removable.length) return;
    await deps.storage.write(indexKey, ids.filter((id) => !removable.includes(id)));
  } catch {
    // best effort only
  }
}

async function existingJobIds(deps: DiscoveryCleanupDeps, ids: string[], prefix: string): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const id of ids) if (await deps.storage.exists(`${prefix}${id}`)) existing.add(id);
  return existing;
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
  await deleteOrphanCandidate(deps, candidate);
  return true;
}

async function deleteOrphanCandidate(deps: DiscoveryCleanupDeps,
  candidate: DiscoveryCandidate): Promise<void> {
  const prefix = candidate.kind === 'selector' ? SELECTOR_JOB_PREFIX : CHALLENGE_JOB_PREFIX;
  const indexKey = candidate.kind === 'selector' ? SELECTOR_INDEX_KEY : CHALLENGE_INDEX_KEY;
  await deps.storage.delete(`${prefix}${candidate.id}`);
  if (candidate.kind === 'selector') await deps.storage.delete(`selector-discovery-implementation-${candidate.id}`);
  try {
    const ids = (await deps.storage.read<string[]>(indexKey)) ?? [];
    if (ids.includes(candidate.id)) await deps.storage.write(indexKey, ids.filter((id) => id !== candidate.id));
  } catch {
    // index pruning is best effort; the next run retries it
  }
}
