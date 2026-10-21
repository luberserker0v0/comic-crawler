import { describe, it, expect, beforeEach } from '@jest/globals';
import { SessionManager } from '../../../src/agent/session-manager';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';

const TEST_WORKSPACE = join(__dirname, '__tmp__', 'session-manager');

let manager: SessionManager;

describe('SessionManager', () => {
  SessionManagerTestGroup1();
});

function SessionManagerTestGroup1(): void {
  beforeEach(SessionManagerTestScenario1);
  it('should create a new session', SessionManagerTestShouldCreateANewSession);
  it('should load an existing session', SessionManagerTestShouldLoadAnExistingSession);
  it('should return null for non-existent session', SessionManagerTestShouldReturnNullForNonExistentSession);
  it('should update attempt', SessionManagerTestShouldUpdateAttempt);
  it('should complete session', SessionManagerTestShouldCompleteSession);
  it('should mark session as awaiting review', SessionManagerTestShouldMarkSessionAsAwaitingReview);
  it('should fail session', SessionManagerTestShouldFailSession);
  it('should rollback session', SessionManagerTestShouldRollbackSession);
}

async function SessionManagerTestScenario1() {
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    manager = new SessionManager(TEST_WORKSPACE);
}

async function SessionManagerTestShouldCreateANewSession() {
    const session = await manager.create('test-adapter', 5, { sessionId: 'session-1' });
    expect(session.adapterId).toBe('test-adapter');
    expect(session.status).toBe('in_progress');
    expect(session.currentAttempt).toBe(0);
    expect(session.maxAttempts).toBe(5);
    expect(session.sessionId).toBe('session-1');
}

async function SessionManagerTestShouldLoadAnExistingSession() {
    await manager.create('test-adapter');
    const session = await manager.load('test-adapter');
    expect(session).not.toBeNull();
    expect(session?.adapterId).toBe('test-adapter');
}

async function SessionManagerTestShouldReturnNullForNonExistentSession() {
    const session = await manager.load('non-existent');
    expect(session).toBeNull();
}

async function SessionManagerTestShouldUpdateAttempt() {
    await manager.create('test-adapter');
    await manager.updateAttempt('test-adapter', 1, 'Test error');
    const session = await manager.load('test-adapter');
    expect(session?.currentAttempt).toBe(1);
    expect(session?.lastFailure?.reason).toBe('Test error');
}

async function SessionManagerTestShouldCompleteSession() {
    await manager.create('test-adapter');
    await manager.complete('test-adapter', 'v1.0.0');
    const session = await manager.load('test-adapter');
    expect(session?.status).toBe('completed');
    expect(session?.lastSuccess?.version).toBe('v1.0.0');
}

async function SessionManagerTestShouldMarkSessionAsAwaitingReview() {
    await manager.create('test-adapter');
    await manager.awaitReview('test-adapter', 'v1.1.0');
    const session = await manager.load('test-adapter');
    expect(session?.status).toBe('awaiting_review');
    expect(session?.candidateVersion).toBe('v1.1.0');
}

async function SessionManagerTestShouldFailSession() {
    await manager.create('test-adapter');
    await manager.fail('test-adapter');
    const session = await manager.load('test-adapter');
    expect(session?.status).toBe('failed');
}

async function SessionManagerTestShouldRollbackSession() {
    await manager.create('test-adapter');
    await manager.rollback('test-adapter');
    const session = await manager.load('test-adapter');
    expect(session?.status).toBe('rolled_back');
}
