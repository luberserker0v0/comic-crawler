import { describe, it, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../../src/events/bus';
import { AgentNotifier } from '../../../src/agent/notifier';
import { RollbackManager } from '../../../src/agent/rollback-manager';
import { VersionManager } from '../../../src/agent/version-manager';

const TEST_WORKSPACE = join(__dirname, '__tmp__', 'rollback-manager');

let rollbackManager: RollbackManager;

let versionManager: VersionManager;

let eventBus: EventBus;

const notifications: Array<{ type: string; fromVersion?: string; toVersion: string }> = [];

describe('RollbackManager', () => {
  RollbackManagerTestGroup1();
});

function RollbackManagerTestGroup1(): void {
  beforeEach(RollbackManagerTestScenario1);
  it('should emit rollback event and notification', RollbackManagerTestShouldEmitRollbackEventAndNotification);
}

async function RollbackManagerTestScenario1() {
    notifications.length = 0;
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    eventBus = new EventBus();
    rollbackManager = new RollbackManager(TEST_WORKSPACE, {} as never, eventBus, new AgentNotifier((notification) => {
        if (notification.type === 'rollback') {
            notifications.push(notification);
        }
    }));
    versionManager = new VersionManager(TEST_WORKSPACE);
}

async function RollbackManagerTestShouldEmitRollbackEventAndNotification() {
    const v1 = await createPromotedVersion('h1');
    const v2 = await createPromotedVersion('.headline');
    const rollbackEvent = captureRollbackEvent();
    const result = await rollbackManager.rollback('kuronavi');
    const activeVersion = await versionManager.getActiveVersion('kuronavi');
    expect(result.success).toBe(true);
    expect(activeVersion?.version).toBe(v1);
    expect(rollbackEvent.value).toBe(v1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].fromVersion).toBe(v2);
    expect(notifications[0].toVersion).toBe(v1);
}

async function createPromotedVersion(title: string): Promise<string> {
  const version = await versionManager.createCandidateVersion({
    adapterId: 'kuronavi',
    selectorsContent: `export const KURONAVI_SELECTORS = { title: "${title}" };`,
    testResults: { passed: 1, failed: 0 },
  });
  await versionManager.promoteVersion('kuronavi', version);
  return version;
}

function captureRollbackEvent(): { value?: string } {
  const result: { value?: string } = {};
  eventBus.on('adapter:repair:rolled-back', (payload) => { result.value = payload.toVersion; });
  return result;
}
