import { formatError } from '../error/types';
import { logger } from '../utils/logger';
import type { CliCommandContext } from './command-context';

export function setupMaintenanceCommand(ctx: CliCommandContext): void {
  ctx.program
    .command('cleanup')
    .description('Delete expired tasks, discovery jobs, fixtures, agent sessions and downloaded files')
    .option('--dry-run', 'Preview without deleting')
    .option('--tasks-retain-days <n>', 'Override task retention days')
    .option('--discovery-jobs-retain-days <n>', 'Override discovery job retention days')
    .option('--no-delete-files', 'Keep downloaded files')
    .action(async (options: CleanupOptions) => cleanup(ctx, options));
}

interface CleanupOptions { dryRun?: boolean; tasksRetainDays?: string; discoveryJobsRetainDays?: string; deleteFiles?: boolean }

async function cleanup(ctx: CliCommandContext, options: CleanupOptions): Promise<void> {
  try {
    const service = ctx.options.maintenanceService;
    if (!service) { ctx.ui.renderError('Maintenance service is not available.'); process.exit(1); }
    const result = await service.run(cleanupOverrides(options), { dryRun: options.dryRun ?? false });
    renderCleanupResult(ctx, result, Boolean(options.dryRun));
    const errors = [...result.tasks.errors, ...result.discoveryJobs.errors, ...result.fixtures.errors, ...result.agentSessions.errors];
    if (errors.length > 0) { ctx.ui.renderError(`Errors: ${JSON.stringify(errors)}`); process.exit(1); }
  } catch (error) {
    logger.error({ error: formatError(error) }, 'Cleanup failed');
    ctx.ui.renderError(formatError(error)); process.exit(1);
  }
}

function cleanupOverrides(options: CleanupOptions) {
  const tasksRetainDays = toNumber(options.tasksRetainDays);
  const discoveryJobsRetainDays = toNumber(options.discoveryJobsRetainDays);
  return {
    ...(tasksRetainDays !== undefined ? { tasksRetainDays } : {}),
    ...(discoveryJobsRetainDays !== undefined ? { discoveryJobsRetainDays } : {}),
    ...(options.deleteFiles === false ? { deleteFiles: false } : {}),
  };
}

function renderCleanupResult(ctx: CliCommandContext, result: Awaited<ReturnType<NonNullable<CliCommandContext['options']['maintenanceService']>['run']>>, dryRun: boolean): void {
  ctx.ui.renderSuccess(dryRun ? 'Cleanup preview completed.' : 'Cleanup completed.');
  ctx.ui.renderStatus('tasks deleted', result.tasks.deleted.join(', ') || '-');
  ctx.ui.renderStatus('discovery jobs deleted', result.discoveryJobs.deleted.join(', ') || '-');
  ctx.ui.renderStatus('fixtures deleted', result.fixtures.deleted.join(', ') || '-');
  ctx.ui.renderStatus('agent sessions deleted', result.agentSessions.deleted.join(', ') || '-');
  ctx.ui.renderStatus('bytes freed', String(result.fixtures.bytesFreed));
}

function toNumber(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
