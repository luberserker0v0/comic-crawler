import {
  evaluateSelectorDiscoveryEvalPolicy,
  type SelectorDiscoveryEvalCase,
  type SelectorDiscoveryEvalPolicyResult,
} from '../selector-discovery/eval-suite';
import type { TerminalUI } from './ui';
import { parseNonNegativeInteger } from './command-utils';
import type { BundleEvalPolicyError, SelectorDiscoveryEvalRunResult } from './bundle-eval-types';

export function renderBundleEvalResult(
  ui: TerminalUI,
  result: { passed: boolean; job?: SelectorDiscoveryEvalRunResult['job']; reasons: string[]; rejection?: string }
): void {
  ui.renderStatus('bundle-eval job', result.job?.id ?? '-');
  ui.renderStatus('candidate status', result.job?.status ?? 'rejected');
  ui.renderStatus('implementation validation', result.job?.implementationValidation?.valid ? 'passed' : 'failed');
  if (result.rejection) {
    ui.renderStatus('rejection', result.rejection);
  }

  if (result.passed) {
    ui.renderSuccess('Bundle evaluation passed.');
    return;
  }

  ui.renderError('Bundle evaluation failed.');
  for (const reason of result.reasons) {
    ui.renderWarning(reason);
  }
}

export function renderBundleEvalDryRun(
  ui: TerminalUI,
  cases: SelectorDiscoveryEvalCase[],
  options: {
    repeatOverride?: number;
    minPositivePasses?: string;
    maxPositiveFailures?: string;
    includeDisabled?: boolean;
    liveNegative?: boolean;
  }
): void {
  const plannedRuns = createPlannedRuns(cases, options.repeatOverride);
  const policy = evaluateSelectorDiscoveryEvalPolicy({ ...parsePolicyOptions(options), runs: plannedRuns });
  ui.renderSuccess('Bundle evaluation dry run. No AO discovery jobs were created.');
  renderDryRunSummary(ui, cases.length, plannedRuns.length, policy, options);
  ui.renderTable(['case', 'type', 'enabled', 'live', 'runs', 'url'], caseRows(cases, options.repeatOverride));
}

function createPlannedRuns(cases: SelectorDiscoveryEvalCase[], repeat?: number) {
  return cases.flatMap((testCase) => Array.from({ length: repeat ?? testCase.defaultRuns }, () => ({
    caseId: testCase.id, type: testCase.type, passed: true,
  })));
}

function parsePolicyOptions(options: { minPositivePasses?: string; maxPositiveFailures?: string }) {
  return {
    minPositivePasses: options.minPositivePasses === undefined ? undefined
      : parseNonNegativeInteger(options.minPositivePasses, '--min-positive-passes'),
    maxPositiveFailures: options.maxPositiveFailures === undefined ? undefined
      : parseNonNegativeInteger(options.maxPositiveFailures, '--max-positive-failures'),
  };
}

function renderDryRunSummary(ui: TerminalUI, caseCount: number, runCount: number,
  policy: SelectorDiscoveryEvalPolicyResult, options: { includeDisabled?: boolean; liveNegative?: boolean }): void {
  ui.renderStatus('cases', String(caseCount));
  ui.renderStatus('planned runs', String(runCount));
  ui.renderStatus('include disabled', String(Boolean(options.includeDisabled)));
  ui.renderStatus('include live negative', String(Boolean(options.liveNegative)));
  ui.renderStatus('policy positive', `${policy.positive.total} planned, min ${policy.positive.minPasses}, max failures ${policy.positive.maxFailures}`);
  ui.renderStatus('policy negative', `${policy.negative.total} planned, requires 100%`);
}

function caseRows(cases: SelectorDiscoveryEvalCase[], repeat?: number): string[][] {
  return cases.map((testCase) => [testCase.id, testCase.type, testCase.enabled ? 'yes' : 'no',
    testCase.live ? 'yes' : 'no', String(repeat ?? testCase.defaultRuns), testCase.url]);
}

export function renderBundleEvalCaseInventory(
  ui: TerminalUI,
  cases: SelectorDiscoveryEvalCase[],
  options: { includeDisabled?: boolean; liveNegative?: boolean }
): void {
  const positive = cases.filter((testCase) => testCase.type === 'positive');
  const negative = cases.filter((testCase) => testCase.type === 'negative');
  const live = cases.filter((testCase) => testCase.live);
  const disabled = cases.filter((testCase) => !testCase.enabled);
  const plannedRuns = cases.reduce((total, testCase) => total + testCase.defaultRuns, 0);

  ui.renderSuccess('Selector-discovery eval case inventory.');
  renderInventorySummary(ui, { cases: cases.length, positive: positive.length, negative: negative.length,
    live: live.length, disabled: disabled.length, plannedRuns }, options);
  ui.renderTable(['case', 'type', 'enabled', 'live', 'defaultRuns', 'url'], caseRows(cases));
}

function renderInventorySummary(ui: TerminalUI,
  counts: { cases: number; positive: number; negative: number; live: number; disabled: number; plannedRuns: number },
  options: { includeDisabled?: boolean; liveNegative?: boolean }): void {
  ui.renderStatus('cases', String(counts.cases));
  ui.renderStatus('positive', String(counts.positive));
  ui.renderStatus('negative', String(counts.negative));
  ui.renderStatus('live', String(counts.live));
  ui.renderStatus('disabled included', String(counts.disabled));
  ui.renderStatus('default planned runs', String(counts.plannedRuns));
  ui.renderStatus('include disabled', String(Boolean(options.includeDisabled)));
  ui.renderStatus('include live negative', String(Boolean(options.liveNegative)));
}

export function evaluateBundleEvalPolicy(
  results: SelectorDiscoveryEvalRunResult[],
  options: { minPositivePasses?: string; maxPositiveFailures?: string }
): SelectorDiscoveryEvalPolicyResult {
  const minPositivePasses = options.minPositivePasses === undefined
    ? undefined
    : parseNonNegativeInteger(options.minPositivePasses, '--min-positive-passes');
  const maxPositiveFailures = options.maxPositiveFailures === undefined
    ? undefined
    : parseNonNegativeInteger(options.maxPositiveFailures, '--max-positive-failures');

  return evaluateSelectorDiscoveryEvalPolicy({
    minPositivePasses,
    maxPositiveFailures,
    runs: results.map((result) => ({
      caseId: result.case?.id,
      type: result.case?.type,
      passed: result.passed,
    })),
  });
}

export function renderBundleEvalPolicy(ui: TerminalUI, policy: SelectorDiscoveryEvalPolicyResult): void {
  ui.renderStatus('policy positive', `${policy.positive.passed}/${policy.positive.total} passed, min ${policy.positive.minPasses}, max failures ${policy.positive.maxFailures}`);
  ui.renderStatus('policy negative', `${policy.negative.passed}/${policy.negative.total} passed, requires 100%`);
  if (policy.passed) {
    ui.renderSuccess('Bundle evaluation release policy passed.');
    return;
  }

  ui.renderError('Bundle evaluation release policy failed.');
  for (const reason of policy.reasons) {
    ui.renderWarning(reason);
  }
}

export function renderBundleFreezePolicyError(ui: TerminalUI, error: BundleEvalPolicyError): void {
  ui.renderError(error.message);
  ui.renderStatus('summary path', error.summaryPath);
  const policy = error.summary?.policy;
  if (policy) {
    ui.renderStatus('policy positive', `${policy.positive?.passed ?? 0}/${policy.positive?.total ?? 0} passed, min ${policy.positive?.minPasses ?? '-'}`);
    ui.renderStatus('policy negative', `${policy.negative?.passed ?? 0}/${policy.negative?.total ?? 0} passed, requires 100%`);
    for (const reason of Array.isArray(policy.reasons) ? policy.reasons : []) {
      ui.renderWarning(`policy: ${reason}`);
    }
  }

  const failedRuns = summarizeFailedEvalRuns(error.summary);
  for (const failedRun of failedRuns.slice(0, 10)) {
    ui.renderWarning(failedRun);
  }
  if (failedRuns.length > 10) {
    ui.renderWarning(`...and ${failedRuns.length - 10} more failed runs.`);
  }
}

export function summarizeFailedEvalRuns(summary: any): string[] {
  const cases = Array.isArray(summary?.cases) ? summary.cases : [];
  return cases
    .filter((item: any) => item?.passed !== true)
    .map((item: any) => {
      const caseId = item?.case?.id ?? 'unknown-case';
      const runIndex = item?.runIndex ?? '?';
      const reasons = Array.isArray(item?.reasons) && item.reasons.length > 0
        ? item.reasons.join('; ')
        : item?.rejection
          ? `rejection: ${item.rejection}`
          : `job status: ${item?.job?.status ?? 'unknown'}`;
      return `${caseId} run ${runIndex}: ${reasons}`;
    });
}
