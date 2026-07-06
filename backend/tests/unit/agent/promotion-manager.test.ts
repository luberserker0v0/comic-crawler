import { describe, it, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../../src/events/bus';
import { PromotionManager } from '../../../src/agent/promotion-manager';
import { SessionManager } from '../../../src/agent/session-manager';
import { VersionManager } from '../../../src/agent/version-manager';

const TEST_WORKSPACE = join(__dirname, '__tmp__', 'promotion-manager');

describe('PromotionManager', () => {
  let promotionManager: PromotionManager;
  let versionManager: VersionManager;
  let sessionManager: SessionManager;
  let eventBus: EventBus;

  beforeEach(async () => {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    eventBus = new EventBus();
    promotionManager = new PromotionManager(TEST_WORKSPACE, eventBus);
    versionManager = new VersionManager(TEST_WORKSPACE);
    sessionManager = new SessionManager(TEST_WORKSPACE);
  });

  it('should promote the latest candidate and complete the session', async () => {
    await sessionManager.create('kuronavi', 5, { sessionId: 'session-1' });
    await sessionManager.awaitReview('kuronavi', 'pending');

    const version = await versionManager.createCandidateVersion({
      adapterId: 'kuronavi',
      selectorsContent: 'export const KURONAVI_SELECTORS = { title: "h1" };',
      testResults: { passed: 1, failed: 0 },
    });

    let promotedEventVersion: string | undefined;
    eventBus.on('adapter:repair:promoted', (payload) => {
      promotedEventVersion = payload.version;
    });

    const result = await promotionManager.promoteCandidate('kuronavi', version);
    const activeVersion = await versionManager.getActiveVersion('kuronavi');
    const session = await sessionManager.load('kuronavi');

    expect(result.success).toBe(true);
    expect(activeVersion?.version).toBe(version);
    expect(session?.status).toBe('completed');
    expect(promotedEventVersion).toBe(version);
  });
});
