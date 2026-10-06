import { formatError } from '../error/types';
import { logger } from '../utils/logger';
import type { CliCommandContext } from './command-context';

export function setupMaintenanceCommand(ctx: CliCommandContext): void {
  ctx.program
    .command('cleanup')
    .description('Delete expired tasks, discovery jobs, browser profiles and downloaded files')
    .option('--dry-run', 'Preview without deleting')
    .option('--tasks-retain-days <n>', 'Override task retention days')
    .option('--jobs-retain-days <n>', 'Override discovery job retention days')
    .option('--profiles-retain-days <n>', 'Override browser profile retention days')
    .option('--no-delete-files', 'Keep downloaded files')
    .action(async (options: { dryRun?: boolean; tasksRetainDays?: string; jobsRetainDays?: string; profilesRetainDays?: string; deleteFiles?: boolean }) => {
      try {
        if (!ctx.options.maintenanceService) {
          ctx.ui.renderError('Maintenance service is not available.');
          process.exit(1);
        }
        const toNumber = (value?: string): number | undefined => {
          if (value === undefined) return undefined;
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : undefined;
        };
        const overrides = {
          ...(toNumber(options.tasksRetainDays) !== undefined ? { tasksRetainDays: toNumber(options.tasksRetainDays) } : {}),
          ...(toNumber(options.jobsRetainDays) !== undefined ? { discoveryJobsRetainDays: toNumber(options.jobsRetainDays) } : {}),
          ...(toNumber(options.profilesRetainDays) !== undefined ? { browserProfilesRetainDays: toNumber(options.profilesRetainDays) } : {}),
          ...(options.deleteFiles === false ? { deleteFiles: false } : {}),
        };
        const result = await ctx.options.maintenanceService.run(overrides, { dryRun: options.dryRun ?? false });
        ctx.ui.renderSuccess(options.dryRun ? 'Cleanup preview completed.' : 'Cleanup completed.');
        ctx.ui.renderStatus('tasks deleted', result.tasks.deleted.join(', ') || '-');
        ctx.ui.renderStatus('discovery jobs deleted', result.discoveryJobs.deleted.join(', ') || '-');
        ctx.ui.renderStatus('browser profiles deleted', result.browserProfiles.deleted.join(', ') || '-');
        ctx.ui.renderStatus('fixtures deleted', result.fixtures.deleted.join(', ') || '-');
        ctx.ui.renderStatus('agent sessions deleted', result.agentSessions.deleted.join(', ') || '-');
        ctx.ui.renderStatus('bytes freed', String(result.browserProfiles.bytesFreed + result.fixtures.bytesFreed));
        if (result.tasks.errors.length > 0 || result.discoveryJobs.errors.length > 0 || result.browserProfiles.errors.length > 0 || result.fixtures.errors.length > 0 || result.agentSessions.errors.length > 0) {
          ctx.ui.renderError(`Errors: ${JSON.stringify([...result.tasks.errors, ...result.discoveryJobs.errors, ...result.browserProfiles.errors, ...result.fixtures.errors, ...result.agentSessions.errors])}`);
          process.exit(1);
        }
      } catch (error) {
        logger.error({ error: formatError(error) }, 'Cleanup failed');
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });
}
