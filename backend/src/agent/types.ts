export type AgentSessionStatus =
  | 'idle'
  | 'queued'
  | 'in_progress'
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolled_back';

export type AgentVersionStatus = 'candidate' | 'active' | 'rolled_back' | 'rejected';

export interface AgentSession {
  adapterId: string;
  status: AgentSessionStatus;
  currentAttempt: number;
  maxAttempts: number;
  sessionId?: string;
  triggerKey?: string;
  pageType?: 'metadata' | 'chapters' | 'images' | 'unknown';
  repairMode?: 'selector-only' | 'parser-hook';
  attemptCount?: number;
  sourceVersion?: string;
  candidateVersion?: string;
  lastFailure?: {
    reason: string;
    failedSelector?: string;
    htmlSample?: string;
    timestamp: Date;
  };
  lastSuccess?: {
    version: string;
    timestamp: Date;
  };
  startedAt?: Date;
  completedAt?: Date;
}

export interface AgentVersion {
  version: string;
  timestamp: Date;
  selectorsHash: string;
  parserHash: string;
  transformsHash?: string;
  testResults: {
    passed: number;
    failed: number;
  };
  status: AgentVersionStatus;
  adapterId?: string;
  repairMode?: 'selector-only' | 'parser-hook';
  sourceSessionId?: string;
  validation?: {
    syntaxValid?: boolean;
    fixtureResults?: FixtureValidationResult[];
  };
  promotedAt?: Date;
  rolledBackAt?: Date;
  basedOnVersion?: string | null;
}

export interface AgentVersions {
  adapterId: string;
  versions: AgentVersion[];
  activeVersion: string | null;
}

export interface AgentAttempt {
  attemptNumber: number;
  timestamp: Date;
  changes: string;
  testResult: 'passed' | 'failed';
  error?: string;
}

export interface FixtureValidationResult {
  valid: boolean;
  fixtureName: string;
  errors: string[];
}

export interface CandidateReviewNotification {
  type: 'candidate_review';
  adapterId: string;
  sessionId: string;
  version: string;
  repairMode?: 'selector-only' | 'parser-hook';
  sourceVersion?: string | null;
  validationSummary: {
    syntaxValid: boolean;
    passedFixtures: string[];
    failedFixtures: string[];
  };
  triggerSummary: {
    pageType?: 'metadata' | 'chapters' | 'images' | 'unknown';
    selectorName?: string;
    message: string;
  };
}

export interface RollbackNotification {
  type: 'rollback';
  adapterId: string;
  fromVersion?: string;
  toVersion: string;
  reason?: string;
}

export type AgentNotification = CandidateReviewNotification | RollbackNotification;

export interface ExtractionFailureContext {
  [key: string]: unknown;
  adapterId: string;
  parseMode: 'static' | 'dynamic' | 'interactive';
  repairMode: 'selector-only' | 'parser-hook';
  repairTargets: string[];
  fixturesRoot: string;
  fixtureRefs: string[];
  pageType: 'metadata' | 'chapters' | 'images' | 'unknown';
  selector?: string;
  selectorName?: string;
  url: string;
  htmlSample?: string;
  message: string;
}

export interface TriggerFailureRecord {
  adapterId: string;
  triggerKey: string;
  pageType: 'metadata' | 'chapters' | 'images' | 'unknown';
  selectorName?: string;
  count: number;
  firstOccurredAt: Date;
  lastOccurredAt: Date;
  lastMessage: string;
}

export interface AgentTriggerProgress {
  adapterId: string;
  triggerKey: string;
  pageType: 'metadata' | 'chapters' | 'images' | 'unknown';
  selectorName?: string;
  count: number;
  threshold: number;
  remainingFailures: number;
  inCooldown: boolean;
  cooldownRemainingMs: number;
  activeSession: boolean;
  lastMessage: string;
  firstOccurredAt: Date;
  lastOccurredAt: Date;
}
