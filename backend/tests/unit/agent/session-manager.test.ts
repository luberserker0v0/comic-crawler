import { describe, it, expect, beforeEach } from '@jest/globals';
import { SessionManager } from '../../../src/agent/session-manager';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';

const TEST_WORKSPACE = join(__dirname, '__tmp__');

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(async () => {
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    manager = new SessionManager(TEST_WORKSPACE);
  });

  it('should create a new session', async () => {
    const session = await manager.create('test-adapter', 5, { sessionId: 'session-1' });

    expect(session.adapterId).toBe('test-adapter');
    expect(session.status).toBe('in_progress');
    expect(session.currentAttempt).toBe(0);
    expect(session.maxAttempts).toBe(5);
    expect(session.sessionId).toBe('session-1');
  });

  it('should load an existing session', async () => {
    await manager.create('test-adapter');
    const session = await manager.load('test-adapter');

    expect(session).not.toBeNull();
    expect(session?.adapterId).toBe('test-adapter');
  });

  it('should return null for non-existent session', async () => {
    const session = await manager.load('non-existent');
    expect(session).toBeNull();
  });

  it('should update attempt', async () => {
    await manager.create('test-adapter');
    await manager.updateAttempt('test-adapter', 1, 'Test error');

    const session = await manager.load('test-adapter');
    expect(session?.currentAttempt).toBe(1);
    expect(session?.lastFailure?.reason).toBe('Test error');
  });

  it('should complete session', async () => {
    await manager.create('test-adapter');
    await manager.complete('test-adapter', 'v1.0.0');

    const session = await manager.load('test-adapter');
    expect(session?.status).toBe('completed');
    expect(session?.lastSuccess?.version).toBe('v1.0.0');
  });

  it('should mark session as awaiting review', async () => {
    await manager.create('test-adapter');
    await manager.awaitReview('test-adapter', 'v1.1.0');

    const session = await manager.load('test-adapter');
    expect(session?.status).toBe('awaiting_review');
    expect(session?.candidateVersion).toBe('v1.1.0');
  });

  it('should fail session', async () => {
    await manager.create('test-adapter');
    await manager.fail('test-adapter');

    const session = await manager.load('test-adapter');
    expect(session?.status).toBe('failed');
  });

  it('should rollback session', async () => {
    await manager.create('test-adapter');
    await manager.rollback('test-adapter');

    const session = await manager.load('test-adapter');
    expect(session?.status).toBe('rolled_back');
  });
});
