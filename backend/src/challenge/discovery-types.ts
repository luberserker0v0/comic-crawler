import type { ChallengeDecision, ChallengeStrategyValidation } from './types';
import type { BrowserTarget, ChallengeDiscoveryStatus } from '@comiccrawler/shared';

export type { ChallengeDiscoveryStatus } from '@comiccrawler/shared';

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
