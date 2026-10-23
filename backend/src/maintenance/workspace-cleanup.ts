import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { MaintenanceConfig } from '@comiccrawler/shared';
import type { MaintenanceResult, MaintenanceScopeResult } from './service';
import { assertInside, dirSize } from './fs-utils';

export interface WorkspaceCleanupDeps {
  workspaceRoot?: string;
}

/**
 * Verified DOM fixtures captured per challenge-discovery flow
 * (`agent-workspaces/fixtures/<domain>/<id>/`). Each capture writes a full
 * page.html plus metadata, so they require retention-based cleanup.
 * Re-capturable at any time via the fixtures API, hence retention-based.
 */
export async function cleanupFixtures(
  deps: WorkspaceCleanupDeps,
  policy: MaintenanceConfig,
  dryRun: boolean
): Promise<MaintenanceResult['fixtures']> {
  const result: MaintenanceResult['fixtures'] = { scanned: 0, deleted: [], skipped: [], errors: [], bytesFreed: 0 };
  const workspaceRoot = deps.workspaceRoot;
  if (!workspaceRoot) { result.skipped.push('workspaceRoot not configured'); return result; }
  const fixturesRoot = join(workspaceRoot, 'fixtures');
  const cutoff = Date.now() - policy.discoveryJobsRetainDays * 24 * 60 * 60 * 1000;
  for (const domain of await listDirectories(fixturesRoot)) {
    await cleanupFixtureDomain(fixturesRoot, domain, cutoff, dryRun, result);
  }
  return result;
}

async function cleanupFixtureDomain(root: string, domain: string, cutoff: number, dryRun: boolean,
  result: MaintenanceResult['fixtures']): Promise<void> {
  const domainDir = join(root, domain);
  for (const id of await listDirectories(domainDir)) {
    await cleanupFixture(root, domain, id, cutoff, dryRun, result);
  }
}

async function cleanupFixture(root: string, domain: string, id: string, cutoff: number, dryRun: boolean,
  result: MaintenanceResult['fixtures']): Promise<void> {
  const dir = join(root, domain, id);
  const mtimeMs = await directoryMtime(dir);
  if (mtimeMs === null) return;
  const key = `${domain}/${id}`;
  result.scanned += 1;
  if (mtimeMs >= cutoff) { result.skipped.push(`${key}: within retention`); return; }
  const size = await dirSize(dir).catch(() => 0);
  if (dryRun) { result.deleted.push(key); result.bytesFreed += size; return; }
  try {
    assertInside(dir, root); await fs.rm(dir, { recursive: true, force: true });
    result.deleted.push(key); result.bytesFreed += size;
  } catch (error) { result.errors.push({ id: key, error: errorMessage(error) }); }
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
  if (!workspaceRoot) { result.skipped.push('workspaceRoot not configured'); return result; }
  const cutoff = Date.now() - policy.tasksRetainDays * 24 * 60 * 60 * 1000;
  const ignoredTopLevel = new Set(['fixtures', 'approved-fixtures', 'bundle-evaluations']);
  for (const top of await listDirectories(workspaceRoot)) {
    if (ignoredTopLevel.has(top)) continue;
    await cleanupAdapterSessions(workspaceRoot, top, cutoff, dryRun, result);
  }
  return result;
}

async function cleanupAdapterSessions(root: string, adapterId: string, cutoff: number, dryRun: boolean,
  result: MaintenanceScopeResult): Promise<void> {
  for (const child of await listDirectories(join(root, adapterId))) {
    if (child.startsWith('session-')) await cleanupSession(root, adapterId, child, cutoff, dryRun, result);
  }
}

async function cleanupSession(root: string, adapterId: string, session: string, cutoff: number, dryRun: boolean,
  result: MaintenanceScopeResult): Promise<void> {
  const dir = join(root, adapterId, session);
  const mtimeMs = await directoryMtime(dir);
  if (mtimeMs === null) return;
  const key = `${adapterId}/${session}`;
  result.scanned += 1;
  if (mtimeMs >= cutoff) { result.skipped.push(`${key}: within retention`); return; }
  if (dryRun) { result.deleted.push(key); return; }
  try { assertInside(dir, root); await fs.rm(dir, { recursive: true, force: true }); result.deleted.push(key); }
  catch (error) { result.errors.push({ id: key, error: errorMessage(error) }); }
}

async function listDirectories(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch { return []; }
}

async function directoryMtime(path: string): Promise<number | null> {
  try { const stat = await fs.stat(path); return stat.isDirectory() ? stat.mtimeMs : null; }
  catch { return null; }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
