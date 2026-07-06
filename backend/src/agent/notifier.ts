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
    const notification: CandidateReviewNotification = {
      type: 'candidate_review',
      adapterId: options.session.adapterId,
      sessionId: options.session.sessionId ?? 'unknown-session',
      version: options.version.version,
      repairMode: options.version.repairMode,
      sourceVersion: options.version.basedOnVersion,
      validationSummary: {
        syntaxValid: options.version.validation?.syntaxValid ?? true,
        passedFixtures: options.version.validation?.fixtureResults
          ?.filter((fixture) => fixture.valid)
          .map((fixture) => fixture.fixtureName) ?? [],
        failedFixtures: options.version.validation?.fixtureResults
          ?.filter((fixture) => !fixture.valid)
          .map((fixture) => fixture.fixtureName) ?? [],
      },
      triggerSummary: {
        pageType: options.errorContext.pageType,
        selectorName: options.errorContext.selectorName,
        message: options.errorContext.message,
      },
    };

    await this.deliver(notification);
    return notification;
  }

  async notifyRollback(options: RollbackNotificationOptions): Promise<RollbackNotification> {
    const notification: RollbackNotification = {
      type: 'rollback',
      adapterId: options.adapterId,
      fromVersion: options.fromVersion,
      toVersion: options.toVersion,
      reason: options.reason,
    };

    await this.deliver(notification);
    return notification;
  }

  private async deliver(notification: AgentNotification): Promise<void> {
    if (!this.sink) return;
    await this.sink(notification);
  }
}
