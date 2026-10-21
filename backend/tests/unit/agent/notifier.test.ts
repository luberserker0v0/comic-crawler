import { describe, it, expect } from '@jest/globals';
import { AgentNotifier } from '../../../src/agent/notifier';
import type { AgentNotification, AgentSession, AgentVersion, ExtractionFailureContext } from '../../../src/agent/types';

describe('AgentNotifier', () => {
  AgentNotifierTestGroup1();
});

function AgentNotifierTestGroup1(): void {
  it('should emit a candidate review notification payload', AgentNotifierTestShouldEmitACandidateReviewNotificationPayload);
  it('should emit a rollback notification payload', AgentNotifierTestShouldEmitARollbackNotificationPayload);
}

async function AgentNotifierTestShouldEmitACandidateReviewNotificationPayload() {
    const notifications: AgentNotification[] = [];
    const notifier = collectingNotifier(notifications);
    const notification = await notifier.notifyCandidateReady({
        session: candidateSession(), version: candidateVersion(), errorContext: failureContext(),
    });
    expect(notification.type).toBe('candidate_review');
    expect(notification.validationSummary.passedFixtures).toEqual(['metadata', 'images']);
    expect(notification.triggerSummary.selectorName).toBe('metadata.title');
    expect(notifications).toHaveLength(1);
}

function collectingNotifier(notifications: AgentNotification[]): AgentNotifier {
  return new AgentNotifier((notification) => { notifications.push(notification); });
}

function candidateSession(): AgentSession {
  return {
    adapterId: 'kuronavi', sessionId: 'session-1', status: 'awaiting_review',
    currentAttempt: 1, maxAttempts: 5, candidateVersion: 'v1',
  };
}

function candidateVersion(): AgentVersion {
  return {
    version: 'v1', timestamp: new Date(), selectorsHash: 'abc', parserHash: '',
    testResults: { passed: 2, failed: 0 }, status: 'candidate', repairMode: 'selector-only',
    basedOnVersion: null, validation: { syntaxValid: true, fixtureResults: [
      { fixtureName: 'metadata', valid: true, errors: [] },
      { fixtureName: 'images', valid: true, errors: [] },
    ] },
  };
}

function failureContext(): ExtractionFailureContext {
  return {
    adapterId: 'kuronavi', parseMode: 'playwright', repairMode: 'selector-only',
    repairTargets: ['selectors.ts'], fixturesRoot: '/fixtures', fixtureRefs: ['manga-page.html'],
    pageType: 'metadata', selectorName: 'metadata.title',
    url: 'https://kuronavi.one/manga/example', message: 'Missing metadata title output',
  };
}

async function AgentNotifierTestShouldEmitARollbackNotificationPayload() {
    const notifications: AgentNotification[] = [];
    const notifier = new AgentNotifier((notification) => {
        notifications.push(notification);
    });
    const notification = await notifier.notifyRollback({
        adapterId: 'kuronavi',
        fromVersion: 'v2',
        toVersion: 'v1',
        reason: 'Manual rollback',
    });
    expect(notification.type).toBe('rollback');
    expect(notification.fromVersion).toBe('v2');
    expect(notification.toVersion).toBe('v1');
    expect(notifications).toHaveLength(1);
}
