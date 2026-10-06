import { promises as fs } from 'node:fs';
import type { Command } from 'commander';
import { formatError } from '../error/types';
import { logger } from '../utils/logger';
import { SelectorDiscoveryBundleManager } from '../selector-discovery';
import { loadSelectorDiscoveryEvalCases } from '../selector-discovery/eval-suite';
import { assertModelExists, validateProviderDocument } from '../selector-discovery/provider-config';
import type { CliCommandContext } from './command-context';
import { BundleEvalPolicyError } from './bundle-eval-types';
import type { SelectorDiscoveryEvalRunResult } from './bundle-eval-types';
import {
  evaluateBundleEvalPolicy,
  renderBundleEvalCaseInventory,
  renderBundleEvalDryRun,
  renderBundleEvalPolicy,
  renderBundleEvalResult,
  renderBundleFreezePolicyError,
} from './bundle-eval-report';
import {
  readPassingBundleEvalSummary,
  runSelectorDiscoveryEvalGate,
  waitForSelectorDiscoveryJob,
  writeSelectorDiscoveryBundleEvalSuiteArtifact,
} from './bundle-eval-artifacts';

export function registerBundleEvalCommand(agentCmd: Command, ctx: CliCommandContext): void {
  agentCmd
    .command('bundle-eval')
    .description('Create a selector-discovery AO job for the bundled Kuronavi evaluation URL')
    .option('--ao-url <url>', 'AO base URL')
    .option('--provider-json <path>', 'Provider JSON file with a top-level provider field')
    .option('--model <model>', 'OpenCode model id in <provider>/<model> format')
    .option('--case <id>', 'Run only one eval case id')
    .option('--repeat <n>', 'Override run count per eval case')
    .option('--live-negative', 'Include disabled live negative cases that may call AO')
    .option('--include-disabled', 'Include all disabled eval cases')
    .option('--min-positive-passes <n>', 'Minimum passing positive eval runs required for release policy')
    .option('--max-positive-failures <n>', 'Maximum failing positive eval runs allowed for release policy', '0')
    .option('--dry-run', 'Print eval suite plan without creating AO discovery jobs')
    .option('--list-cases', 'List eval case inventory without requiring AO/provider/model options')
    .option('--timeout-minutes <minutes>', 'Maximum time to wait for the AO discovery job', '35')
    .option('--poll-interval-ms <ms>', 'Polling interval while waiting for the AO discovery job', '5000')
    .action(async (options: {
      aoUrl: string;
      providerJson: string;
      model: string;
      case?: string;
      repeat?: string;
      liveNegative?: boolean;
      includeDisabled?: boolean;
      minPositivePasses?: string;
      maxPositiveFailures?: string;
      dryRun?: boolean;
      listCases?: boolean;
      timeoutMinutes?: string;
      pollIntervalMs?: string;
    }) => {
      try {
        const cases = await loadSelectorDiscoveryEvalCases({
          caseId: options.case,
          includeDisabled: options.includeDisabled,
          includeLiveNegative: options.liveNegative,
        });
        if (cases.length === 0) {
          throw new Error(options.case ? `Eval case "${options.case}" was not found or is disabled.` : 'No enabled selector-discovery eval cases were found.');
        }

        if (options.listCases) {
          renderBundleEvalCaseInventory(ctx.ui, cases, {
            includeDisabled: options.includeDisabled,
            liveNegative: options.liveNegative,
          });
          return;
        }

        if (!options.aoUrl?.trim()) throw new Error('--ao-url is required unless --list-cases is used.');
        if (!options.providerJson?.trim()) throw new Error('--provider-json is required unless --list-cases is used.');
        if (!options.model?.trim()) throw new Error('--model is required unless --list-cases is used.');
        if (!ctx.options.selectorDiscoveryService) {
          ctx.ui.renderError('Selector discovery service is not available in this CLI context.');
          process.exit(1);
        }
        const providerDocument = validateProviderDocument(JSON.parse(await fs.readFile(options.providerJson, 'utf-8')));
        assertModelExists(providerDocument, options.model);

        const repeatOverride = options.repeat ? Number.parseInt(options.repeat, 10) : undefined;
        if (repeatOverride !== undefined && (!Number.isInteger(repeatOverride) || repeatOverride <= 0)) {
          throw new Error('--repeat must be a positive integer.');
        }

        if (options.dryRun) {
          renderBundleEvalDryRun(ctx.ui, cases, {
            repeatOverride,
            minPositivePasses: options.minPositivePasses,
            maxPositiveFailures: options.maxPositiveFailures,
            includeDisabled: options.includeDisabled,
            liveNegative: options.liveNegative,
          });
          return;
        }

        const gateResults: SelectorDiscoveryEvalRunResult[] = [];
        for (const evalCase of cases) {
          const runs = repeatOverride ?? evalCase.defaultRuns;
          for (let runIndex = 1; runIndex <= runs; runIndex++) {
            ctx.ui.renderInfo(`Running eval case ${evalCase.id} (${runIndex}/${runs})`);
            try {
              const job = await ctx.options.selectorDiscoveryService.create({
                url: evalCase.url,
                aoBaseUrl: options.aoUrl,
                providerDocument,
                model: options.model,
                forceDiscovery: true,
              });
              ctx.ui.renderSuccess(`Bundle evaluation job ${job.id} created with status ${job.status}`);
              ctx.ui.renderStatus('url', job.normalizedUrl);
              ctx.ui.renderStatus('model', options.model);
              const completed = await waitForSelectorDiscoveryJob(
                ctx,
                job.id,
                Number(options.timeoutMinutes ?? '35') * 60_000,
                Number(options.pollIntervalMs ?? '5000')
              );
              const gateResult = await runSelectorDiscoveryEvalGate(ctx, completed.id, evalCase);
              gateResults.push({ case: evalCase, runIndex, ...gateResult });
              renderBundleEvalResult(ctx.ui, gateResult);
            } catch (error) {
              const rejection = error instanceof Error ? error.message : String(error);
              if (evalCase.type !== 'negative') throw error;
              const gateResult = {
                passed: true,
                job: undefined,
                reasons: [],
                rejection,
              };
              gateResults.push({ case: evalCase, runIndex, ...gateResult });
              ctx.ui.renderSuccess(`Negative eval case rejected before discovery: ${rejection}`);
            }
          }
        }

        const policy = evaluateBundleEvalPolicy(gateResults, {
          minPositivePasses: options.minPositivePasses,
          maxPositiveFailures: options.maxPositiveFailures,
        });
        const artifactPath = await writeSelectorDiscoveryBundleEvalSuiteArtifact(gateResults, {
          providerDocument,
          model: options.model,
          aoBaseUrl: options.aoUrl,
          policy,
        });
        ctx.ui.renderStatus('artifact path', artifactPath);
        const failed = gateResults.filter((result) => !result.passed);
        ctx.ui.renderStatus('eval cases', String(cases.length));
        ctx.ui.renderStatus('eval runs', String(gateResults.length));
        ctx.ui.renderStatus('eval failures', String(failed.length));
        renderBundleEvalPolicy(ctx.ui, policy);
        if (!policy.passed) {
          process.exit(1);
        }
      } catch (error) {
        logger.error({ error: formatError(error) }, 'Failed to create selector discovery bundle evaluation');
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });

  agentCmd
    .command('bundle-freeze')
    .description('Freeze the selector-discovery draft AO bundle into releases/vN after a passing bundle evaluation')
    .requiredOption('--eval-bundle-hash <hash>', 'Bundle hash directory produced by agent bundle-eval')
    .option('--version <version>', 'Release version such as v1. Defaults to the next vN.')
    .action(async (options: { evalBundleHash: string; version?: string }) => {
      try {
        const evalSummary = await readPassingBundleEvalSummary(options.evalBundleHash);
        const bundleManager = new SelectorDiscoveryBundleManager();
        const result = await bundleManager.freezeDraft({
          version: options.version,
          evalBundleHash: options.evalBundleHash,
        });

        ctx.ui.renderSuccess(`Selector-discovery AO bundle frozen as ${result.release}.`);
        ctx.ui.renderStatus('release root', result.releaseRoot);
        ctx.ui.renderStatus('sha256', result.sha256);
        ctx.ui.renderStatus('active.json', result.activePath);
        ctx.ui.renderStatus('eval job', String(evalSummary.job?.id ?? '-'));
      } catch (error) {
        logger.error({ error: formatError(error) }, 'Failed to freeze selector discovery bundle');
        if (error instanceof BundleEvalPolicyError) {
          renderBundleFreezePolicyError(ctx.ui, error);
          process.exit(1);
        }
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });
}
