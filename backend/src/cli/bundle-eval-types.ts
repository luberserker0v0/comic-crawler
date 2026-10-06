import type { SelectorDiscoveryEvalCase } from '../selector-discovery/eval-suite';
import type { SelectorDiscoveryJob } from '../selector-discovery/types';

export class BundleEvalPolicyError extends Error {
  constructor(
    message: string,
    readonly summaryPath: string,
    readonly summary: any
  ) {
    super(message);
    this.name = 'BundleEvalPolicyError';
  }
}

export interface SelectorDiscoveryEvalRunResult {
  case?: SelectorDiscoveryEvalCase;
  runIndex: number;
  passed: boolean;
  job?: SelectorDiscoveryJob;
  reasons: string[];
  rejection?: string;
}
