import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { SiteManifest } from '../adapter/sites/types';
import type { ExtractionFailureContext } from './types';
import { VersionManager } from './version-manager';

export interface WorkspaceSourceSnapshot {
  selectorsPath: string;
  parserPath?: string;
  transformsPath?: string;
}

export interface SessionWorkspace {
  sessionId: string;
  rootDir: string;
  sourceDir: string;
  attemptsDir: string;
  validationDir: string;
  errorContextPath: string;
  manifestPath: string;
  sessionPath: string;
  sourceFiles: WorkspaceSourceSnapshot;
  sourceVersion: string | null;
}

export interface CreateSessionWorkspaceOptions {
  adapterId: string;
  sessionId: string;
  manifest: SiteManifest;
  errorContext: ExtractionFailureContext;
}

export class WorkspaceFactory {
  private readonly workspacePath: string;
  private readonly versionManager: VersionManager;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.versionManager = new VersionManager(workspacePath);
  }

  async createSessionWorkspace(options: CreateSessionWorkspaceOptions): Promise<SessionWorkspace> {
    const rootDir = join(this.workspacePath, options.adapterId, options.sessionId);
    const sourceDir = join(rootDir, 'source');
    const attemptsDir = join(rootDir, 'attempts');
    const validationDir = join(rootDir, 'validation');

    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(attemptsDir, { recursive: true });
    await fs.mkdir(validationDir, { recursive: true });

    const sourceVersion = await this.populateSource(options.manifest, sourceDir, options.adapterId);
    const errorContextPath = join(rootDir, 'error-context.json');
    const manifestPath = join(rootDir, 'manifest.json');
    const sessionPath = join(rootDir, 'session.json');

    await fs.writeFile(errorContextPath, JSON.stringify(options.errorContext, null, 2), 'utf-8');
    await fs.writeFile(manifestPath, JSON.stringify(options.manifest, null, 2), 'utf-8');

    return {
      sessionId: options.sessionId,
      rootDir,
      sourceDir,
      attemptsDir,
      validationDir,
      errorContextPath,
      manifestPath,
      sessionPath,
      sourceFiles: {
        selectorsPath: join(sourceDir, 'selectors.ts'),
        parserPath: join(sourceDir, 'parser.ts'),
        transformsPath: join(sourceDir, 'transforms.ts'),
      },
      sourceVersion,
    };
  }

  private async populateSource(
    manifest: SiteManifest,
    sourceDir: string,
    adapterId: string
  ): Promise<string | null> {
    const activeVersion = await this.versionManager.getActiveVersion(adapterId);
    if (activeVersion) {
      const versionSource = await this.versionManager.readVersionSource(adapterId, activeVersion.version);
      if (versionSource) {
        await fs.writeFile(join(sourceDir, 'selectors.ts'), versionSource.selectorsContent, 'utf-8');

        if (versionSource.parserContent) {
          await fs.writeFile(join(sourceDir, 'parser.ts'), versionSource.parserContent, 'utf-8');
        }

        if (versionSource.transformsContent) {
          await fs.writeFile(join(sourceDir, 'transforms.ts'), versionSource.transformsContent, 'utf-8');
        }

        return activeVersion.version;
      }
    }

    for (const target of manifest.maintenance.repairTargets) {
      const sourcePath = join(manifest.maintenance.sourceRoot, target);
      const content = await fs.readFile(sourcePath, 'utf-8');
      await fs.writeFile(join(sourceDir, target), content, 'utf-8');
    }

    return null;
  }
}
