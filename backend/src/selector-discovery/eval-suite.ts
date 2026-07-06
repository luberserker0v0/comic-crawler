import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export type SelectorDiscoveryEvalCaseType = 'positive' | 'negative';

export interface SelectorDiscoveryEvalCase {
  id: string;
  type: SelectorDiscoveryEvalCaseType;
  enabled: boolean;
  live: boolean;
  description?: string;
  url: string;
  oracleAdapterId?: string;
  defaultRuns: number;
  expectations?: {
    metadata?: boolean;
    chapters?: boolean;
    images?: boolean;
    oracleComparison?: boolean;
  };
}

export interface SelectorDiscoveryEvalPolicyInput {
  runs: Array<{
    caseId?: string;
    type?: SelectorDiscoveryEvalCaseType;
    passed: boolean;
  }>;
  minPositivePasses?: number;
  maxPositiveFailures?: number;
}

export interface SelectorDiscoveryEvalPolicyResult {
  passed: boolean;
  reasons: string[];
  positive: {
    total: number;
    passed: number;
    failed: number;
    minPasses: number;
    maxFailures: number;
  };
  negative: {
    total: number;
    passed: number;
    failed: number;
    requiresAllPass: boolean;
  };
}

export async function loadSelectorDiscoveryEvalCases(input: {
  bundleRoot?: string;
  caseId?: string;
  includeDisabled?: boolean;
  includeLiveNegative?: boolean;
} = {}): Promise<SelectorDiscoveryEvalCase[]> {
  const root = input.bundleRoot ?? process.env.AO_BUNDLE_PATH ?? join(process.cwd(), 'agent/ao/selector-discovery');
  const casesRoot = join(root, 'eval', 'cases');
  const entries = await fs.readdir(casesRoot, { withFileTypes: true });
  const cases = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const raw = JSON.parse(await fs.readFile(join(casesRoot, entry.name, 'case.json'), 'utf-8')) as unknown;
      return normalizeEvalCase(raw, entry.name);
    }));

  return cases
    .filter((testCase) => input.includeDisabled || testCase.enabled || (input.includeLiveNegative && testCase.type === 'negative' && testCase.live))
    .filter((testCase) => !input.caseId || testCase.id === input.caseId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function evaluateSelectorDiscoveryEvalPolicy(input: SelectorDiscoveryEvalPolicyInput): SelectorDiscoveryEvalPolicyResult {
  const positiveRuns = input.runs.filter((run) => (run.type ?? 'positive') === 'positive');
  const negativeRuns = input.runs.filter((run) => run.type === 'negative');
  const positivePassed = positiveRuns.filter((run) => run.passed).length;
  const negativePassed = negativeRuns.filter((run) => run.passed).length;
  const positiveFailed = positiveRuns.length - positivePassed;
  const negativeFailed = negativeRuns.length - negativePassed;
  const minPositivePasses = input.minPositivePasses ?? positiveRuns.length;
  const maxPositiveFailures = input.maxPositiveFailures ?? 0;
  const reasons: string[] = [];

  if (positiveRuns.length === 0) {
    reasons.push('No positive eval runs were executed.');
  }
  if (positivePassed < minPositivePasses) {
    reasons.push(`Positive eval passes ${positivePassed}/${positiveRuns.length} did not meet minimum ${minPositivePasses}.`);
  }
  if (positiveFailed > maxPositiveFailures) {
    reasons.push(`Positive eval failures ${positiveFailed}/${positiveRuns.length} exceeded maximum ${maxPositiveFailures}.`);
  }
  if (negativeFailed > 0) {
    reasons.push(`Negative eval failures ${negativeFailed}/${negativeRuns.length}; negative cases must pass 100%.`);
  }

  return {
    passed: reasons.length === 0,
    reasons,
    positive: {
      total: positiveRuns.length,
      passed: positivePassed,
      failed: positiveFailed,
      minPasses: minPositivePasses,
      maxFailures: maxPositiveFailures,
    },
    negative: {
      total: negativeRuns.length,
      passed: negativePassed,
      failed: negativeFailed,
      requiresAllPass: true,
    },
  };
}


function normalizeEvalCase(value: unknown, fallbackId: string): SelectorDiscoveryEvalCase {
  if (!value || typeof value !== 'object') {
    throw new Error(`Eval case "${fallbackId}" must be a JSON object.`);
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallbackId;
  const type = record.type === 'negative' ? 'negative' : 'positive';
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
  const live = record.live === true;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!url) {
    throw new Error(`Eval case "${id}" is missing url.`);
  }

  return {
    id,
    type,
    enabled,
    live,
    description: typeof record.description === 'string' ? record.description : undefined,
    url,
    oracleAdapterId: typeof record.oracleAdapterId === 'string' ? record.oracleAdapterId : undefined,
    defaultRuns: typeof record.defaultRuns === 'number' && record.defaultRuns > 0 ? Math.floor(record.defaultRuns) : 1,
    expectations: record.expectations && typeof record.expectations === 'object'
      ? record.expectations as SelectorDiscoveryEvalCase['expectations']
      : undefined,
  };
}
