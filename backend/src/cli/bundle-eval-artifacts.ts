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
  if (!ctx.options.selectorDiscoveryService) {
    throw new Error('Selector discovery service is not available in this CLI context.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout-minutes must be a positive number.');
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error('--poll-interval-ms must be a positive number.');
  }

  const startedAt = Date.now();
  let lastStatus = '';
  while (Date.now() - startedAt < timeoutMs) {
    const job = await ctx.options.selectorDiscoveryService.get(id);
    if (!job) {
      throw new Error(`Discovery job "${id}" was not found.`);
    }
    const statusText = `${job.status}${job.phase ? `/${job.phase}` : ''}`;
    if (statusText !== lastStatus) {
      ctx.ui.renderStatus('bundle-eval status', statusText);
      lastStatus = statusText;
    }
    if (job.status === 'awaiting_review' || job.status === 'invalid' || job.status === 'failed') {
      return job;
    }
    await sleep(Math.max(250, pollIntervalMs));
  }

  throw new Error(`Timed out waiting for selector discovery job "${id}".`);
}

export async function runSelectorDiscoveryEvalGate(
  ctx: CliCommandContext,
  id: string,
  evalCase?: SelectorDiscoveryEvalCase
): Promise<{ passed: boolean; job: SelectorDiscoveryJob; reasons: string[] }> {
  if (!ctx.options.selectorDiscoveryService) {
    throw new Error('Selector discovery service is not available in this CLI context.');
  }

  let job = await ctx.options.selectorDiscoveryService.get(id);
  if (!job) throw new Error(`Discovery job "${id}" was not found.`);

  if (job.status === 'invalid' && job.candidateMarkdown) {
    job = await ctx.options.selectorDiscoveryService.revalidate(id);
  }
  if (evalCase?.type === 'negative') {
    if (job.status === 'awaiting_review') {
      return { passed: false, job, reasons: ['Negative eval case unexpectedly produced a reviewable implementation draft.'] };
    }
    return { passed: true, job, reasons: [] };
  }

  if (job.status !== 'awaiting_review') {
    return { passed: false, job, reasons: [`Discovery job ended with status "${job.status}".`] };
  }

  if (job.adapterImplementationTs) {
    const reasons: string[] = [];
    if (!job.implementationValidation?.valid) {
      reasons.push(`Adapter implementation validation failed: ${(job.implementationValidation?.errors ?? []).join('; ') || 'unknown error'}`);
    }
    if (!job.reviewNotesMarkdown?.trim()) {
      reasons.push('Adapter implementation review notes are missing.');
    }
    return { passed: reasons.length === 0, job, reasons };
  }

  job = await ctx.options.selectorDiscoveryService.validateCandidate(id);
  job = await ctx.options.selectorDiscoveryService.shadowPromote(id);

  const reasons: string[] = [];
  if (!job.extractionValidation?.valid) {
    reasons.push(`Candidate extraction validation failed: ${(job.extractionValidation?.errors ?? []).join('; ') || 'unknown error'}`);
  }
  if (!job.oracleComparison) {
    reasons.push('No existing adapter oracle comparison was available.');
  } else {
    if (evalCase?.oracleAdapterId && job.oracleComparison.adapterId !== evalCase.oracleAdapterId) {
      reasons.push(`Oracle adapter was "${job.oracleComparison.adapterId}", expected "${evalCase.oracleAdapterId}".`);
    }
    if (!job.oracleComparison.titleMatched) reasons.push('Candidate title differs from existing adapter oracle title.');
    if (job.oracleComparison.chapterCountDelta !== 0) reasons.push(`Chapter count delta is ${job.oracleComparison.chapterCountDelta}.`);
    if ((job.oracleComparison.imageCountDelta ?? 0) !== 0) reasons.push(`Image count delta is ${job.oracleComparison.imageCountDelta}.`);
    for (const warning of job.oracleComparison.warnings) reasons.push(warning);
  }

  return { passed: reasons.length === 0, job, reasons };
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
  const reasons = results.flatMap((result) =>
    result.reasons.map((reason) => `${result.case?.id ?? 'default'} run ${result.runIndex}: ${reason}`)
  );
  const policyReasons = input.policy.reasons.map((reason) => `policy: ${reason}`);

  const summary = {
    schemaVersion: 1,
    kind: 'selector-discovery-bundle-evaluation',
    passed: input.policy.passed,
    reasons: [...reasons, ...policyReasons],
    policy: input.policy,
    createdAt: new Date().toISOString(),
    bundle: {
      hash: bundle.hash,
      root: bundle.root,
    },
    runtime: {
      aoBaseUrl: input.aoBaseUrl,
      model: input.model,
      providerFingerprint: fingerprintProviderDocument(input.providerDocument),
    },
    cases: results.map((result) => createEvalCaseSummary(result)),
    job: createEvalJobSummary(findLastJob(results)),
  };

  await fs.writeFile(join(artifactDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

  for (const result of results) {
    const caseId = result.case?.id ?? 'default';
    const runDir = join(artifactDir, 'cases', safePathSegment(caseId), `run-${result.runIndex}`);
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(join(runDir, 'summary.json'), `${JSON.stringify(createEvalCaseSummary(result), null, 2)}\n`, 'utf-8');
    await fs.writeFile(join(runDir, 'phase1-output.md'), result.job?.phase1Markdown ?? '', 'utf-8');
    await fs.writeFile(join(runDir, 'adapter-implementation.ts'), result.job?.adapterImplementationTs ?? '', 'utf-8');
    await fs.writeFile(join(runDir, 'review-notes.md'), result.job?.reviewNotesMarkdown ?? '', 'utf-8');
    await fs.writeFile(join(runDir, 'legacy-candidate-output.md'), result.job?.candidateMarkdown ?? '', 'utf-8');
    await fs.writeFile(join(runDir, 'parsed-candidate.json'), `${JSON.stringify(result.job?.parsedCandidate ?? null, null, 2)}\n`, 'utf-8');
    await fs.writeFile(join(runDir, 'implementation-validation.json'), `${JSON.stringify(result.job?.implementationValidation ?? null, null, 2)}\n`, 'utf-8');
    await fs.writeFile(join(runDir, 'oracle-comparison.json'), `${JSON.stringify(result.job?.oracleComparison ?? null, null, 2)}\n`, 'utf-8');
  }

  const last = findLastJob(results);
  await fs.writeFile(join(artifactDir, 'phase1-output.md'), last?.phase1Markdown ?? '', 'utf-8');
  await fs.writeFile(join(artifactDir, 'adapter-implementation.ts'), last?.adapterImplementationTs ?? '', 'utf-8');
  await fs.writeFile(join(artifactDir, 'review-notes.md'), last?.reviewNotesMarkdown ?? '', 'utf-8');
  await fs.writeFile(join(artifactDir, 'legacy-candidate-output.md'), last?.candidateMarkdown ?? '', 'utf-8');
  await fs.writeFile(join(artifactDir, 'parsed-candidate.json'), `${JSON.stringify(last?.parsedCandidate ?? null, null, 2)}\n`, 'utf-8');
  await fs.writeFile(join(artifactDir, 'implementation-validation.json'), `${JSON.stringify(last?.implementationValidation ?? null, null, 2)}\n`, 'utf-8');
  await fs.writeFile(join(artifactDir, 'oracle-comparison.json'), `${JSON.stringify(last?.oracleComparison ?? null, null, 2)}\n`, 'utf-8');

  return artifactDir;
}

export function createEvalCaseSummary(result: SelectorDiscoveryEvalRunResult): Record<string, unknown> {
  return {
    case: result.case ? {
      id: result.case.id,
      type: result.case.type,
      enabled: result.case.enabled,
      live: result.case.live,
      url: result.case.url,
      oracleAdapterId: result.case.oracleAdapterId,
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
    validation: job.validation,
    implementationValidation: job.implementationValidation,
    extractionValidation: job.extractionValidation,
    shadowPromotion: job.shadowPromotion,
    oracleComparison: job.oracleComparison,
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
  if (!/^[a-f0-9]{64}$/i.test(evalBundleHash)) {
    throw new Error('--eval-bundle-hash must be a 64-character SHA-256 hex string.');
  }

  const workspaceRoot = resolveRuntimeConfig().agentWorkspacePath;
  const summaryPath = join(workspaceRoot, 'bundle-evaluations', evalBundleHash, 'summary.json');
  let summary: any;
  try {
    summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
  } catch {
    throw new Error(`Bundle evaluation summary was not found at ${summaryPath}.`);
  }

  if (summary?.kind !== 'selector-discovery-bundle-evaluation') {
    throw new Error(`Bundle evaluation summary at ${summaryPath} has an unexpected kind.`);
  }
  if (summary?.bundle?.hash !== evalBundleHash) {
    throw new Error(`Bundle evaluation summary hash does not match ${evalBundleHash}.`);
  }
  if (summary?.passed !== true) {
    throw new BundleEvalPolicyError(`Bundle evaluation ${evalBundleHash} has not passed.`, summaryPath, summary);
  }
  if (summary?.policy?.passed !== true) {
    throw new BundleEvalPolicyError(`Bundle evaluation ${evalBundleHash} did not pass release policy.`, summaryPath, summary);
  }

  return summary;
}
