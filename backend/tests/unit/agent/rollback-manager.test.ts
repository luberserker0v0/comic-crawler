import { describe, it, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../../src/events/bus';
import { AgentNotifier } from '../../../src/agent/notifier';
import { RollbackManager } from '../../../src/agent/rollback-manager';
import { VersionManager } from '../../../src/agent/version-manager';

const TEST_WORKSPACE = join(__dirname, '__tmp__', 'rollback-manager');

describe('RollbackManager', () => {
  let rollbackManager: RollbackManager;
  let versionManager: VersionManager;
  let eventBus: EventBus;
  const notifications: Array<{ type: string; fromVersion?: string; toVersion: string }> = [];

  beforeEach(async () => {
    notifications.length = 0;
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    eventBus = new EventBus();
    rollbackManager = new RollbackManager(
      TEST_WORKSPACE,
      {} as never,
      eventBus,
      new AgentNotifier((notification) => {
        if (notification.type === 'rollback') {
          notifications.push(notification);
        }
      })
    );
    versionManager = new VersionManager(TEST_WORKSPACE);
  });

  it('should emit rollback event and notification', async () => {
    const v1 = await versionManager.createCandidateVersion({
      adapterId: 'kuronavi',
      selectorsContent: 'export const KURONAVI_SELECTORS = { title: "h1" };',
      testResults: { passed: 1, failed: 0 },
    });
    await versionManager.promoteVersion('kuronavi', v1);

    const v2 = await versionManager.createCandidateVersion({
      adapterId: 'kuronavi',
      selectorsContent: 'export const KURONAVI_SELECTORS = { title: ".headline" };',
      testResults: { passed: 1, failed: 0 },
    });
    await versionManager.promoteVersion('kuronavi', v2);

    let rolledBackTo: string | undefined;
    eventBus.on('adapter:repair:rolled-back', (payload) => {
      rolledBackTo = payload.toVersion;
    });

    const result = await rollbackManager.rollback('kuronavi');
    const activeVersion = await versionManager.getActiveVersion('kuronavi');

    expect(result.success).toBe(true);
    expect(activeVersion?.version).toBe(v1);
    expect(rolledBackTo).toBe(v1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].fromVersion).toBe(v2);
    expect(notifications[0].toVersion).toBe(v1);
  });
});
