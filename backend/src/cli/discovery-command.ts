import { promises as fs } from 'node:fs';
import { formatError } from '../error/types';
import { logger } from '../utils/logger';
import { assertModelExists, validateProviderDocument } from '../selector-discovery/provider-config';
import type { CliCommandContext } from './command-context';

export function setupDiscoverCommand(ctx: CliCommandContext): void {
  ctx.program
    .command('discover')
    .description('Discover selectors for a comic URL through AO selector-discovery')
    .argument('<url>', 'Comic metadata URL')
    .requiredOption('--ao-url <url>', 'AO base URL')
    .requiredOption('--provider-json <path>', 'Provider JSON file with a top-level provider field')
    .requiredOption('--model <model>', 'OpenCode model id in <provider>/<model> format')
    .option('--target <target>', 'Discovery target: full or chapter-only', 'full')
    .option('--html-snapshot <path>', 'Rendered chapter HTML snapshot file for chapter-only discovery')
    .option('--force-discovery', 'Run AO discovery even when a registered adapter already matches the URL')
    .option('--stop-after-stage <stage>', 'Internal smoke test: stop after capability stage common-verification, metadata, or chapter-images')
    .action(async (url: string, options: {
      aoUrl: string;
      providerJson: string;
      model: string;
      target?: string;
      htmlSnapshot?: string;
      forceDiscovery?: boolean;
      stopAfterStage?: string;
    }) => {
      try {
        if (!ctx.options.selectorDiscoveryService) {
          ctx.ui.renderError('Selector discovery service is not available in this CLI context.');
          process.exit(1);
        }
        if (options.target !== 'full' && options.target !== 'chapter-only') {
          throw new Error('Discovery target must be "full" or "chapter-only".');
        }
        if (options.stopAfterStage && !['common-verification', 'metadata', 'chapter-images'].includes(options.stopAfterStage)) {
          throw new Error('--stop-after-stage must be common-verification, metadata, or chapter-images.');
        }
        const providerDocument = validateProviderDocument(JSON.parse(await fs.readFile(options.providerJson, 'utf-8')));
        assertModelExists(providerDocument, options.model);
        const htmlSnapshot = options.htmlSnapshot
          ? {
              html: await fs.readFile(options.htmlSnapshot, 'utf-8'),
              finalUrl: url,
              pageType: 'chapter' as const,
            }
          : undefined;
        if (htmlSnapshot && options.target !== 'chapter-only') {
          throw new Error('--html-snapshot requires --target chapter-only.');
        }
        const job = await ctx.options.selectorDiscoveryService.create({
          url,
          target: options.target,
          aoBaseUrl: options.aoUrl,
          providerDocument,
          model: options.model,
          forceDiscovery: options.forceDiscovery,
          stopAfterStage: options.stopAfterStage as any,
          htmlSnapshot,
        });
        ctx.ui.renderSuccess(`Discovery job ${job.id} created with status ${job.status}`);
        ctx.ui.renderStatus('url', job.normalizedUrl);
        ctx.ui.renderStatus('target', job.target ?? 'full');
        ctx.ui.renderStatus('browser', 'task-bound Browser Worker');
        ctx.ui.renderStatus('model', options.model);
      } catch (error) {
        logger.error({ error: formatError(error) }, 'Failed to create selector discovery job');
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });
}
