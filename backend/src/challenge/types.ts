export type ChallengeStatus = 'ready' | 'challenge_detected' | 'not_ready';

export interface ChallengeDecision {
  status: ChallengeStatus;
  reason?: string;
  challengeType?: string;
  evidence?: string[];
}

export interface ChallengeAttemptResult extends ChallengeDecision {
  attempts?: number;
}

export interface ChallengeContext {
  title(): Promise<string>;
  text(): Promise<string>;
  html(): Promise<string>;
  hasText(patterns: string[]): Promise<boolean>;
  hasSelector(selector: string): Promise<boolean>;
  hasScript(pattern: string): Promise<boolean>;
  hasIframe(pattern: string): Promise<boolean>;
  wait(ms: number): Promise<void>;
  reload(): Promise<void>;
  waitForSelector(selector: string, timeoutMs?: number): Promise<boolean>;
  waitForChallengeToClear(timeoutMs: number): Promise<boolean>;
  ready(evidence?: string[]): ChallengeDecision;
  challenge(challengeType: string, evidence?: string[]): ChallengeDecision;
  notReady(reason: string, evidence?: string[]): ChallengeDecision;
  isChallenge(): Promise<boolean>;
}

export interface ChallengeStrategyModule {
  id: string;
  name?: string;
  domains: string[];
  detect(ctx: ChallengeContext): Promise<ChallengeDecision> | ChallengeDecision;
  autoAttempt(ctx: ChallengeContext): Promise<ChallengeAttemptResult> | ChallengeAttemptResult;
  verifyReady(ctx: ChallengeContext): Promise<ChallengeDecision> | ChallengeDecision;
}

export interface ChallengeStrategyValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
