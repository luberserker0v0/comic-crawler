import type {
  AgentNotification,
  AgentSession,
  AgentVersion,
  CandidateReviewNotification,
  ExtractionFailureContext,
  RollbackNotification,
} from './types';

export interface AgentNotifierSink {
  (notification: AgentNotification): void | Promise<void>;
}

export interface CandidateNotificationOptions {
  session: AgentSession;
  version: AgentVersion;
  errorContext: ExtractionFailureContext;
}

export interface RollbackNotificationOptions {
  adapterId: string;
  toVersion: string;
  fromVersion?: string;
  reason?: string;
}

export class AgentNotifier {
  constructor(private readonly sink?: AgentNotifierSink) {}

  async notifyCandidateReady(options: CandidateNotificationOptions): Promise<CandidateReviewNotification> {
    const notification = candidateNotification(options);
    await this.deliver(notification);
    return notification;
  }

  async notifyRollback(options: RollbackNotificationOptions): Promise<RollbackNotification> {
    const notification: RollbackNotification = {
      type: 'rollback', adapterId: options.adapterId, fromVersion: options.fromVersion,
      toVersion: options.toVersion, reason: options.reason,
    };
    await this.deliver(notification);
    return notification;
  }

  private async deliver(notification: AgentNotification): Promise<void> {
    if (!this.sink) return;
    await this.sink(notification);
  }
}

function candidateNotification(options: CandidateNotificationOptions): CandidateReviewNotification {
  return {
      type: 'candidate_review',
      adapterId: options.session.adapterId,
      sessionId: options.session.sessionId ?? 'unknown-session',
      version: options.version.version,
      repairMode: options.version.repairMode,
      sourceVersion: options.version.basedOnVersion,
      validationSummary: {
        syntaxValid: options.version.validation?.syntaxValid ?? true,
        passedFixtures: fixtureNames(options.version, true),
        failedFixtures: fixtureNames(options.version, false),
      },
      triggerSummary: {
        pageType: options.errorContext.pageType,
        selectorName: options.errorContext.selectorName,
        message: options.errorContext.message,
      },
  };
}

function fixtureNames(version: AgentVersion, valid: boolean): string[] {
  return version.validation?.fixtureResults?.filter((fixture) => fixture.valid === valid)
    .map((fixture) => fixture.fixtureName) ?? [];
}
