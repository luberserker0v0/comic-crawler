import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { AgentVersion, AgentVersions, FixtureValidationResult } from './types';

export interface CreateVersionOptions {
  adapterId: string;
  selectorsContent: string;
  parserContent?: string;
  transformsContent?: string;
  testResults: { passed: number; failed: number };
  repairMode?: 'selector-only' | 'parser-hook';
  sourceSessionId?: string;
  basedOnVersion?: string | null;
  validation?: {
    syntaxValid?: boolean;
    fixtureResults?: FixtureValidationResult[];
  };
}

export interface VersionSourceFiles {
  selectorsContent: string;
  parserContent?: string;
  transformsContent?: string;
}

export class VersionManager {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  async load(adapterId: string): Promise<AgentVersions | null> {
    for (const candidatePath of [this.getIndexPath(adapterId), this.getLegacyVersionsPath(adapterId)]) {
      try {
        const content = await fs.readFile(candidatePath, 'utf-8');
        return JSON.parse(content) as AgentVersions;
      } catch {
        // Try the next path.
      }
    }

    return null;
  }

  async save(adapterId: string, versions: AgentVersions): Promise<void> {
    const indexPath = this.getIndexPath(adapterId);
    await fs.mkdir(join(indexPath, '..'), { recursive: true });
    await fs.writeFile(indexPath, JSON.stringify(versions, null, 2));
  }

  async addVersion(
    adapterId: string,
    selectorsContent: string,
    parserContent: string,
    testResults: { passed: number; failed: number }
  ): Promise<string> {
    return this.createCandidateVersion({
      adapterId,
      selectorsContent,
      parserContent,
      testResults,
    });
  }

  async createCandidateVersion(options: CreateVersionOptions): Promise<string> {
    const versions = (await this.load(options.adapterId)) ?? this.createEmptyState(options.adapterId);
    const version = this.generateVersion(options);

    versions.versions.push(version);
    await this.writeVersionFiles(options.adapterId, version.version, {
      selectorsContent: options.selectorsContent,
      parserContent: options.parserContent,
      transformsContent: options.transformsContent,
    });
    await this.writeVersionMetadata(options.adapterId, version);
    await this.save(options.adapterId, versions);

    return version.version;
  }

  async promoteVersion(adapterId: string, version: string): Promise<boolean> {
    const versions = await this.load(adapterId);
    if (!versions) return false;

    const targetVersion = versions.versions.find((entry) => entry.version === version);
    if (!targetVersion || targetVersion.status !== 'candidate') {
      return false;
    }

    const previousActive = versions.activeVersion
      ? versions.versions.find((entry) => entry.version === versions.activeVersion)
      : null;

    if (previousActive && previousActive.version !== version) {
      previousActive.status = 'rejected';
      await this.writeVersionMetadata(adapterId, previousActive);
    }

    targetVersion.status = 'active';
    targetVersion.promotedAt = new Date();
    versions.activeVersion = targetVersion.version;

    await this.writeVersionMetadata(adapterId, targetVersion);
    await this.save(adapterId, versions);
    return true;
  }

  async rejectVersion(adapterId: string, version: string): Promise<boolean> {
    const versions = await this.load(adapterId);
    if (!versions) return false;

    const targetVersion = versions.versions.find((entry) => entry.version === version);
    if (!targetVersion || targetVersion.status !== 'candidate') {
      return false;
    }

    targetVersion.status = 'rejected';
    await this.writeVersionMetadata(adapterId, targetVersion);
    await this.save(adapterId, versions);
    return true;
  }

  async getCurrentVersion(adapterId: string): Promise<AgentVersion | null> {
    return this.getActiveVersion(adapterId);
  }

  async getVersion(adapterId: string, version: string): Promise<AgentVersion | null> {
    const versions = await this.load(adapterId);
    if (!versions) return null;

    return versions.versions.find((entry) => entry.version === version) ?? null;
  }

  async getActiveVersion(adapterId: string): Promise<AgentVersion | null> {
    const versions = await this.load(adapterId);
    if (!versions?.activeVersion) return null;

    return versions.versions.find((entry) => entry.version === versions.activeVersion) ?? null;
  }

  async getLatestCandidateVersion(adapterId: string): Promise<AgentVersion | null> {
    const versions = await this.load(adapterId);
    if (!versions) return null;

    return [...versions.versions].reverse().find((entry) => entry.status === 'candidate') ?? null;
  }

  async getPreviousVersion(adapterId: string): Promise<AgentVersion | null> {
    const versions = await this.load(adapterId);
    if (!versions?.activeVersion) return null;

    const activeIndex = versions.versions.findIndex((entry) => entry.version === versions.activeVersion);
    if (activeIndex <= 0) return null;

    for (let index = activeIndex - 1; index >= 0; index -= 1) {
      const entry = versions.versions[index];
      if (entry.status !== 'candidate') {
        return entry;
      }
    }

    return null;
  }

  async rollbackToVersion(adapterId: string, version: string): Promise<boolean> {
    const versions = await this.load(adapterId);
    if (!versions) return false;

    const targetVersion = versions.versions.find((entry) => entry.version === version);
    if (!targetVersion) return false;

    const activeVersion = versions.activeVersion
      ? versions.versions.find((entry) => entry.version === versions.activeVersion)
      : null;

    if (activeVersion && activeVersion.version !== targetVersion.version) {
      activeVersion.status = 'rolled_back';
      activeVersion.rolledBackAt = new Date();
      await this.writeVersionMetadata(adapterId, activeVersion);
    }

    targetVersion.status = 'active';
    versions.activeVersion = targetVersion.version;

    await this.writeVersionMetadata(adapterId, targetVersion);
    await this.save(adapterId, versions);
    return true;
  }

  async getStableVersion(adapterId: string): Promise<AgentVersion | null> {
    return this.getActiveVersion(adapterId);
  }

  async readVersionSource(adapterId: string, version: string): Promise<VersionSourceFiles | null> {
    const versionDir = this.getVersionDirectory(adapterId, version);

    try {
      const selectorsContent = await fs.readFile(join(versionDir, 'selectors.ts'), 'utf-8');
      const parserContent = await this.readOptionalFile(join(versionDir, 'parser.ts'));
      const transformsContent = await this.readOptionalFile(join(versionDir, 'transforms.ts'));

      return {
        selectorsContent,
        parserContent: parserContent ?? undefined,
        transformsContent: transformsContent ?? undefined,
      };
    } catch {
      return null;
    }
  }

  getVersionDirectory(adapterId: string, version: string): string {
    return join(this.workspacePath, adapterId, 'versions', version);
  }

  private createEmptyState(adapterId: string): AgentVersions {
    return {
      adapterId,
      versions: [],
      activeVersion: null,
    };
  }

  private generateVersion(options: CreateVersionOptions): AgentVersion {
    const selectorsHash = createHash('sha256').update(options.selectorsContent).digest('hex');
    const parserHash = createHash('sha256').update(options.parserContent ?? '').digest('hex');
    const transformsHash = options.transformsContent
      ? createHash('sha256').update(options.transformsContent).digest('hex')
      : undefined;
    const timestamp = new Date();
    const version = `v${timestamp.getFullYear()}.${String(timestamp.getMonth() + 1).padStart(2, '0')}.${String(timestamp.getDate()).padStart(2, '0')}-${selectorsHash.slice(0, 8)}`;

    return {
      version,
      timestamp,
      selectorsHash,
      parserHash,
      transformsHash,
      testResults: options.testResults,
      status: 'candidate',
      adapterId: options.adapterId,
      repairMode: options.repairMode,
      sourceSessionId: options.sourceSessionId,
      validation: options.validation,
      basedOnVersion: options.basedOnVersion ?? null,
    };
  }

  private async writeVersionFiles(adapterId: string, version: string, files: VersionSourceFiles): Promise<void> {
    const versionDir = this.getVersionDirectory(adapterId, version);
    await fs.mkdir(versionDir, { recursive: true });
    await fs.writeFile(join(versionDir, 'selectors.ts'), files.selectorsContent, 'utf-8');

    if (files.parserContent) {
      await fs.writeFile(join(versionDir, 'parser.ts'), files.parserContent, 'utf-8');
    }

    if (files.transformsContent) {
      await fs.writeFile(join(versionDir, 'transforms.ts'), files.transformsContent, 'utf-8');
    }
  }

  private async writeVersionMetadata(adapterId: string, version: AgentVersion): Promise<void> {
    const versionDir = this.getVersionDirectory(adapterId, version.version);
    await fs.mkdir(versionDir, { recursive: true });
    await fs.writeFile(join(versionDir, 'metadata.json'), JSON.stringify(version, null, 2), 'utf-8');
  }

  private async readOptionalFile(path: string): Promise<string | null> {
    try {
      return await fs.readFile(path, 'utf-8');
    } catch {
      return null;
    }
  }

  private getIndexPath(adapterId: string): string {
    return join(this.workspacePath, adapterId, 'index.json');
  }

  private getLegacyVersionsPath(adapterId: string): string {
    return join(this.workspacePath, adapterId, 'versions.json');
  }
}
