import type { ChallengeDecision, ChallengeStrategyValidation } from './types';

export type ChallengeDiscoveryStatus =
  | 'queued'
  | 'ready'
  | 'challenge_detected'
  | 'challenge_required'
  | 'challenge_auto_attempt_failed'
  | 'browser_open'
  | 'external_browser_opening'
  | 'external_browser_open'
  | 'access_blocked'
  | 'strategy_awaiting_review'
  | 'strategy_promoted'
  | 'failed';

export interface ChallengeDiscoveryJob {
  id: string;
  url: string;
  normalizedUrl: string;
  hostname: string;
  status: ChallengeDiscoveryStatus;
  createdAt: string;
  updatedAt: string;
  diagnosisMarkdown?: string;
  evidenceMarkdown?: string;
  candidateSource?: string;
  strategyId?: string;
  validation?: ChallengeStrategyValidation;
  decision?: ChallengeDecision;
  error?: string;
  browserProfileDir?: string;
  browserCdpUrl?: string;
  browserExecutablePath?: string;
  browserProfileId?: string;
  browserProfileDirectory?: string;
}
