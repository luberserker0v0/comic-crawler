import { describe, it, expect, beforeEach } from '@jest/globals';
import { VersionManager } from '../../../src/agent/version-manager';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';

const TEST_WORKSPACE = join(__dirname, '__tmp__', 'version-manager');

describe('VersionManager', () => {
  let manager: VersionManager;

  beforeEach(async () => {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    manager = new VersionManager(TEST_WORKSPACE);
  });

  it('should return null for non-existent versions', async () => {
    const versions = await manager.load('non-existent');
    expect(versions).toBeNull();
  });

  it('should create candidate versions by default', async () => {
    const version = await manager.addVersion(
      'test-adapter',
      'export const selectors = { title: ".title" };',
      'export function parse() {}',
      { passed: 10, failed: 0 }
    );

    const versions = await manager.load('test-adapter');
    expect(version.startsWith('v')).toBe(true);
    expect(versions?.versions).toHaveLength(1);
    expect(versions?.versions[0].status).toBe('candidate');
    expect(versions?.activeVersion).toBeNull();
  });

  it('should promote a candidate version to active', async () => {
    const version = await manager.createCandidateVersion({
      adapterId: 'test-adapter',
      selectorsContent: 'export const selectors = { title: ".title" };',
      parserContent: 'export function parse() {}',
      testResults: { passed: 10, failed: 0 },
      repairMode: 'selector-only',
      sourceSessionId: 'session-1',
    });

    const promoted = await manager.promoteVersion('test-adapter', version);
    const activeVersion = await manager.getActiveVersion('test-adapter');

    expect(promoted).toBe(true);
    expect(activeVersion?.version).toBe(version);
    expect(activeVersion?.status).toBe('active');
    expect(activeVersion?.promotedAt).toBeDefined();
  });

  it('should reject previous active version when promoting a new candidate', async () => {
    const v1 = await manager.addVersion(
      'test-adapter',
      'export const selectors = { title: ".title" };',
      'export function parse() {}',
      { passed: 10, failed: 0 }
    );
    await manager.promoteVersion('test-adapter', v1);

    const v2 = await manager.addVersion(
      'test-adapter',
      'export const selectors = { title: ".headline" };',
      'export function parseLatest() {}',
      { passed: 10, failed: 0 }
    );
    await manager.promoteVersion('test-adapter', v2);

    const versions = await manager.load('test-adapter');
    const oldActive = versions?.versions.find((entry) => entry.version === v1);
    const newActive = versions?.versions.find((entry) => entry.version === v2);

    expect(versions?.activeVersion).toBe(v2);
    expect(oldActive?.status).toBe('rejected');
    expect(newActive?.status).toBe('active');
  });

  it('should rollback to a previous version and mark the replaced active version as rolled_back', async () => {
    const v1 = await manager.addVersion(
      'test-adapter',
      'export const selectors = { title: ".title" };',
      'export function parse() {}',
      { passed: 10, failed: 0 }
    );
    await manager.promoteVersion('test-adapter', v1);

    const v2 = await manager.addVersion(
      'test-adapter',
      'export const selectors = { title: ".headline" };',
      'export function parseLatest() {}',
      { passed: 10, failed: 0 }
    );
    await manager.promoteVersion('test-adapter', v2);

    const success = await manager.rollbackToVersion('test-adapter', v1);
    const versions = await manager.load('test-adapter');
    const rolledBack = versions?.versions.find((entry) => entry.version === v2);
    const restored = versions?.versions.find((entry) => entry.version === v1);

    expect(success).toBe(true);
    expect(versions?.activeVersion).toBe(v1);
    expect(rolledBack?.status).toBe('rolled_back');
    expect(rolledBack?.rolledBackAt).toBeDefined();
    expect(restored?.status).toBe('active');
  });

  it('should reject a candidate without promoting it', async () => {
    const version = await manager.addVersion(
      'test-adapter',
      'export const selectors = { title: ".title" };',
      'export function parse() {}',
      { passed: 10, failed: 0 }
    );

    const rejected = await manager.rejectVersion('test-adapter', version);
    const latestCandidate = await manager.getLatestCandidateVersion('test-adapter');
    const versions = await manager.load('test-adapter');
    const rejectedVersion = versions?.versions.find((entry) => entry.version === version);

    expect(rejected).toBe(true);
    expect(latestCandidate).toBeNull();
    expect(rejectedVersion?.status).toBe('rejected');
  });
});
