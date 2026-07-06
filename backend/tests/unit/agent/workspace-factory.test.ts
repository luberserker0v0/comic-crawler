import { describe, it, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceFactory } from '../../../src/agent/workspace-factory';
import { VersionManager } from '../../../src/agent/version-manager';
import { KURONAVI_SITE_MANIFEST } from '../../../src/adapter/sites/kuronavi';
import type { ExtractionFailureContext } from '../../../src/agent/types';

const TEST_WORKSPACE = join(__dirname, '__tmp__', 'workspace-factory');

describe('WorkspaceFactory', () => {
  let factory: WorkspaceFactory;
  let versionManager: VersionManager;
  let errorContext: ExtractionFailureContext;

  beforeEach(async () => {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    factory = new WorkspaceFactory(TEST_WORKSPACE);
    versionManager = new VersionManager(TEST_WORKSPACE);
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

  it('should bootstrap a session workspace from repo source when no active version exists', async () => {
    const workspace = await factory.createSessionWorkspace({
      adapterId: 'kuronavi',
      sessionId: 'session-1',
      manifest: KURONAVI_SITE_MANIFEST,
      errorContext,
    });

    const selectorsContent = await fs.readFile(workspace.sourceFiles.selectorsPath, 'utf-8');
    expect(workspace.sourceVersion).toBeNull();
    expect(selectorsContent).toContain('KURONAVI_SELECTORS');
  });

  it('should prefer active version source over repo source', async () => {
    const version = await versionManager.createCandidateVersion({
      adapterId: 'kuronavi',
      selectorsContent: 'export const KURONAVI_SELECTORS = { custom: true };\n',
      testResults: { passed: 1, failed: 0 },
    });
    await versionManager.promoteVersion('kuronavi', version);

    const workspace = await factory.createSessionWorkspace({
      adapterId: 'kuronavi',
      sessionId: 'session-2',
      manifest: KURONAVI_SITE_MANIFEST,
      errorContext,
    });

    const selectorsContent = await fs.readFile(workspace.sourceFiles.selectorsPath, 'utf-8');
    expect(workspace.sourceVersion).toBe(version);
    expect(selectorsContent).toContain('custom: true');
  });
});
