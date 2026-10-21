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

interface BundleEvalOptions {
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
}

interface BundleFreezeOptions { evalBundleHash: string; version?: string }

type EvalCases = Awaited<ReturnType<typeof loadSelectorDiscoveryEvalCases>>;
type ProviderDocument = ReturnType<typeof validateProviderDocument>;

export function registerBundleEvalCommand(agentCmd: Command, ctx: CliCommandContext): void {
  createBundleEvalCommand(agentCmd).action((options: BundleEvalOptions) => handleBundleEval(ctx, options));
  createBundleFreezeCommand(agentCmd).action((options: BundleFreezeOptions) => handleBundleFreeze(ctx, options));
}

function createBundleEvalCommand(parent: Command): Command {
  const command = parent.command('bundle-eval')
    .description('Create selector-discovery AO evaluation jobs');
  addEvalInputOptions(command);
  addEvalPolicyOptions(command);
  addEvalExecutionOptions(command);
  return command;
}

function addEvalInputOptions(command: Command): void {
  command.option('--ao-url <url>', 'AO base URL')
    .option('--provider-json <path>', 'Provider JSON file with a top-level provider field')
    .option('--model <model>', 'OpenCode model id in <provider>/<model> format')
    .option('--case <id>', 'Run only one eval case id')
    .option('--repeat <n>', 'Override run count per eval case');
}

function addEvalPolicyOptions(command: Command): void {
  command.option('--live-negative', 'Include disabled live negative cases that may call AO')
    .option('--include-disabled', 'Include all disabled eval cases')
    .option('--min-positive-passes <n>', 'Minimum passing positive eval runs required for release policy')
    .option('--max-positive-failures <n>', 'Maximum failing positive eval runs allowed for release policy', '0');
}

function addEvalExecutionOptions(command: Command): void {
  command.option('--dry-run', 'Print eval suite plan without creating AO discovery jobs')
    .option('--list-cases', 'List eval case inventory without requiring AO/provider/model options')
    .option('--timeout-minutes <minutes>', 'Maximum time to wait for the AO discovery job', '35')
    .option('--poll-interval-ms <ms>', 'Polling interval while waiting for the AO discovery job', '5000');
}

function createBundleFreezeCommand(parent: Command): Command {
  return parent.command('bundle-freeze')
    .description('Freeze the selector-discovery draft AO bundle after a passing evaluation')
    .requiredOption('--eval-bundle-hash <hash>', 'Bundle hash directory produced by agent bundle-eval')
    .option('--version <version>', 'Release version such as v1. Defaults to the next vN.');
}

async function handleBundleEval(ctx: CliCommandContext, options: BundleEvalOptions): Promise<void> {
  try { await runBundleEval(ctx, options); }
  catch (error) {
    logger.error({ error: formatError(error) }, 'Failed to create selector discovery bundle evaluation');
    ctx.ui.renderError(formatError(error));
    process.exit(1);
  }
}

async function runBundleEval(ctx: CliCommandContext, options: BundleEvalOptions): Promise<void> {
  const cases = await loadEvalCases(options);
  if (options.listCases) return renderCaseInventory(ctx, cases, options);
  validateEvalOptions(ctx, options);
  const providerDocument = await loadProviderDocument(options);
  const repeatOverride = parseRepeat(options.repeat);
  if (options.dryRun) return renderDryRun(ctx, cases, options, repeatOverride);
  const results = await runEvalCases(ctx, cases, options, providerDocument, repeatOverride);
  await finishBundleEval(ctx, cases, results, options, providerDocument);
}

async function loadEvalCases(options: BundleEvalOptions): Promise<EvalCases> {
  const cases = await loadSelectorDiscoveryEvalCases({
    caseId: options.case,
    includeDisabled: options.includeDisabled,
    includeLiveNegative: options.liveNegative,
  });
  if (cases.length > 0) return cases;
  throw new Error(options.case
    ? `Eval case "${options.case}" was not found or is disabled.`
    : 'No enabled selector-discovery eval cases were found.');
}

function renderCaseInventory(ctx: CliCommandContext, cases: EvalCases, options: BundleEvalOptions): void {
  renderBundleEvalCaseInventory(ctx.ui, cases, {
    includeDisabled: options.includeDisabled,
    liveNegative: options.liveNegative,
  });
}

function validateEvalOptions(ctx: CliCommandContext, options: BundleEvalOptions): void {
  if (!options.aoUrl?.trim()) throw new Error('--ao-url is required unless --list-cases is used.');
  if (!options.providerJson?.trim()) throw new Error('--provider-json is required unless --list-cases is used.');
  if (!options.model?.trim()) throw new Error('--model is required unless --list-cases is used.');
  if (!ctx.options.selectorDiscoveryService)
    throw new Error('Selector discovery service is not available in this CLI context.');
}

async function loadProviderDocument(options: BundleEvalOptions): Promise<ProviderDocument> {
  const source = JSON.parse(await fs.readFile(options.providerJson, 'utf-8'));
  const document = validateProviderDocument(source);
  assertModelExists(document, options.model);
  return document;
}

function parseRepeat(value?: string): number | undefined {
  const repeat = value ? Number.parseInt(value, 10) : undefined;
  if (repeat !== undefined && (!Number.isInteger(repeat) || repeat <= 0))
    throw new Error('--repeat must be a positive integer.');
  return repeat;
}

function renderDryRun(
  ctx: CliCommandContext, cases: EvalCases, options: BundleEvalOptions, repeatOverride?: number
): void {
  renderBundleEvalDryRun(ctx.ui, cases, {
    repeatOverride,
    minPositivePasses: options.minPositivePasses,
    maxPositiveFailures: options.maxPositiveFailures,
    includeDisabled: options.includeDisabled,
    liveNegative: options.liveNegative,
  });
}

async function runEvalCases(
  ctx: CliCommandContext, cases: EvalCases, options: BundleEvalOptions,
  providerDocument: ProviderDocument, repeatOverride?: number
): Promise<SelectorDiscoveryEvalRunResult[]> {
  const results: SelectorDiscoveryEvalRunResult[] = [];
  for (const evalCase of cases) {
    const runs = repeatOverride ?? evalCase.defaultRuns;
    for (let runIndex = 1; runIndex <= runs; runIndex++)
      results.push(await runEvalCase(ctx, evalCase, runIndex, runs, options, providerDocument));
  }
  return results;
}

async function runEvalCase(
  ctx: CliCommandContext, evalCase: EvalCases[number], runIndex: number, runs: number,
  options: BundleEvalOptions, providerDocument: ProviderDocument
): Promise<SelectorDiscoveryEvalRunResult> {
  ctx.ui.renderInfo(`Running eval case ${evalCase.id} (${runIndex}/${runs})`);
  try {
    const gate = await runPositiveEval(ctx, evalCase, options, providerDocument);
    renderBundleEvalResult(ctx.ui, gate);
    return { case: evalCase, runIndex, ...gate };
  } catch (error) {
    if (evalCase.type !== 'negative') throw error;
    return createNegativeEvalResult(ctx, evalCase, runIndex, error);
  }
}

async function runPositiveEval(
  ctx: CliCommandContext, evalCase: EvalCases[number], options: BundleEvalOptions,
  providerDocument: ProviderDocument
) {
  const job = await ctx.options.selectorDiscoveryService!.create({
    url: evalCase.url, aoBaseUrl: options.aoUrl, providerDocument,
    model: options.model, forceDiscovery: true,
  });
  ctx.ui.renderSuccess(`Bundle evaluation job ${job.id} created with status ${job.status}`);
  ctx.ui.renderStatus('url', job.normalizedUrl);
  ctx.ui.renderStatus('model', options.model);
  const completed = await waitForSelectorDiscoveryJob(ctx, job.id,
    Number(options.timeoutMinutes ?? '35') * 60_000, Number(options.pollIntervalMs ?? '5000'));
  return runSelectorDiscoveryEvalGate(ctx, completed.id, evalCase);
}

function createNegativeEvalResult(
  ctx: CliCommandContext, evalCase: EvalCases[number], runIndex: number, error: unknown
): SelectorDiscoveryEvalRunResult {
  const rejection = error instanceof Error ? error.message : String(error);
  ctx.ui.renderSuccess(`Negative eval case rejected before discovery: ${rejection}`);
  return { case: evalCase, runIndex, passed: true, job: undefined, reasons: [], rejection };
}

async function finishBundleEval(
  ctx: CliCommandContext, cases: EvalCases, results: SelectorDiscoveryEvalRunResult[],
  options: BundleEvalOptions, providerDocument: ProviderDocument
): Promise<void> {
  const policy = evaluateBundleEvalPolicy(results, {
    minPositivePasses: options.minPositivePasses,
    maxPositiveFailures: options.maxPositiveFailures,
  });
  const path = await writeSelectorDiscoveryBundleEvalSuiteArtifact(results, {
    providerDocument, model: options.model, aoBaseUrl: options.aoUrl, policy,
  });
  renderEvalSummary(ctx, cases.length, results, path, policy);
  if (!policy.passed) process.exit(1);
}

function renderEvalSummary(
  ctx: CliCommandContext, caseCount: number, results: SelectorDiscoveryEvalRunResult[],
  path: string, policy: ReturnType<typeof evaluateBundleEvalPolicy>
): void {
  ctx.ui.renderStatus('artifact path', path);
  ctx.ui.renderStatus('eval cases', String(caseCount));
  ctx.ui.renderStatus('eval runs', String(results.length));
  ctx.ui.renderStatus('eval failures', String(results.filter((result) => !result.passed).length));
  renderBundleEvalPolicy(ctx.ui, policy);
}

async function handleBundleFreeze(ctx: CliCommandContext, options: BundleFreezeOptions): Promise<void> {
  try { await runBundleFreeze(ctx, options); }
  catch (error) {
    logger.error({ error: formatError(error) }, 'Failed to freeze selector discovery bundle');
    if (error instanceof BundleEvalPolicyError) renderBundleFreezePolicyError(ctx.ui, error);
    else ctx.ui.renderError(formatError(error));
    process.exit(1);
  }
}

async function runBundleFreeze(ctx: CliCommandContext, options: BundleFreezeOptions): Promise<void> {
  const summary = await readPassingBundleEvalSummary(options.evalBundleHash);
  const result = await new SelectorDiscoveryBundleManager().freezeDraft({
    version: options.version,
    evalBundleHash: options.evalBundleHash,
  });
  ctx.ui.renderSuccess(`Selector-discovery AO bundle frozen as ${result.release}.`);
  ctx.ui.renderStatus('release root', result.releaseRoot);
  ctx.ui.renderStatus('sha256', result.sha256);
  ctx.ui.renderStatus('active.json', result.activePath);
  ctx.ui.renderStatus('eval job', String(summary.job?.id ?? '-'));
}
