import type { SelectorDiscoveryJob } from './types';

const ACTIVE_STATUSES = new Set<SelectorDiscoveryJob['status']>(['queued', 'running']);
const TERMINAL_STATUSES = new Set<string>([
  'known_adapter', 'configuration_required', 'promoted', 'invalid', 'failed',
]);

export function isActiveSelectorDiscoveryJob(job: Pick<SelectorDiscoveryJob, 'status'>): boolean {
  return ACTIVE_STATUSES.has(job.status);
}

export function isTerminalSelectorDiscoveryJob(job: { status?: string }): boolean {
  return Boolean(job.status && TERMINAL_STATUSES.has(job.status));
}

export function compactPromotedSelectorDiscoveryJob(
  job: SelectorDiscoveryJob, adapterId: string, adapterName: string, version: string
): SelectorDiscoveryJob {
  const now = new Date().toISOString();
  const compact = { ...job, status: 'promoted' as const, phase: 'complete' as const,
    adapterId, adapterName, promotedVersion: version, finishedAt: now,
    artifactsCleanedAt: now, updatedAt: now, error: undefined };
  delete compact.phase1Markdown; delete compact.capabilityDrafts;
  delete compact.adapterImplementationTs; delete compact.reviewNotesMarkdown;
  delete compact.functionRevisionTasks; delete compact.browserSessionId;
  return compact;
}
