import { promises as fs } from 'node:fs';
import { formatError } from '../error/types';
import { assertModelExists, validateProviderDocument } from '../selector-discovery/provider-config';
import { logger } from '../utils/logger';
import type { CliCommandContext } from './command-context';

interface DiscoverOptions {
  aoUrl: string;
  providerJson: string;
  model: string;
  target?: string;
  htmlSnapshot?: string;
  forceDiscovery?: boolean;
  stopAfterStage?: string;
}

export function setupDiscoverCommand(ctx: CliCommandContext): void {
  ctx.program.command('discover').description('Discover selectors for a comic URL through AO selector-discovery')
    .argument('<url>', 'Comic metadata URL').requiredOption('--ao-url <url>', 'AO base URL')
    .requiredOption('--provider-json <path>', 'Provider JSON file with a top-level provider field')
    .requiredOption('--model <model>', 'OpenCode model id in <provider>/<model> format')
    .option('--target <target>', 'Discovery target: full or chapter-only', 'full')
    .option('--html-snapshot <path>', 'Rendered chapter HTML snapshot file for chapter-only discovery')
    .option('--force-discovery', 'Run AO discovery even when a registered adapter already matches the URL')
    .option('--stop-after-stage <stage>', 'Stop after common-verification, metadata, reader-preparation, or chapter-images')
    .action(async (url: string, options: DiscoverOptions) => discover(ctx, url, options));
}

async function discover(ctx: CliCommandContext, url: string, options: DiscoverOptions): Promise<void> {
  try {
    const service = ctx.options.selectorDiscoveryService;
    if (!service) { ctx.ui.renderError('Selector discovery service is not available in this CLI context.'); process.exit(1); }
    validateDiscoverOptions(options);
    const providerDocument = validateProviderDocument(JSON.parse(await fs.readFile(options.providerJson, 'utf-8')));
    assertModelExists(providerDocument, options.model);
    const htmlSnapshot = await loadSnapshot(url, options);
    const job = await service.create({
      url, target: options.target as 'full' | 'chapter-only', aoBaseUrl: options.aoUrl,
      providerDocument, model: options.model, forceDiscovery: options.forceDiscovery,
      stopAfterStage: options.stopAfterStage as any, htmlSnapshot,
    });
    renderDiscovery(ctx, job, options.model);
  } catch (error) {
    logger.error({ error: formatError(error) }, 'Failed to create selector discovery job');
    ctx.ui.renderError(formatError(error)); process.exit(1);
  }
}

function validateDiscoverOptions(options: DiscoverOptions): void {
  if (options.target !== 'full' && options.target !== 'chapter-only') throw new Error('Discovery target must be "full" or "chapter-only".');
  if (options.stopAfterStage && !['common-verification', 'metadata', 'reader-preparation', 'chapter-images']
    .includes(options.stopAfterStage)) {
    throw new Error('--stop-after-stage must be common-verification, metadata, reader-preparation, or chapter-images.');
  }
  if (options.htmlSnapshot && options.target !== 'chapter-only') throw new Error('--html-snapshot requires --target chapter-only.');
}

async function loadSnapshot(url: string, options: DiscoverOptions) {
  if (!options.htmlSnapshot) return undefined;
  return { html: await fs.readFile(options.htmlSnapshot, 'utf-8'), finalUrl: url, pageType: 'chapter' as const };
}

function renderDiscovery(ctx: CliCommandContext, job: { id: string; status: string; normalizedUrl: string; target?: string }, model: string): void {
  ctx.ui.renderSuccess(`Discovery job ${job.id} created with status ${job.status}`);
  ctx.ui.renderStatus('url', job.normalizedUrl);
  ctx.ui.renderStatus('target', job.target ?? 'full');
  ctx.ui.renderStatus('browser', 'task-bound Browser Worker');
  ctx.ui.renderStatus('model', model);
}
