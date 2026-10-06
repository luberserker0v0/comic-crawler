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
  ui.renderStatus('extraction validation', result.job?.extractionValidation?.valid ? 'passed' : 'failed');
  if (result.rejection) {
    ui.renderStatus('rejection', result.rejection);
  }
  if (result.job?.oracleComparison) {
    ui.renderStatus('oracle adapter', `${result.job.oracleComparison.adapterName} (${result.job.oracleComparison.adapterId})`);
    ui.renderStatus('title matched', String(result.job.oracleComparison.titleMatched));
    ui.renderStatus('chapter count delta', String(result.job.oracleComparison.chapterCountDelta));
    ui.renderStatus('image count delta', String(result.job.oracleComparison.imageCountDelta ?? 'n/a'));
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
  const plannedRuns = cases.flatMap((testCase) =>
    Array.from({ length: options.repeatOverride ?? testCase.defaultRuns }, () => ({
      caseId: testCase.id,
      type: testCase.type,
      passed: true,
    }))
  );
  const policy = evaluateSelectorDiscoveryEvalPolicy({
    minPositivePasses: options.minPositivePasses === undefined
      ? undefined
      : parseNonNegativeInteger(options.minPositivePasses, '--min-positive-passes'),
    maxPositiveFailures: options.maxPositiveFailures === undefined
      ? undefined
      : parseNonNegativeInteger(options.maxPositiveFailures, '--max-positive-failures'),
    runs: plannedRuns,
  });

  ui.renderSuccess('Bundle evaluation dry run. No AO discovery jobs were created.');
  ui.renderStatus('cases', String(cases.length));
  ui.renderStatus('planned runs', String(plannedRuns.length));
  ui.renderStatus('include disabled', String(Boolean(options.includeDisabled)));
  ui.renderStatus('include live negative', String(Boolean(options.liveNegative)));
  ui.renderStatus('policy positive', `${policy.positive.total} planned, min ${policy.positive.minPasses}, max failures ${policy.positive.maxFailures}`);
  ui.renderStatus('policy negative', `${policy.negative.total} planned, requires 100%`);
  const rows = cases.map((testCase) => [
    testCase.id,
    testCase.type,
    testCase.enabled ? 'yes' : 'no',
    testCase.live ? 'yes' : 'no',
    String(options.repeatOverride ?? testCase.defaultRuns),
    testCase.url,
  ]);
  ui.renderTable(['case', 'type', 'enabled', 'live', 'runs', 'url'], rows);
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
  ui.renderStatus('cases', String(cases.length));
  ui.renderStatus('positive', String(positive.length));
  ui.renderStatus('negative', String(negative.length));
  ui.renderStatus('live', String(live.length));
  ui.renderStatus('disabled included', String(disabled.length));
  ui.renderStatus('default planned runs', String(plannedRuns));
  ui.renderStatus('include disabled', String(Boolean(options.includeDisabled)));
  ui.renderStatus('include live negative', String(Boolean(options.liveNegative)));
  ui.renderTable(
    ['case', 'type', 'enabled', 'live', 'defaultRuns', 'oracle', 'url'],
    cases.map((testCase) => [
      testCase.id,
      testCase.type,
      testCase.enabled ? 'yes' : 'no',
      testCase.live ? 'yes' : 'no',
      String(testCase.defaultRuns),
      testCase.oracleAdapterId ?? '-',
      testCase.url,
    ])
  );
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
