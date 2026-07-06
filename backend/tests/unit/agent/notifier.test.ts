import { describe, it, expect } from '@jest/globals';
import { AgentNotifier } from '../../../src/agent/notifier';
import type { AgentNotification, AgentSession, AgentVersion, ExtractionFailureContext } from '../../../src/agent/types';

describe('AgentNotifier', () => {
  it('should emit a candidate review notification payload', async () => {
    const notifications: AgentNotification[] = [];
    const notifier = new AgentNotifier((notification) => {
      notifications.push(notification);
    });

    const session: AgentSession = {
      adapterId: 'kuronavi',
      sessionId: 'session-1',
      status: 'awaiting_review',
      currentAttempt: 1,
      maxAttempts: 5,
      candidateVersion: 'v1',
    };

    const version: AgentVersion = {
      version: 'v1',
      timestamp: new Date(),
      selectorsHash: 'abc',
      parserHash: '',
      testResults: { passed: 2, failed: 0 },
      status: 'candidate',
      repairMode: 'selector-only',
      basedOnVersion: null,
      validation: {
        syntaxValid: true,
        fixtureResults: [
          { fixtureName: 'metadata', valid: true, errors: [] },
          { fixtureName: 'images', valid: true, errors: [] },
        ],
      },
    };

    const errorContext: ExtractionFailureContext = {
      adapterId: 'kuronavi',
      parseMode: 'static',
      repairMode: 'selector-only',
      repairTargets: ['selectors.ts'],
      fixturesRoot: '/fixtures',
      fixtureRefs: ['manga-page.html'],
      pageType: 'metadata',
      selectorName: 'metadata.title',
      url: 'https://kuronavi.one/manga/example',
      message: 'Missing metadata title output',
    };

    const notification = await notifier.notifyCandidateReady({
      session,
      version,
      errorContext,
    });

    expect(notification.type).toBe('candidate_review');
    expect(notification.validationSummary.passedFixtures).toEqual(['metadata', 'images']);
    expect(notification.triggerSummary.selectorName).toBe('metadata.title');
    expect(notifications).toHaveLength(1);
  });

  it('should emit a rollback notification payload', async () => {
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
  });
});
