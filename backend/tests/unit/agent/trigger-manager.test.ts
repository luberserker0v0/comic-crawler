import { describe, it, expect, beforeEach } from '@jest/globals';
import { TriggerManager } from '../../../src/agent/trigger-manager';
import type { ExtractionFailureContext } from '../../../src/agent/types';

describe('TriggerManager', () => {
  let manager: TriggerManager;
  let baseContext: ExtractionFailureContext;

  beforeEach(() => {
    manager = new TriggerManager({
      threshold: 3,
      cooldownMs: 60_000,
    });

    baseContext = {
      adapterId: 'kuronavi',
      parseMode: 'static',
      repairMode: 'selector-only',
      repairTargets: ['selectors.ts'],
      fixturesRoot: '/fixtures/kuronavi',
      fixtureRefs: ['manga-page.html', 'expected-metadata.json'],
      pageType: 'metadata',
      selectorName: 'metadata.title',
      url: 'https://kuronavi.one/manga/example',
      message: 'Missing metadata title output',
    };
  });

  it('should aggregate repeated failures until threshold is reached', () => {
    const first = manager.recordFailure(baseContext, new Date('2026-05-18T00:00:00.000Z'));
    const second = manager.recordFailure(baseContext, new Date('2026-05-18T00:01:00.000Z'));
    const third = manager.recordFailure(baseContext, new Date('2026-05-18T00:02:00.000Z'));

    expect(first.triggered).toBe(false);
    expect(second.triggered).toBe(false);
    expect(third.triggered).toBe(true);
    expect(third.count).toBe(3);
    expect(manager.getFailureRecord(third.triggerKey)).toBeNull();
  });

  it('should respect cooldown after a trigger fires', () => {
    const firedAt = new Date('2026-05-18T00:02:00.000Z');
    manager.recordFailure(baseContext, new Date('2026-05-18T00:00:00.000Z'));
    manager.recordFailure(baseContext, new Date('2026-05-18T00:01:00.000Z'));
    const triggered = manager.recordFailure(baseContext, firedAt);

    const duringCooldown = manager.recordFailure(baseContext, new Date('2026-05-18T00:02:30.000Z'));

    expect(triggered.triggered).toBe(true);
    expect(duringCooldown.triggered).toBe(false);
    expect(duringCooldown.inCooldown).toBe(true);
    expect(duringCooldown.cooldownRemainingMs).toBeGreaterThan(0);
  });

  it('should block triggering while the adapter already has an active session', () => {
    manager.startSession('kuronavi', 'session-1');
    manager.recordFailure(baseContext, new Date('2026-05-18T00:00:00.000Z'));
    manager.recordFailure(baseContext, new Date('2026-05-18T00:01:00.000Z'));
    const evaluation = manager.recordFailure(baseContext, new Date('2026-05-18T00:02:00.000Z'));

    expect(evaluation.activeSession).toBe(true);
    expect(evaluation.triggered).toBe(false);
  });

  it('should build trigger keys with adapter, page type, and selector name', () => {
    const triggerKey = manager.buildTriggerKey(baseContext);
    expect(triggerKey).toBe('kuronavi:metadata:metadata.title');
  });
});
