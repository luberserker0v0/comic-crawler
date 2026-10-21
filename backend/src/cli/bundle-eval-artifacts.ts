import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { SelectorDiscoveryBundleManager } from '../selector-discovery';
import { fingerprintProviderDocument } from '../selector-discovery/provider-config';
import type { SelectorDiscoveryEvalCase, SelectorDiscoveryEvalPolicyResult } from '../selector-discovery/eval-suite';
import type { ProviderDocument, SelectorDiscoveryJob } from '../selector-discovery/types';
import { resolveRuntimeConfig } from '../config/runtime';
import type { CliCommandContext } from './command-context';
import { safePathSegment, sleep } from './command-utils';
import { BundleEvalPolicyError } from './bundle-eval-types';
import type { SelectorDiscoveryEvalRunResult } from './bundle-eval-types';
import { evaluateBundleEvalPolicy } from './bundle-eval-report';

export async function waitForSelectorDiscoveryJob(
  ctx: CliCommandContext,
  id: string,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<SelectorDiscoveryJob> {
  const service = requireDiscoveryService(ctx);
  validatePolling(timeoutMs, pollIntervalMs);
  const startedAt = Date.now();
  let lastStatus = '';
  while (Date.now() - startedAt < timeoutMs) {
    const job = await service.get(id);
    if (!job) throw new Error(`Discovery job "${id}" was not found.`);
    lastStatus = renderJobStatus(ctx, job, lastStatus);
    if (isTerminalDiscoveryJob(job)) return job;
    await sleep(Math.max(250, pollIntervalMs));
  }
  throw new Error(`Timed out waiting for selector discovery job "${id}".`);
}

function renderJobStatus(ctx: CliCommandContext, job: SelectorDiscoveryJob, previous: string): string {
  const status = `${job.status}${job.phase ? `/${job.phase}` : ''}`;
  if (status !== previous) ctx.ui.renderStatus('bundle-eval status', status);
  return status;
}

function isTerminalDiscoveryJob(job: SelectorDiscoveryJob): boolean {
  return job.status === 'awaiting_review' || job.status === 'invalid' || job.status === 'failed';
}

function requireDiscoveryService(ctx: CliCommandContext) {
  if (!ctx.options.selectorDiscoveryService)
    throw new Error('Selector discovery service is not available in this CLI context.');
  return ctx.options.selectorDiscoveryService;
}

function validatePolling(timeoutMs: number, intervalMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('--timeout-minutes must be a positive number.');
  if (!Number.isFinite(intervalMs) || intervalMs <= 0)
    throw new Error('--poll-interval-ms must be a positive number.');
}

export async function runSelectorDiscoveryEvalGate(
  ctx: CliCommandContext,
  id: string,
  evalCase?: SelectorDiscoveryEvalCase
): Promise<{ passed: boolean; job: SelectorDiscoveryJob; reasons: string[] }> {
  const job = await requireDiscoveryService(ctx).get(id);
  if (!job) throw new Error(`Discovery job "${id}" was not found.`);
  if (evalCase?.type === 'negative') {
    const reasons = job.status === 'awaiting_review'
      ? ['Negative eval case unexpectedly produced a reviewable implementation draft.'] : [];
    return { passed: reasons.length === 0, job, reasons };
  }
  if (job.status !== 'awaiting_review')
    return { passed: false, job, reasons: [`Discovery job ended with status "${job.status}".`] };
  const reasons = reviewGateReasons(job);
  return { passed: reasons.length === 0, job, reasons };
}

function reviewGateReasons(job: SelectorDiscoveryJob): string[] {
  const reasons: string[] = [];
  if (!job.adapterImplementationTs?.trim()) reasons.push('Adapter implementation draft is missing.');
  if (!job.implementationValidation?.valid) reasons.push(
    `Adapter implementation validation failed: ${(job.implementationValidation?.errors ?? []).join('; ') || 'unknown error'}`);
  if (!job.reviewNotesMarkdown?.trim()) reasons.push('Adapter implementation review notes are missing.');
  return reasons;
}

export async function writeSelectorDiscoveryBundleEvalArtifact(
  result: { passed: boolean; job?: SelectorDiscoveryJob; reasons: string[]; rejection?: string },
  input: { providerDocument: ProviderDocument; model: string; aoBaseUrl: string }
): Promise<string> {
  const results = [{ case: undefined, runIndex: 1, ...result }];
  return writeSelectorDiscoveryBundleEvalSuiteArtifact(results, {
    ...input,
    policy: evaluateBundleEvalPolicy(results, {}),
  });
}

export async function writeSelectorDiscoveryBundleEvalSuiteArtifact(
  results: SelectorDiscoveryEvalRunResult[],
  input: {
    providerDocument: ProviderDocument;
    model: string;
    aoBaseUrl: string;
    policy: SelectorDiscoveryEvalPolicyResult;
  }
): Promise<string> {
  const bundleManager = new SelectorDiscoveryBundleManager();
  const bundle = await bundleManager.loadActive(input.providerDocument, input.model);
  const workspaceRoot = resolveRuntimeConfig().agentWorkspacePath;
  const artifactDir = join(workspaceRoot, 'bundle-evaluations', bundle.hash);
  await fs.mkdir(artifactDir, { recursive: true });
  const summary = createSuiteSummary(results, input, bundle);
  await fs.writeFile(join(artifactDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
  for (const result of results) await writeEvalRun(artifactDir, result);
  await writeLatestEvalFiles(artifactDir, findLastJob(results));
  return artifactDir;
}

function createSuiteSummary(results: SelectorDiscoveryEvalRunResult[], input: {
  providerDocument: ProviderDocument; model: string; aoBaseUrl: string;
  policy: SelectorDiscoveryEvalPolicyResult }, bundle: Awaited<ReturnType<SelectorDiscoveryBundleManager['loadActive']>>) {
  const reasons = results.flatMap((result) => result.reasons.map((reason) =>
    `${result.case?.id ?? 'default'} run ${result.runIndex}: ${reason}`));
  return { schemaVersion: 1, kind: 'selector-discovery-bundle-evaluation',
    passed: input.policy.passed, reasons: [...reasons, ...input.policy.reasons.map((reason) => `policy: ${reason}`)],
    policy: input.policy, createdAt: new Date().toISOString(),
    bundle: { hash: bundle.hash, root: bundle.root }, runtime: { aoBaseUrl: input.aoBaseUrl,
      model: input.model, providerFingerprint: fingerprintProviderDocument(input.providerDocument) },
    cases: results.map(createEvalCaseSummary), job: createEvalJobSummary(findLastJob(results)) };
}

async function writeEvalRun(root: string, result: SelectorDiscoveryEvalRunResult): Promise<void> {
  const runDir = join(root, 'cases', safePathSegment(result.case?.id ?? 'default'), `run-${result.runIndex}`);
  await fs.mkdir(runDir, { recursive: true });
  await Promise.all([fs.writeFile(join(runDir, 'summary.json'),
    `${JSON.stringify(createEvalCaseSummary(result), null, 2)}\n`, 'utf-8'),
  fs.writeFile(join(runDir, 'phase1-output.md'), result.job?.phase1Markdown ?? '', 'utf-8'),
  fs.writeFile(join(runDir, 'adapter-implementation.ts'), result.job?.adapterImplementationTs ?? '', 'utf-8'),
  fs.writeFile(join(runDir, 'review-notes.md'), result.job?.reviewNotesMarkdown ?? '', 'utf-8'),
  fs.writeFile(join(runDir, 'implementation-validation.json'),
    `${JSON.stringify(result.job?.implementationValidation ?? null, null, 2)}\n`, 'utf-8')]);
}

async function writeLatestEvalFiles(root: string, job?: SelectorDiscoveryJob): Promise<void> {
  await Promise.all([fs.writeFile(join(root, 'phase1-output.md'), job?.phase1Markdown ?? '', 'utf-8'),
    fs.writeFile(join(root, 'adapter-implementation.ts'), job?.adapterImplementationTs ?? '', 'utf-8'),
    fs.writeFile(join(root, 'review-notes.md'), job?.reviewNotesMarkdown ?? '', 'utf-8'),
    fs.writeFile(join(root, 'implementation-validation.json'),
      `${JSON.stringify(job?.implementationValidation ?? null, null, 2)}\n`, 'utf-8')]);
}

export function createEvalCaseSummary(result: SelectorDiscoveryEvalRunResult): Record<string, unknown> {
  return {
    case: result.case ? {
      id: result.case.id,
      type: result.case.type,
      enabled: result.case.enabled,
      live: result.case.live,
      url: result.case.url,
      expectations: result.case.expectations,
    } : undefined,
    runIndex: result.runIndex,
    passed: result.passed,
    reasons: result.reasons,
    rejection: result.rejection,
    job: createEvalJobSummary(result.job),
  };
}

export function createEvalJobSummary(job?: SelectorDiscoveryJob): Record<string, unknown> | undefined {
  if (!job) return undefined;
  return {
    id: job.id,
    url: job.normalizedUrl,
    hostname: job.hostname,
    status: job.status,
    phase: job.phase,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    implementationValidation: job.implementationValidation,
    error: job.error,
  };
}

export function findLastJob(results: SelectorDiscoveryEvalRunResult[]): SelectorDiscoveryJob | undefined {
  for (let index = results.length - 1; index >= 0; index--) {
    const job = results[index]?.job;
    if (job) return job;
  }
  return undefined;
}

export async function readPassingBundleEvalSummary(evalBundleHash: string): Promise<any> {
  if (!/^[a-f0-9]{64}$/i.test(evalBundleHash)) throw new Error(
    '--eval-bundle-hash must be a 64-character SHA-256 hex string.');
  const workspaceRoot = resolveRuntimeConfig().agentWorkspacePath;
  const summaryPath = join(workspaceRoot, 'bundle-evaluations', evalBundleHash, 'summary.json');
  const summary = await readEvalSummary(summaryPath);
  validatePassingSummary(summary, evalBundleHash, summaryPath);
  return summary;
}

async function readEvalSummary(path: string): Promise<any> {
  try { return JSON.parse(await fs.readFile(path, 'utf-8')); }
  catch { throw new Error(`Bundle evaluation summary was not found at ${path}.`); }
}

function validatePassingSummary(summary: any, hash: string, path: string): void {
  if (summary?.kind !== 'selector-discovery-bundle-evaluation')
    throw new Error(`Bundle evaluation summary at ${path} has an unexpected kind.`);
  if (summary?.bundle?.hash !== hash) throw new Error(`Bundle evaluation summary hash does not match ${hash}.`);
  if (summary?.passed !== true) throw new BundleEvalPolicyError(
    `Bundle evaluation ${hash} has not passed.`, path, summary);
  if (summary?.policy?.passed !== true) throw new BundleEvalPolicyError(
    `Bundle evaluation ${hash} did not pass release policy.`, path, summary);
}
