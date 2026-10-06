import { formatError } from '../error/types';
import { logger } from '../utils/logger';
import { agentCliMessages } from './agent-messages';
import type { CliCommandContext } from './command-context';
import { registerBundleEvalCommand } from './bundle-eval-command';

export function setupAgentCommand(ctx: CliCommandContext): void {
  const agentCmd = ctx.program
    .command('agent')
    .description(agentCliMessages.description);

  agentCmd
    .command('status')
    .description(agentCliMessages.commands.status.description)
    .argument('[adapterId]', agentCliMessages.commands.status.adapterArgument)
    .option('-a, --all', agentCliMessages.commands.status.allOption)
    .action(async (adapterId?: string, options?: { all?: boolean }) => {
      try {
        if (options?.all || !adapterId) {
          const adapterIds = ctx.options.adapterRegistry.list().map((adapter) => adapter.id);
          const states = await ctx.options.agentAdminService.listAdapterStates(adapterIds);
          const rows = states.map((state) => [
            state.adapterId,
            state.session?.status ?? '-',
            state.activeVersion?.version ?? '-',
            state.latestCandidate?.version ?? '-',
            String(state.versions?.versions.length ?? 0),
          ]);
          ctx.ui.renderTable([...agentCliMessages.commands.status.summaryHeaders], rows);
          return;
        }

        const state = await ctx.options.agentAdminService.getAdapterState(adapterId);
        if (!state.session && !state.activeVersion && !state.latestCandidate && !state.versions) {
          ctx.ui.renderInfo(agentCliMessages.commands.status.noState);
          return;
        }

        ctx.ui.renderStatus('adapterId', state.adapterId);
        ctx.ui.renderStatus('sessionStatus', state.session?.status ?? '-');
        ctx.ui.renderStatus('activeVersion', state.activeVersion?.version ?? '-');
        ctx.ui.renderStatus('latestCandidate', state.latestCandidate?.version ?? '-');
        ctx.ui.renderStatus('versionCount', String(state.versions?.versions.length ?? 0));
      } catch (error) {
        logger.error({ error: formatError(error) }, 'Failed to get agent status');
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });

  agentCmd
    .command('promote')
    .description(agentCliMessages.commands.promote.description)
    .argument('<adapterId>', agentCliMessages.commands.promote.adapterArgument)
    .option('-v, --version <version>', agentCliMessages.commands.promote.versionOption)
    .action(async (adapterId: string, options: { version?: string }) => {
      try {
        const result = await ctx.options.agentAdminService.promoteCandidate(adapterId, options.version);
        if (!result.success || !result.version) {
          ctx.ui.renderError(result.error ?? 'Failed to promote candidate version');
          process.exit(1);
        }

        ctx.ui.renderSuccess(agentCliMessages.commands.promote.success(adapterId, result.version));
      } catch (error) {
        logger.error({ error: formatError(error) }, 'Failed to promote candidate version');
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });

  agentCmd
    .command('reject')
    .description(agentCliMessages.commands.reject.description)
    .argument('<adapterId>', agentCliMessages.commands.reject.adapterArgument)
    .option('-v, --version <version>', agentCliMessages.commands.reject.versionOption)
    .action(async (adapterId: string, options: { version?: string }) => {
      try {
        const result = await ctx.options.agentAdminService.rejectCandidate(adapterId, options.version);
        if (!result.success || !result.version) {
          ctx.ui.renderError(result.error ?? 'Failed to reject candidate version');
          process.exit(1);
        }

        ctx.ui.renderSuccess(agentCliMessages.commands.reject.success(adapterId, result.version));
      } catch (error) {
        logger.error({ error: formatError(error) }, 'Failed to reject candidate version');
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });

  agentCmd
    .command('rollback')
    .description(agentCliMessages.commands.rollback.description)
    .argument('<adapterId>', agentCliMessages.commands.rollback.adapterArgument)
    .option('-v, --version <version>', agentCliMessages.commands.rollback.versionOption)
    .action(async (adapterId: string, options: { version?: string }) => {
      try {
        const result = await ctx.options.agentAdminService.rollback(adapterId, options.version);
        if (!result.success || !result.currentVersion) {
          ctx.ui.renderError(result.error ?? 'Failed to rollback adapter');
          process.exit(1);
        }

        ctx.ui.renderSuccess(agentCliMessages.commands.rollback.success(adapterId, result.currentVersion));
      } catch (error) {
        logger.error({ error: formatError(error) }, 'Failed to rollback adapter');
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });

  registerBundleEvalCommand(agentCmd, ctx);
}
