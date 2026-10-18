export type {
  ChallengeAttemptResult,
  ChallengeContext,
  ChallengeDecision,
  ChallengeStatus,
  ChallengeStrategyModule,
  ChallengeStrategyValidation,
} from './types';
export {
  ChallengeStrategyRegistry,
  getGlobalChallengeStrategyRegistry,
  resetGlobalChallengeStrategyRegistryForTests,
} from './registry';
export { defaultChallengeStrategy } from './default-strategy';
export { loadChallengeStrategyFromSource } from './strategy-loader';
export { validateChallengeStrategyModule, validateChallengeStrategySource } from './strategy-validator';
export { ChallengeDiscoveryService } from './discovery-service';
export type { ChallengeDiscoveryJob, ChallengeDiscoveryStatus } from './discovery-types';
