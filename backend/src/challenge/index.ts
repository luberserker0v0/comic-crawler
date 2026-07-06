export type {
  ChallengeAttemptResult,
  ChallengeContext,
  ChallengeDecision,
  ChallengeStatus,
  ChallengeStrategyModule,
  ChallengeStrategyValidation,
} from './types';
export { BrowserChallengeHandler } from './browser-challenge-handler';
export { getGlobalVerifiedBrowserSessionRegistry, VerifiedBrowserSessionRegistry } from './verified-browser-sessions';
export {
  ChallengeStrategyRegistry,
  getGlobalChallengeStrategyRegistry,
  resetGlobalChallengeStrategyRegistryForTests,
} from './registry';
export { PlaywrightChallengeContext } from './challenge-context';
export { defaultChallengeStrategy } from './default-strategy';
export { loadChallengeStrategyFromSource } from './strategy-loader';
export { validateChallengeStrategyModule, validateChallengeStrategySource } from './strategy-validator';
export { ChallengeDiscoveryService } from './discovery-service';
export type { ChallengeDiscoveryJob, ChallengeDiscoveryStatus } from './discovery-types';
