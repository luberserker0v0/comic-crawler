import { describe, it, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { AgentMaintenanceLoop } from '../../../src/agent/maintenance-loop';
import { AgentNotifier } from '../../../src/agent/notifier';
import { KURONAVI_SITE_MANIFEST } from '../../../src/adapter/sites/kuronavi';
import type { AgentNotification, ExtractionFailureContext } from '../../../src/agent/types';

const TEST_WORKSPACE = join(__dirname, '__tmp__', 'maintenance-loop');

describe('AgentMaintenanceLoop', () => {
  let loop: AgentMaintenanceLoop;
  let errorContext: ExtractionFailureContext;
  let notifications: AgentNotification[];

  beforeEach(async () => {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    notifications = [];
    loop = new AgentMaintenanceLoop({
      workspacePath: TEST_WORKSPACE,
      storage: {} as never,
      notifier: new AgentNotifier((notification) => {
        notifications.push(notification);
      }),
    });
    errorContext = {
      adapterId: 'kuronavi',
      parseMode: 'static',
      repairMode: 'selector-only',
      repairTargets: ['selectors.ts'],
      fixturesRoot: '/fixtures/kuronavi',
      fixtureRefs: ['manga-page.html', 'expected-metadata.json'],
      pageType: 'metadata',
      url: 'https://kuronavi.one/manga/example',
      message: 'Missing metadata title output',
    };
  });

  it('should create a candidate version and move session to awaiting review', async () => {
    const result = await loop.startMaintenance(KURONAVI_SITE_MANIFEST, errorContext);
    const status = await loop.getStatus('kuronavi');
    const versions = await loop.getVersions('kuronavi');

    expect(result.success).toBe(true);
    expect(result.version).toBeDefined();
    expect(status?.status).toBe('awaiting_review');
    expect(status?.candidateVersion).toBe(result.version);
    expect(versions?.versions).toHaveLength(1);
    expect(versions?.versions[0].status).toBe('candidate');
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('candidate_review');
  });
});
