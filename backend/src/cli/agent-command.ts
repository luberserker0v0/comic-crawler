import type { Command } from 'commander';
import { formatError } from '../error/types';
import { logger } from '../utils/logger';
import { agentCliMessages } from './agent-messages';
import type { CliCommandContext } from './command-context';
import { registerBundleEvalCommand } from './bundle-eval-command';

export function setupAgentCommand(ctx: CliCommandContext): void {
  const command = ctx.program.command('agent').description(agentCliMessages.description);
  registerStatusCommand(command, ctx);
  registerVersionCommand(command, ctx, 'promote');
  registerVersionCommand(command, ctx, 'reject');
  registerVersionCommand(command, ctx, 'rollback');
  registerBundleEvalCommand(command, ctx);
}

function registerStatusCommand(command: Command, ctx: CliCommandContext): void {
  command.command('status').description(agentCliMessages.commands.status.description)
    .argument('[adapterId]', agentCliMessages.commands.status.adapterArgument)
    .option('-a, --all', agentCliMessages.commands.status.allOption)
    .action(async (adapterId?: string, options?: { all?: boolean }) => showStatus(ctx, adapterId, options));
}

async function showStatus(ctx: CliCommandContext, adapterId?: string, options?: { all?: boolean }): Promise<void> {
  try {
    if (options?.all || !adapterId) { await showAllStatuses(ctx); return; }
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
  } catch (error) { handleCommandError(ctx, error, 'Failed to get agent status'); }
}

async function showAllStatuses(ctx: CliCommandContext): Promise<void> {
  const adapterIds = ctx.options.adapterRegistry.list().map((adapter) => adapter.id);
  const states = await ctx.options.agentAdminService.listAdapterStates(adapterIds);
  const rows = states.map((state) => [
    state.adapterId, state.session?.status ?? '-', state.activeVersion?.version ?? '-',
    state.latestCandidate?.version ?? '-', String(state.versions?.versions.length ?? 0),
  ]);
  ctx.ui.renderTable([...agentCliMessages.commands.status.summaryHeaders], rows);
}

type VersionAction = 'promote' | 'reject' | 'rollback';

function registerVersionCommand(command: Command, ctx: CliCommandContext, action: VersionAction): void {
  const messages = agentCliMessages.commands[action];
  command.command(action).description(messages.description).argument('<adapterId>', messages.adapterArgument)
    .option('-v, --version <version>', messages.versionOption)
    .action(async (adapterId: string, options: { version?: string }) => changeVersion(ctx, action, adapterId, options.version));
}

async function changeVersion(ctx: CliCommandContext, action: VersionAction, adapterId: string, version?: string): Promise<void> {
  try {
    const result = action === 'promote' ? await ctx.options.agentAdminService.promoteCandidate(adapterId, version)
      : action === 'reject' ? await ctx.options.agentAdminService.rejectCandidate(adapterId, version)
        : await ctx.options.agentAdminService.rollback(adapterId, version);
    const versionResult = result as { currentVersion?: string; version?: string };
    const resultVersion = versionResult.currentVersion ?? versionResult.version;
    if (!result.success || !resultVersion) {
      ctx.ui.renderError(result.error ?? `Failed to ${action} adapter`);
      process.exit(1);
    }
    ctx.ui.renderSuccess(agentCliMessages.commands[action].success(adapterId, resultVersion));
  } catch (error) { handleCommandError(ctx, error, `Failed to ${action} adapter`); }
}

function handleCommandError(ctx: CliCommandContext, error: unknown, message: string): never {
  logger.error({ error: formatError(error) }, message);
  ctx.ui.renderError(formatError(error));
  process.exit(1);
}
