import type { ChallengeDecision, ChallengeStrategyValidation } from './types';
import type { BrowserTarget } from '@comiccrawler/shared';

export type ChallengeDiscoveryStatus =
  | 'queued'
  | 'ready'
  | 'challenge_detected'
  | 'challenge_required'
  | 'challenge_auto_attempt_failed'
  | 'browser_open'
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
  browserSessionId?: string;
  ownerUserId?: string;
  browserTarget?: BrowserTarget;
  createdAt: string;
  updatedAt: string;
  diagnosisMarkdown?: string;
  evidenceMarkdown?: string;
  candidateSource?: string;
  strategyId?: string;
  validation?: ChallengeStrategyValidation;
  decision?: ChallengeDecision;
  error?: string;
}
