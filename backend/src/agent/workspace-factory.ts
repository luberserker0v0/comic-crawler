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
    const paths = workspacePaths(rootDir);
    await Promise.all([paths.sourceDir, paths.attemptsDir, paths.validationDir].map((path) => fs.mkdir(path, { recursive: true })));
    await this.writeInputs(rootDir, options);
    const sourceVersion = await this.populateSource(options.manifest, paths.sourceDir, options.adapterId);
    return createWorkspace(options.sessionId, rootDir, paths, sourceVersion);
  }

  private async writeInputs(rootDir: string, options: CreateSessionWorkspaceOptions): Promise<void> {
    const errorContextPath = join(rootDir, 'error-context.json');
    const manifestPath = join(rootDir, 'manifest.json');
    await Promise.all([
      fs.writeFile(errorContextPath, JSON.stringify(options.errorContext, null, 2), 'utf-8'),
      fs.writeFile(manifestPath, JSON.stringify(options.manifest, null, 2), 'utf-8'),
    ]);
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
        await writeVersionSource(sourceDir, versionSource);
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

function workspacePaths(rootDir: string) {
  return { sourceDir: join(rootDir, 'source'), attemptsDir: join(rootDir, 'attempts'), validationDir: join(rootDir, 'validation') };
}

function createWorkspace(sessionId: string, rootDir: string, paths: ReturnType<typeof workspacePaths>,
  sourceVersion: string | null): SessionWorkspace {
  return {
    sessionId, rootDir, ...paths, errorContextPath: join(rootDir, 'error-context.json'),
    manifestPath: join(rootDir, 'manifest.json'), sessionPath: join(rootDir, 'session.json'), sourceVersion,
    sourceFiles: { selectorsPath: join(paths.sourceDir, 'selectors.ts'), parserPath: join(paths.sourceDir, 'parser.ts'),
      transformsPath: join(paths.sourceDir, 'transforms.ts') },
  };
}

async function writeVersionSource(sourceDir: string,
  source: NonNullable<Awaited<ReturnType<VersionManager['readVersionSource']>>>): Promise<void> {
  await fs.writeFile(join(sourceDir, 'selectors.ts'), source.selectorsContent, 'utf-8');
  if (source.parserContent) await fs.writeFile(join(sourceDir, 'parser.ts'), source.parserContent, 'utf-8');
  if (source.transformsContent) await fs.writeFile(join(sourceDir, 'transforms.ts'), source.transformsContent, 'utf-8');
}
