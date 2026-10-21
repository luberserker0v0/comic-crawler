import { describe, it, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { AgentAdminService } from '../../../src/agent/admin-service';
import { SessionManager } from '../../../src/agent/session-manager';
import { VersionManager } from '../../../src/agent/version-manager';
import { EventBus } from '../../../src/events/bus';

const TEST_WORKSPACE = join(__dirname, '__tmp__', 'admin-service');

let adminService: AgentAdminService;

let versionManager: VersionManager;

let sessionManager: SessionManager;

describe('AgentAdminService', () => {
  AgentAdminServiceTestGroup1();
});

function AgentAdminServiceTestGroup1(): void {
  beforeEach(AgentAdminServiceTestScenario1);
  it('should return adapter state with session and versions', AgentAdminServiceTestShouldReturnAdapterStateWithSessionAndVersions);
}

async function AgentAdminServiceTestScenario1() {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    adminService = new AgentAdminService(TEST_WORKSPACE, {} as never, new EventBus());
    versionManager = new VersionManager(TEST_WORKSPACE);
    sessionManager = new SessionManager(TEST_WORKSPACE);
}

async function AgentAdminServiceTestShouldReturnAdapterStateWithSessionAndVersions() {
    await sessionManager.create('kuronavi', 5, { sessionId: 'session-1' });
    const version = await versionManager.createCandidateVersion({
        adapterId: 'kuronavi',
        selectorsContent: 'export const KURONAVI_SELECTORS = { title: "h1" };',
        testResults: { passed: 1, failed: 0 },
    });
    const state = await adminService.getAdapterState('kuronavi');
    expect(state.session?.sessionId).toBe('session-1');
    expect(state.latestCandidate?.version).toBe(version);
    expect(state.versions?.versions).toHaveLength(1);
    expect(state.triggerProgress).toBeNull();
}
